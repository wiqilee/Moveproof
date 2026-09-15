# Deployment

MoveProof uses a split production architecture:

- Next.js frontend on Vercel
- FastAPI backend on Google Cloud Run
- PostgreSQL on Google Cloud SQL
- private object storage on Google Cloud Storage
- Rust verifier packaged with the backend
- model inference through Nebius Token Factory
- external semantic evidence through Tavily

## Current Production Deployment

Frontend:

`https://moveproof-wiqi.vercel.app`

Backend:

`https://moveproof-backend-579259634424.asia-southeast2.run.app`

Production NVIDIA model:

`nvidia/nemotron-3-super-120b-a12b`

Nebius Token Factory base URL:

`https://api.tokenfactory.nebius.com/v1`

The core production stack has successfully completed the full MoveProof workflow:

upload → plan approval → staging → verification failure → repair → rerun from original source bytes → verification pass → commit → evidence generation.

A real Nebius Token Factory inference call has also been verified separately using the production NVIDIA model.

### External Evidence Check status

The Tavily-powered External Evidence Check is implemented in the repository as a real backend capability.

It becomes active in production after:

1. database migration `003_evidence_events.sql` is applied;
2. the `tavily-api-key` secret exists in Google Secret Manager;
3. the updated Cloud Run configuration is deployed;
4. a real production External Evidence Check returns normalized Tavily sources successfully.

Until those steps are completed, the existing MoveProof migration workflow remains available and Tavily does not participate in verification or commit decisions.

## What Runs Where

| Component | Host | Responsibility |
| --- | --- | --- |
| Next.js frontend | Vercel | Public interface and migration workspace |
| FastAPI backend | Google Cloud Run | Workflow orchestration and API |
| Rust verifier | Backend container | Independent canonical reconciliation |
| PostgreSQL | Google Cloud SQL | Workflow state, staging, verification records, audit events, and destination data |
| Object storage | Google Cloud Storage | Private object storage |
| Model inference | Nebius Token Factory | NVIDIA model-assisted reasoning |
| External evidence | Tavily | Public reference discovery for semantic review |

The production NVIDIA model is:

`nvidia/nemotron-3-super-120b-a12b`

Google Cloud does not provide model inference for MoveProof.

Vertex AI and Gemini are not part of the production inference path.

Tavily has a separate role from Nebius. Nebius assists with mapping, risk analysis, diagnosis, and repair proposals. Tavily retrieves external public references that may help a human resolve semantic ambiguity.

Neither provider is allowed to bypass deterministic verification or commit gates.

## Architecture Principle

MoveProof follows this boundary:

> AI proposes. Validated code executes. Independent evidence decides. Humans approve ambiguity.

Model output and external evidence are both treated as untrusted inputs.

The NVIDIA model does not directly execute SQL, shell commands, Python, or arbitrary application code.

Tavily does not modify plans, staged rows, verification states, or destination data.

Transformation execution remains deterministic and constrained by the supported operation allowlist.

Verification remains separate from planning and external evidence gathering.

## Prerequisites

For a new deployment, configure a Google Cloud project and region:

```bash
export GCP_PROJECT_ID=your-project
export GCP_REGION=asia-southeast2

gcloud config set project "$GCP_PROJECT_ID"

gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com
```

You also need:

- a Vercel account;
- Nebius Token Factory access;
- Tavily access if External Evidence Check will be enabled;
- Google Cloud CLI;
- Cloud SQL Auth Proxy for local database administration;
- a production PostgreSQL password;
- an appropriate Google Cloud billing configuration.

Never commit production credentials to the repository.

## 1. Verify Nebius Token Factory

Verify model access before provisioning unnecessary infrastructure.

From `backend/`:

```bash
export NEBIUS_API_KEY='your-key'
python scripts/nebius_smoke_test.py
```

The smoke test makes a real inference request.

For the current MoveProof production configuration, the model is:

```text
nvidia/nemotron-3-super-120b-a12b
```

The Token Factory base URL is:

```text
https://api.tokenfactory.nebius.com/v1
```

Do not print, commit, or expose the Nebius API key.

## 2. Create PostgreSQL

A small PostgreSQL instance is sufficient for hackathon-scale demonstration traffic.

Example:

```bash
gcloud sql instances create moveproof \
  --database-version=POSTGRES_16 \
  --edition=ENTERPRISE \
  --tier=db-f1-micro \
  --region="$GCP_REGION" \
  --storage-size=10GB \
  --storage-auto-increase

gcloud sql databases create moveproof \
  --instance=moveproof

gcloud sql users create moveproof \
  --instance=moveproof \
  --password='CHOOSE_A_STRONG_PASSWORD'
```

Cloud SQL is normally the largest persistent infrastructure cost in this stack.

For temporary development environments, an instance can be stopped when it is not needed:

```bash
gcloud sql instances patch moveproof \
  --activation-policy=NEVER

gcloud sql instances patch moveproof \
  --activation-policy=ALWAYS
```

Do not stop the production database while judges, reviewers, or other users are expected to access the application.

## 3. Apply Database Migrations

Use Cloud SQL Auth Proxy when applying migrations from a local machine.

Example:

```bash
cloud-sql-proxy \
  "$GCP_PROJECT_ID:$GCP_REGION:moveproof" \
  --port 5434
```

Then, in another terminal:

```bash
cd backend

DATABASE_URL="postgresql://moveproof:PASSWORD@127.0.0.1:5434/moveproof" \
  python -m app.db.migrations
```

The Tavily feature introduces:

```text
003_evidence_events.sql
```

It adds nullable structured event fields to the existing audit-event table.

Existing rows remain valid, and the migration is designed to be safe to rerun through the normal migration runner.

Apply all migrations before starting the updated backend.

## 4. Store Secrets

Production secrets belong in Google Secret Manager.

MoveProof uses backend secrets including:

- `database-url`
- `nebius-api-key`
- `tavily-api-key` when External Evidence Check is enabled

Example for a fresh deployment:

```bash
printf '%s' \
  "postgresql://moveproof:PASSWORD@/moveproof?host=/cloudsql/$GCP_PROJECT_ID:$GCP_REGION:moveproof" \
  | gcloud secrets create database-url --data-file=-

printf '%s' "$NEBIUS_API_KEY" \
  | gcloud secrets create nebius-api-key --data-file=-

printf '%s' "$TAVILY_API_KEY" \
  | gcloud secrets create tavily-api-key --data-file=-
```

Do not run `secrets create` again for a secret that already exists.

To rotate the Tavily key later:

```bash
printf '%s' "$NEW_TAVILY_API_KEY" \
  | gcloud secrets versions add tavily-api-key --data-file=-
```

`deploy/cloudrun.yaml` references the Tavily secret.

Cloud Run will refuse to create a revision that references a Secret Manager secret that does not exist. Therefore, create `tavily-api-key` before applying a Cloud Run configuration that references it.

No Tavily credential belongs in a `NEXT_PUBLIC_*` variable.

## 5. Service Account and IAM

Create a dedicated runtime service account:

```bash
gcloud iam service-accounts create moveproof-backend
```

Grant only the roles required by the backend:

```bash
for role in \
  roles/cloudsql.client \
  roles/secretmanager.secretAccessor \
  roles/storage.objectAdmin
do
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member="serviceAccount:moveproof-backend@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
    --role="$role"
done
```

The existing production MoveProof service account already has Secret Manager access, so Tavily does not require an additional IAM role.

Avoid broad runtime roles such as Owner or Editor.

## 6. Cloud Storage

Create a private bucket:

```bash
gsutil mb \
  -l "$GCP_REGION" \
  -b on \
  "gs://$GCP_PROJECT_ID-moveproof"

gsutil uniformbucketlevelaccess set on \
  "gs://$GCP_PROJECT_ID-moveproof"

gsutil lifecycle set \
  deploy/storage-lifecycle.json \
  "gs://$GCP_PROJECT_ID-moveproof"
```

Uniform bucket-level access should remain enabled.

Uploaded objects must not be exposed through public URLs.

## 7. Build the Backend

The backend image includes the Rust verifier.

Use the repository's Cloud Build configuration:

```bash
gcloud builds submit \
  --config deploy/cloudbuild.yaml .
```

The build compiles the backend image and Rust verifier according to the repository configuration and publishes the resulting image to Artifact Registry.

Do not replace this command with an unrelated Docker build path unless the build configuration itself has changed.

## 8. Deploy Cloud Run

The production Cloud Run configuration is defined in:

```text
deploy/cloudrun.yaml
```

Resolve the deployment placeholders:

```bash
sed \
  -e "s/PROJECT_ID/$GCP_PROJECT_ID/g" \
  -e "s/REGION/$GCP_REGION/g" \
  deploy/cloudrun.yaml \
  > /tmp/cloudrun.resolved.yaml
```

Then deploy:

```bash
gcloud run services replace \
  /tmp/cloudrun.resolved.yaml \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT_ID"
```

The production inference configuration should include:

```text
NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1
NEBIUS_MODEL_ID=nvidia/nemotron-3-super-120b-a12b
```

`NEBIUS_API_KEY` and `TAVILY_API_KEY` must come from Secret Manager.

Do not place secret values directly in the YAML.

## 9. Public Backend Access

For the public hackathon deployment:

```bash
gcloud run services add-iam-policy-binding moveproof-backend \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT_ID" \
  --member="allUsers" \
  --role="roles/run.invoker"
```

Only the API service is publicly callable.

Database credentials, provider credentials, and private object-storage access remain server-side.

## 10. Verify Backend Health

Check the deployed backend:

```bash
curl -fsS \
  "https://moveproof-backend-579259634424.asia-southeast2.run.app/health"
```

The established production deployment has already been verified to report:

- overall status OK;
- PostgreSQL connected;
- Nebius configured;
- Rust verifier available;
- JSON evidence available;
- HTML evidence available;
- PDF evidence available.

After deploying External Evidence Check, `/health` should also expose its configuration status.

A health response indicating that a provider is configured only confirms that required configuration is present. It does not prove that an upstream API request succeeded.

Real Nebius and Tavily runtime calls must be verified separately.

## 11. Deploy the Frontend

Link the repository to Vercel:

```bash
vercel link
```

Configure:

```text
NEXT_PUBLIC_API_BASE_URL=https://moveproof-backend-579259634424.asia-southeast2.run.app
NEXT_PUBLIC_SITE_URL=https://moveproof-wiqi.vercel.app
```

Then deploy:

```bash
vercel --prod
```

Anything prefixed with `NEXT_PUBLIC_` is visible to browser users.

Never place:

- Nebius API keys;
- Tavily API keys;
- database passwords;
- cloud credentials;
- private access tokens;

inside a `NEXT_PUBLIC_*` variable.

## 12. CORS

The backend must allow the deployed Vercel origin:

```text
https://moveproof-wiqi.vercel.app
```

After changing CORS configuration, redeploy the backend.

Without the correct CORS origin, the browser can reach the public API over the network while still refusing frontend requests.

## 13. Runtime Limits

Important runtime limits include:

| Control | Configuration | Current/default value |
| --- | --- | --- |
| Upload size | `MAX_UPLOAD_BYTES` | 25 MB |
| Rows sampled for model reasoning | `MODEL_SAMPLE_ROWS` | 5 |
| External evidence timeout | `TAVILY_TIMEOUT_SECONDS` | 20 seconds |
| External evidence results | `TAVILY_MAX_RESULTS` | 5 |
| Request timeout | Cloud Run configuration | deployment-defined |
| Cloud Run concurrency | Cloud Run configuration | deployment-defined |
| Maximum Cloud Run instances | Cloud Run configuration | deployment-defined |
| File retention | Cloud Storage lifecycle | policy-defined |

External Evidence Check does not send full datasets, uploaded files, or raw spreadsheet rows to Tavily.

Its server-side query builder accepts only approved metadata required to investigate the semantic question.

## 14. Verified CSV Export

MoveProof exposes two different classes of output.

### Verified transformed data

CSV contains the successfully verified transformed dataset.

The export is generated by the backend from stored verified data rather than reconstructed from browser state.

Identifier values such as:

```text
00127
```

remain preserved.

Verified CSV is available when the migration reaches an acceptable verified state and remains available after commit.

Failed or unverified migration runs cannot be exported as verified data.

### Audit evidence

MoveProof also provides:

- JSON
- HTML
- PDF

These formats describe what MoveProof did, what was approved, which checks ran, what passed or failed, and what remains unverified.

CSV is a verified data output.

JSON, HTML, and PDF are audit/evidence outputs.

## 15. External Evidence Check

External Evidence Check is designed for semantic questions that cannot always be answered from the dataset alone.

For example:

```text
Should customer_id preserve leading zeros?
```

The backend constructs a metadata-only question and sends it to Tavily.

The resulting public references are normalized into MoveProof advisory evidence.

External Evidence Check can help a human determine whether an identifier, date, code, or similar field has semantics documented outside the uploaded data.

It does not:

- modify source data;
- modify staged data;
- change an approved plan;
- automatically approve a review;
- change `Passed`, `Failed`, `Review required`, or `Not verified`;
- bypass a commit gate;
- write destination rows.

External evidence supports human review.

It is not a deterministic verification result.

## 16. Verify the Tavily Runtime Call

After migration `003` is applied, the Tavily secret exists, and the new Cloud Run revision is active, create or use an existing migration in the workspace.

Resolve the backend URL:

```bash
BACKEND=$(gcloud run services describe moveproof-backend \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT_ID" \
  --format='value(status.url)')
```

Then run an External Evidence Check using a real migration ID:

```bash
MIGRATION_ID=YOUR_MIGRATION_ID

curl -fsS \
  -X POST \
  "$BACKEND/api/migrations/$MIGRATION_ID/external-evidence" \
  -H 'Content-Type: application/json' \
  -d '{
    "source_column": "customer_id",
    "destination_column": "customer_id",
    "question": "leading_zeros",
    "proposed_operation": "cast_to_integer"
  }'
```

A successful response should identify:

```text
provider: tavily
```

and return the normalized advisory-evidence structure.

A successful HTTP response alone does not establish that every source is authoritative. The interface exposes source identity and URLs so a human can judge the evidence.

The response must never contain `TAVILY_API_KEY`.

## 17. Delete and Rollback Behavior

Deletion and rollback are deliberately separate actions.

An uncommitted migration may be deleted directly.

A committed migration may not.

The required sequence is:

```text
POST /api/migrations/{id}/rollback
```

followed, only after rollback succeeds, by:

```text
DELETE /api/migrations/{id}
```

`DELETE` does not silently remove committed destination rows.

If rollback fails, deletion is not attempted.

Application deployment rollback and data migration rollback are separate operations.

## 18. Production Verification Workflow

The core production workflow has already been exercised successfully:

1. Upload `backend/tests/fixtures/clean.csv`.
2. Inspect the destination schema.
3. Select the legacy import profile.
4. Review and acknowledge the lossy identifier cast.
5. Approve the plan.
6. Stage and execute.
7. Run verification.
8. Confirm that leading-zero preservation fails.
9. Observe values such as `00127` becoming `127`.
10. Confirm that failed mandatory verification prevents commit.
11. Review the repair proposal.
12. Replace integer conversion with identifier-preserving string behavior.
13. Approve the revised plan.
14. Rerun from the original uploaded source bytes.
15. Verify again.
16. Confirm identifier preservation passes.
17. Download verified CSV.
18. Commit.
19. Inspect or download JSON, HTML, and PDF evidence.
20. Roll back explicitly before deleting a committed migration.

The intentional failure path uses the deterministic legacy profile.

Live Nebius inference has been verified separately using the production NVIDIA model.

External Evidence Check should be verified separately after Tavily is activated in Cloud Run.

## 19. Local Validation Before Deployment

Before deploying the Tavily-enabled revision:

```bash
cd backend
source .venv/bin/activate

make migrate
make test-core
make test-db
```

Then, from the repository root:

```bash
npm run typecheck
npm run lint
npm run build
```

Do not deploy if the database migration or required test suites fail.

Mocked Tavily tests prove application behavior around the provider boundary.

They do not replace a real production Tavily runtime test.

## 20. Cost Controls

Actual costs depend on provider pricing, usage, region, account configuration, promotions, and credits.

At demonstration scale:

- Cloud SQL is generally the most persistent infrastructure cost;
- Cloud Run usage is typically small;
- Cloud Storage usage is typically small;
- Nebius Token Factory usage depends on token consumption;
- Tavily usage depends on the provider plan and number of External Evidence Checks.

These are operational observations, not pricing guarantees.

A Google Cloud budget alert is a notification mechanism, not a hard spending cap.

Example:

```bash
gcloud billing budgets create \
  --billing-account=YOUR_BILLING_ACCOUNT \
  --display-name="MoveProof" \
  --budget-amount=25USD \
  --threshold-rule=percent=50 \
  --threshold-rule=percent=90
```

Do not stop production infrastructure while judges or reviewers are expected to use the application.

No GPU is provisioned in the MoveProof Google Cloud deployment. NVIDIA model inference is provided through Nebius Token Factory.

## 21. Application Deployment Rollback

Inspect Cloud Run revisions:

```bash
gcloud run revisions list \
  --service=moveproof-backend \
  --region="$GCP_REGION"
```

Route traffic back to an earlier revision:

```bash
gcloud run services update-traffic moveproof-backend \
  --region="$GCP_REGION" \
  --to-revisions=PREVIOUS_REVISION=100
```

Rolling Cloud Run back to an earlier application revision does not undo data already committed by a migration.

Migration rollback must be performed explicitly through MoveProof.

## 22. Production Readiness Checklist

Before treating the Tavily-enabled deployment as fully verified, confirm:

1. The Vercel production URL loads successfully.
2. The frontend uses the correct Cloud Run backend.
3. `/health` reports PostgreSQL connected.
4. `/health` reports the Rust verifier available.
5. JSON, HTML, and PDF evidence capabilities are available.
6. A real Nebius Token Factory inference request succeeds.
7. The production model is `nvidia/nemotron-3-super-120b-a12b`.
8. Database migrations include `003_evidence_events.sql`.
9. `tavily-api-key` exists in Secret Manager.
10. Cloud Run receives the Tavily secret without exposing it publicly.
11. A real External Evidence Check returns normalized Tavily advisory sources.
12. No Tavily credential appears in the response or audit metadata.
13. Running External Evidence Check does not change verification state.
14. Running External Evidence Check does not change commit eligibility.
15. Upload, staging, verification, repair, and commit still work.
16. Verified CSV preserves leading-zero identifiers.
17. Committed migrations require explicit rollback before deletion.
18. Frontend typecheck, lint, and build complete successfully.
19. Backend core and database/API suites are green.
20. GitHub CI is green.

The core MoveProof production stack is already deployed and verified.

The Tavily-powered External Evidence Check should only be described as production-verified after its real deployed runtime check succeeds.