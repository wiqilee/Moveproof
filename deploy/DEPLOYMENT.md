# Deployment

Frontend on Vercel, backend on Cloud Run, PostgreSQL on Cloud SQL, uploaded
files in Cloud Storage, inference on Nebius Token Factory.

Nothing here has been deployed. These are the configurations and the commands;
run them yourself and check the results.

## What runs where, and why

| Component | Host | Reason |
| --- | --- | --- |
| Next.js frontend | Vercel | Static and edge rendered, no server state |
| FastAPI backend | Cloud Run | Scales to zero between bursts of use |
| Rust verifier | Inside the backend image | A subprocess of the API, not a service |
| PostgreSQL | Cloud SQL | Staging and destination share one instance so commit is one transaction |
| Uploaded files | Cloud Storage | Private bucket, lifecycle deletion |
| Model inference | Nebius Token Factory | Required by the hackathon rules |

Google Cloud performs no inference in this architecture. Vertex AI and Gemini
are deliberately absent: routing model calls through them would put the
project outside the hackathon rules regardless of output quality.

## Before you start

```bash
export GCP_PROJECT_ID=your-project
export GCP_REGION=asia-southeast2
gcloud config set project "$GCP_PROJECT_ID"
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com storage.googleapis.com
```

## 1. Verify Nebius first

Token Factory access is the one requirement that decides eligibility, so
check it before provisioning anything that costs money.

```bash
cd backend
export NEBIUS_API_KEY='your-key'
python scripts/nebius_smoke_test.py
```

It prints the models your account can reach and makes a real inference call.
Record the model id it reports; you need it below. The key is read from the
environment only and is never printed or written to disk.

## 2. PostgreSQL

The smallest tier is enough for this workload.

```bash
gcloud sql instances create moveproof \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region="$GCP_REGION" \
  --storage-size=10GB \
  --storage-auto-increase

gcloud sql databases create moveproof --instance=moveproof
gcloud sql users create moveproof --instance=moveproof --password='CHOOSE_A_STRONG_ONE'
```

A `db-f1-micro` instance runs continuously and is the largest fixed cost in
this stack. Stop it when you are not demonstrating:

```bash
gcloud sql instances patch moveproof --activation-policy=NEVER   # stop
gcloud sql instances patch moveproof --activation-policy=ALWAYS  # start
```

Apply the schema through the proxy:

```bash
cloud-sql-proxy "$GCP_PROJECT_ID:$GCP_REGION:moveproof" &
cd backend
DATABASE_URL="postgresql://moveproof:PASSWORD@localhost:5432/moveproof" \
  python -m app.db.migrations
```

## 3. Secrets

Secrets live in Secret Manager and are referenced by the service. They are
never committed and never passed as plain environment values.

```bash
printf '%s' "postgresql://moveproof:PASSWORD@/moveproof?host=/cloudsql/$GCP_PROJECT_ID:$GCP_REGION:moveproof" \
  | gcloud secrets create database-url --data-file=-

printf '%s' "$NEBIUS_API_KEY" | gcloud secrets create nebius-api-key --data-file=-
```

## 4. Service account, least privilege

```bash
gcloud iam service-accounts create moveproof-backend

for role in roles/cloudsql.client roles/secretmanager.secretAccessor roles/storage.objectAdmin; do
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member="serviceAccount:moveproof-backend@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
    --role="$role"
done
```

Three roles, nothing else. The service can reach its own database, read its
own secrets and write to its own bucket.

## 5. Storage

```bash
gsutil mb -l "$GCP_REGION" -b on "gs://$GCP_PROJECT_ID-moveproof"
gsutil uniformbucketlevelaccess set on "gs://$GCP_PROJECT_ID-moveproof"
gsutil lifecycle set deploy/storage-lifecycle.json "gs://$GCP_PROJECT_ID-moveproof"
```

The bucket is private. Nothing in the application generates a public URL.

## 6. Build and deploy the backend

The Dockerfile compiles the Rust verifier in its first stage and runs its
tests there, so a broken verifier fails the build rather than shipping and
silently reporting `not_verified` in production.

```bash
gcloud artifacts repositories create moveproof \
  --repository-format=docker --location="$GCP_REGION"

gcloud builds submit \
  --tag "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/moveproof/backend:latest" \
  --file backend/Dockerfile .

sed -e "s/PROJECT_ID/$GCP_PROJECT_ID/g" -e "s/REGION/$GCP_REGION/g" \
  deploy/cloudrun.yaml > /tmp/cloudrun.resolved.yaml
gcloud run services replace /tmp/cloudrun.resolved.yaml --region="$GCP_REGION"
```

Set `NEBIUS_MODEL_ID` in the YAML to the id the smoke test reported before
deploying.

Confirm what actually came up:

```bash
curl -s "$(gcloud run services describe moveproof-backend --region="$GCP_REGION" --format='value(status.url)')/health" | jq
```

The health payload reports the database, Nebius, the Rust verifier and PDF
generation separately. Read it rather than assuming.

## 7. Frontend

```bash
vercel link
vercel env add NEXT_PUBLIC_API_BASE_URL production   # the Cloud Run URL
vercel --prod
```

Then set `CORS_ORIGINS` on the backend to the Vercel URL and redeploy the
service, otherwise the browser blocks every request.

No secret is ever placed in a `NEXT_PUBLIC_` variable. Anything with that
prefix is visible to any visitor.

## Limits and controls

| Control | Where | Default |
| --- | --- | --- |
| Upload size | `MAX_UPLOAD_BYTES` | 25 MB |
| Request timeout | Cloud Run `timeoutSeconds` | 300 s |
| Concurrency per instance | `containerConcurrency` | 20 |
| Maximum instances | `maxScale` | 4 |
| Rows sent to the model | `MODEL_SAMPLE_ROWS` | 5 |
| File retention | Storage lifecycle | 90 days |

## Cost

Rough monthly figures for a demonstration deployment, to be treated as
estimates rather than quotes:

* Cloud SQL `db-f1-micro`, running continuously: the dominant cost. Stop the
  instance between demonstrations.
* Cloud Run: scales to zero, so effectively free at demonstration volumes.
* Cloud Storage: negligible for a few megabytes.
* Nebius Token Factory: per token, and this product sends a schema summary
  plus five rows per proposal, so usage is small.

**A budget alert is a notification, not a spending cap.** It emails you after
money has been spent. The controls that actually bound spend are `maxScale`
on Cloud Run and stopping the SQL instance.

```bash
gcloud billing budgets create \
  --billing-account=YOUR_BILLING_ACCOUNT \
  --display-name="MoveProof" \
  --budget-amount=25USD \
  --threshold-rule=percent=50 --threshold-rule=percent=90
```

No GPU is provisioned anywhere. Token Factory serves the model, so this
project has no workload that needs one.

## Rollback

```bash
gcloud run revisions list --service=moveproof-backend --region="$GCP_REGION"
gcloud run services update-traffic moveproof-backend \
  --region="$GCP_REGION" --to-revisions=PREVIOUS_REVISION=100
```

Rolling the application back does not roll back a committed migration. That is
a separate action inside the product, scoped to the rows one migration wrote.

## Verifying a deployment

1. `/health` reports the database connected.
2. `/health` reports `rust_verifier.available` true. If false, the image was
   built without the Rust stage and reconciliation will report not verified.
3. `/health` reports `reports.pdf_available` true.
4. Upload a generated fixture, approve the legacy profile, and confirm the
   verifier fails on identifier preservation.
5. Repair, rerun, and confirm it passes.
6. Download the PDF and check it against the JSON export.

Until those six pass against the deployed URL, the deployment is not verified.
