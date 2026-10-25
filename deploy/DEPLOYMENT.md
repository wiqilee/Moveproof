# Deployment

MoveProof uses a split production architecture:

- Next.js frontend on Vercel
- FastAPI backend on Google Cloud Run
- PostgreSQL on Google Cloud SQL
- private object storage on Google Cloud Storage
- Rust verifier packaged with the backend
- NVIDIA model inference through Nebius Token Factory
- external semantic evidence through Tavily

## Current production deployment

Frontend:

```text
https://moveproof-wiqi.vercel.app
```

Backend:

```text
https://moveproof-backend-579259634424.asia-southeast2.run.app
```

Nebius Token Factory base URL:

```text
https://api.tokenfactory.nebius.com/v1
```

Primary NVIDIA model:

```text
nvidia/nemotron-3-super-120b-a12b
```

Selective escalation model:

```text
nvidia/Nemotron-3-Ultra-550b-a55b
```

The core production stack has successfully completed the full MoveProof workflow:

```text
upload
→ plan approval
→ staging
→ verification failure
→ repair
→ rerun from original source bytes
→ verification pass
→ commit
→ evidence generation
```

A real Nebius Token Factory inference call has been verified with the production Super model. Direct runtime access to the Ultra model has also been verified separately through Token Factory.

Adaptive Super-to-Ultra routing is production-verified. A real model-assisted migration produced two deterministic validator concerns, triggered the Ultra pass, and recorded `model_routing_decided` with `escalated: true`.

The `robot_calibration_v1` destination profile is **production-verified end to end** on the deployed stack. `004_robotics_destination.sql` is applied, the robotics-capable Cloud Run backend is active, `/api/schema/profiles` exposes the allowlisted robotics profile, and the clean, ambiguous, and multi-joint workflows have been exercised through verification, verified export, evidence, commit behavior, destination-conflict fail-closed behavior, and rollback.

### External Evidence Check status

The Tavily-powered External Evidence Check is active and production-verified.

Production verification included:

1. applying database migration `003_evidence_events.sql`;
2. supplying `tavily-api-key` to Cloud Run through Secret Manager;
3. deploying the updated backend revision; and
4. confirming a real production External Evidence Check returned normalized Tavily advisory sources without exposing the credential.

Tavily remains advisory. It does not participate in deterministic verification and cannot alter commit eligibility.

## What runs where

| Component | Host | Responsibility |
| --- | --- | --- |
| Next.js frontend | Vercel | Public interface and migration workspace |
| FastAPI backend | Google Cloud Run | Workflow orchestration and API |
| Rust verifier | Backend container | Independent canonical reconciliation |
| PostgreSQL | Google Cloud SQL | Workflow state, staging, verification records, audit events, and destination data |
| Object storage | Google Cloud Storage | Private source-object storage |
| Primary model | Nebius Token Factory | Routine schema interpretation and migration-plan reasoning |
| Escalation model | Nebius Token Factory | Selective deeper reasoning for plans with multiple validator concerns |
| External evidence | Tavily | Public-reference discovery for human semantic review |

Google Cloud does not provide model inference for MoveProof. Vertex AI and Gemini are not part of the production inference path.

Nebius and Tavily have separate roles:

- Nebius assists with mapping proposals and per-mapping risk notes. Failure diagnosis and repair proposals are deterministic backend logic and do not call a model.
- Tavily retrieves external public references that may help a human resolve semantic ambiguity.
- Neither provider can bypass deterministic validation, human approval, independent verification, or the database-backed commit gate.

## Architecture principle

MoveProof follows this boundary:

> **AI proposes. Validated code executes. Independent evidence decides. Humans approve ambiguity.**

Model output and external evidence are both treated as untrusted inputs.

The NVIDIA models do not directly execute SQL, shell commands, Python, or arbitrary application code. Model output is parsed into a typed proposal and validated against the supported operation allowlist.

Tavily does not modify plans, staged rows, verification states, or destination data.

Transformation execution remains deterministic. Verification remains separate from planning and external evidence gathering.

### Adaptive reasoning escalation

The model-assisted planner uses two bounded reasoning passes only when needed:

1. **Nemotron 3 Super** proposes the initial typed migration plan.
2. MoveProof validates that proposal deterministically.
3. The routing policy reads the validator output, not a model-generated confidence score.
4. Fewer than two validator concerns keeps the Super proposal.
5. Two or more validator concerns triggers a second pass with **Nemotron 3 Ultra**.
6. The Ultra result is still untrusted and must pass the same deterministic validation and approval gates.

A concern is a signal the validator already computes, such as a mapping that requires acknowledgement by name or a non-fatal validation issue. The routing layer does not invent a second authority system.

The two model passes share the same bounded sample path controlled by `MODEL_SAMPLE_ROWS`. The escalation pass does not receive a larger slice of the dataset.

If `NEBIUS_ESCALATION_MODEL_ID` is unset, MoveProof returns to Super-only behavior. If the escalation request fails, the validated Super proposal remains available and the escalation failure is recorded. The routing layer cannot approve a plan, execute a transformation, alter verification results, or commit data.

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
- a production PostgreSQL password; and
- an appropriate Google Cloud billing configuration.

Never commit production credentials to the repository.

## 1. Verify Nebius Token Factory

Verify model access before provisioning unnecessary infrastructure.

From `backend/`, first test the primary Super model:

```bash
export NEBIUS_API_KEY='your-key'
export NEBIUS_BASE_URL='https://api.tokenfactory.nebius.com/v1'
export NEBIUS_MODEL_ID='nvidia/nemotron-3-super-120b-a12b'

python scripts/nebius_smoke_test.py
```

Then verify direct access to the escalation model:

```bash
export NEBIUS_BASE_URL='https://api.tokenfactory.nebius.com/v1'
export NEBIUS_MODEL_ID='nvidia/Nemotron-3-Ultra-550b-a55b'

python scripts/nebius_smoke_test.py
```

The smoke test makes a real inference request. It proves that the account can reach the selected model; it does **not** prove that adaptive routing has triggered that model inside the deployed MoveProof workflow.

Restore the primary model value in your shell if you continue testing locally:

```bash
export NEBIUS_MODEL_ID='nvidia/nemotron-3-super-120b-a12b'
export NEBIUS_ESCALATION_MODEL_ID='nvidia/Nemotron-3-Ultra-550b-a55b'
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

## 3. Apply database migrations

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

The Tavily feature introduced:

```text
003_evidence_events.sql
```

The destination-profile and robotics feature introduces:

```text
004_robotics_destination.sql
```

`004_robotics_destination.sql` adds the profile field used by migrations plus the robotics staging and destination structures required by `robot_calibration_v1`. Existing migrations remain backward compatible because an older row with no profile resolves to `customers_v1` in application logic.

`003_evidence_events.sql` adds nullable structured event fields to the existing audit-event table. Existing rows remain valid, and both migrations are applied through the normal ordered migration runner.

Adaptive model routing does not require its own database migration. It records routing information through the existing audit path.

Apply all migrations, and confirm `004_robotics_destination.sql` is recorded as applied, before starting a robotics-capable backend revision.

## 4. Store secrets

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

To rotate the Nebius key later:

```bash
printf '%s' "$NEW_NEBIUS_API_KEY" \
  | gcloud secrets versions add nebius-api-key --data-file=-
```

`NEBIUS_MODEL_ID` and `NEBIUS_ESCALATION_MODEL_ID` are model identifiers, not credentials. They belong in normal backend configuration and do not require Secret Manager entries.

`deploy/cloudrun.yaml` references the provider secrets. Cloud Run refuses to create a revision that references a Secret Manager secret that does not exist.

No Nebius or Tavily credential belongs in a `NEXT_PUBLIC_*` variable.

## 5. Service account and IAM

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

The production MoveProof service account already has Secret Manager access, so neither Tavily nor adaptive model routing requires an additional IAM role.

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

## 7. Build the backend

The backend image includes the Rust verifier.

Use the repository's Cloud Build configuration:

```bash
gcloud builds submit \
  --config deploy/cloudbuild.yaml .
```

The build compiles the backend image and Rust verifier according to the repository configuration and publishes the resulting image to Artifact Registry.

The build configuration currently publishes `backend:latest`. Do not deploy that mutable tag directly. Resolve it to the immutable digest produced by the build and pin Cloud Run to that digest:

```bash
IMAGE_LATEST="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/moveproof/backend:latest"
IMAGE_DIGEST=$(gcloud artifacts docker images describe "$IMAGE_LATEST" \
  --project="$GCP_PROJECT_ID" \
  --format='value(image_summary.digest)')
IMAGE_REF="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/moveproof/backend@$IMAGE_DIGEST"

printf 'Pinned backend image: %s\n' "$IMAGE_REF"
```

Do not replace the repository build path unless `deploy/cloudbuild.yaml` itself changes.

## 8. Configure and deploy Cloud Run

The production Cloud Run configuration is defined in:

```text
deploy/cloudrun.yaml
```

The model-related environment configuration should be:

```text
NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1
NEBIUS_MODEL_ID=nvidia/nemotron-3-super-120b-a12b
NEBIUS_ESCALATION_MODEL_ID=nvidia/Nemotron-3-Ultra-550b-a55b
```

The frontend origin should be:

```text
CORS_ORIGINS=https://moveproof-wiqi.vercel.app
```

`NEBIUS_API_KEY`, `DATABASE_URL`, and `TAVILY_API_KEY` must come from Secret Manager. Do not place secret values directly in the YAML.

Resolve the deployment placeholders:

```bash
sed \
  -e "s/PROJECT_ID/$GCP_PROJECT_ID/g" \
  -e "s/REGION/$GCP_REGION/g" \
  -e "s#REGION-docker.pkg.dev/PROJECT_ID/moveproof/backend:latest#$IMAGE_REF#g" \
  deploy/cloudrun.yaml \
  > /tmp/cloudrun.resolved.yaml
```

Inspect the resolved file before deploying:

```bash
grep -E \
  'CORS_ORIGINS|NEBIUS_BASE_URL|NEBIUS_MODEL_ID|NEBIUS_ESCALATION_MODEL_ID|TAVILY' \
  /tmp/cloudrun.resolved.yaml
```

Then deploy:

```bash
gcloud run services replace \
  /tmp/cloudrun.resolved.yaml \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT_ID"
```

Confirm that Cloud Run actually created or selected the intended revision and that the revision points at the pinned digest:

```bash
LATEST_REVISION=$(gcloud run services describe moveproof-backend \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT_ID" \
  --format='value(status.latestReadyRevisionName)')

echo "$LATEST_REVISION"

gcloud run revisions describe "$LATEST_REVISION" \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT_ID" \
  --format='value(spec.containers[0].image)'
```

Do not treat a deploy command that reused a mutable `:latest` reference as proof that the running backend changed. The revision and image check above is part of deployment verification.

The escalation model uses the same Nebius API key and the same Token Factory endpoint as the primary model. No additional secret is required.

Leaving `NEBIUS_ESCALATION_MODEL_ID` unset returns MoveProof to Super-only behavior.

## 9. Public backend access

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

## 10. Verify backend health

Resolve the backend URL:

```bash
BACKEND=$(gcloud run services describe moveproof-backend \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT_ID" \
  --format='value(status.url)')
```

Check the deployed backend:

```bash
curl -fsS "$BACKEND/health" | jq
```

A healthy production revision should report the established backend capabilities, including:

- overall status OK;
- PostgreSQL connected;
- Nebius configured;
- Rust verifier available;
- JSON evidence available;
- HTML evidence available;
- PDF evidence available; and
- External Evidence Check configured when the Tavily secret is present.

A health response showing that Nebius or Tavily is configured proves configuration presence only. It does not prove that an upstream runtime call succeeded.

Health alone does not prove upstream behavior. Use the runtime checks below after relevant deployment changes; the current production customer workflow, Tavily call, and automatic Super-to-Ultra routing have already completed those checks.

## 11. Verify adaptive model routing

Direct Ultra smoke testing proves model access. The production automatic routing path has already been exercised successfully; use this section to re-verify it after a backend revision that changes routing or model configuration.

Deploy the updated backend with both model IDs configured before re-running the check.

Then create a model-assisted migration that produces multiple independent validator concerns. The repository includes:

```text
backend/tests/fixtures/ambiguous_migration.csv
```

Upload that fixture through the production UI or API and note its migration ID.

Request the model profile through the normal workflow. Then inspect the proposal payload and the migration audit events.

The proposal response should include routing metadata. The audit log should contain:

```text
model_routing_decided
```

Inspect the events without assuming a particular metadata shape:

```bash
MIGRATION_ID=YOUR_MIGRATION_ID

curl -fsS \
  "$BACKEND/api/migrations/$MIGRATION_ID/events" \
  | jq
```

For a genuine escalation case, confirm that the event records the validator signals that caused escalation and that the selected second-pass model is:

```text
nvidia/Nemotron-3-Ultra-550b-a55b
```

Do not lower the routing threshold merely to make the fixture escalate. If the real Super proposal produces fewer than two validator concerns, inspect the actual validation output first. The routing policy should follow real validator semantics rather than a demo-specific expectation.

Also verify a routine model-assisted migration. It should remain on Super.

Finally, test the fallback:

1. remove `NEBIUS_ESCALATION_MODEL_ID` in a local or temporary environment;
2. confirm the model-assisted workflow still works with Super only; and
3. confirm the routing record states that escalation was unavailable rather than pretending no signal occurred.

The current production deployment has already satisfied this condition with a real migration that recorded `model_routing_decided`, `escalated: true`, and Nemotron 3 Ultra as the selected model. Re-run this check after routing-affecting deployment changes rather than assuming the previous result covers a new revision.

## 12. Deploy the frontend

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

Never place any of the following inside a `NEXT_PUBLIC_*` variable:

- Nebius API keys
- Tavily API keys
- database passwords
- cloud credentials
- private access tokens

The model IDs themselves are not secrets, but the frontend does not need them to call Nebius directly because all inference remains server-side.

## 13. CORS

The backend must allow the deployed Vercel origin:

```text
https://moveproof-wiqi.vercel.app
```

After changing CORS configuration, redeploy the backend.

Without the correct CORS origin, the browser can reach the public API over the network while still refusing frontend requests.

## 14. Runtime limits and routing controls

Important runtime limits include:

| Control | Configuration | Current/default value |
| --- | --- | --- |
| Upload size | `MAX_UPLOAD_BYTES` | 25 MB |
| Rows sampled for model reasoning | `MODEL_SAMPLE_ROWS` | 5 |
| Primary reasoning model | `NEBIUS_MODEL_ID` | `nvidia/nemotron-3-super-120b-a12b` |
| Escalation reasoning model | `NEBIUS_ESCALATION_MODEL_ID` | `nvidia/Nemotron-3-Ultra-550b-a55b` |
| Escalation policy | deterministic validator concerns | escalate at two or more concerns |
| External evidence timeout | `TAVILY_TIMEOUT_SECONDS` | 20 seconds |
| External evidence results | `TAVILY_MAX_RESULTS` | 5 |
| Request timeout | Cloud Run `timeoutSeconds` | 300 seconds |
| Cloud Run concurrency | `containerConcurrency` | 20 |
| Maximum Cloud Run instances | `maxScale` | 4 |
| File retention | Cloud Storage lifecycle | policy-defined |

Both model passes use the same bounded sample path. Selective escalation does not increase the number of source rows sent to the model.

External Evidence Check does not send full datasets, uploaded files, sampled model rows, or raw spreadsheet values to Tavily. Its server-side query builder accepts only approved metadata required to investigate the semantic question.

## 15. Verified CSV export

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

## 16. External Evidence Check

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
- bypass a commit gate; or
- write destination rows.

External evidence supports human review.

It is not a deterministic verification result.

## 17. Re-verify the Tavily runtime call

External Evidence Check has already been production-verified, but this procedure is useful after credential rotation or a backend revision.

Resolve the backend URL if needed:

```bash
BACKEND=$(gcloud run services describe moveproof-backend \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT_ID" \
  --format='value(status.url)')
```

Use an existing migration in the workspace:

```bash
MIGRATION_ID=YOUR_MIGRATION_ID
```

Then run a real External Evidence Check:

```bash
curl -fsS \
  -X POST \
  "$BACKEND/api/migrations/$MIGRATION_ID/external-evidence" \
  -H 'Content-Type: application/json' \
  -d '{
    "source_column": "customer_id",
    "destination_column": "customer_id",
    "question": "leading_zeros",
    "proposed_operation": "cast_to_integer"
  }' \
  | jq
```

A successful response should identify:

```text
provider: tavily
```

and return normalized advisory sources.

A successful HTTP response does not establish that every returned source is authoritative. The interface exposes source identity and URLs so a human can judge source quality.

The response must never contain `TAVILY_API_KEY`.

## 18. Delete and rollback behavior

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

## 19. Production verification workflow

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

Live Nebius inference has been verified separately with the Super model.

Direct Token Factory access to the Ultra model has also been verified separately.

Tavily External Evidence Check has been verified through a real production runtime call.

Adaptive Super-to-Ultra routing has been verified end to end in production. Robotics is a separate production claim, verified through the robotics checks below on the deployed revision.

### Robotics production verification

On the deployed robotics-capable revision:

1. `GET /api/schema/profiles` must expose `customers_v1` and `robot_calibration_v1`, with `customers_v1` remaining the default for backward compatibility.
2. Run `robot_calibration_clean.csv` through `robot_calibration_v1`. The full persisted source must deterministically prove canonical ISO dates, so the plan should carry `date_format_policy=iso`, no Day first / Month first decision should appear, the model-assisted path should stay on Super, and the migration should then stage, verify, export, commit, produce evidence, and roll back normally.
3. Run `robot_calibration_ambiguous.csv`. Its ambiguous date plus mixed decimal convention should surface two deterministic concerns, exercise Super → Ultra when escalation is configured, and keep approval blocked until the reviewer explicitly resolves date and decimal policy.
4. Run `robot_calibration_multi_joint.csv` and confirm repeated `robot_id` values with different joints are accepted under composite identity `(robot_id, joint_name)`.
5. Confirm evidence names the destination profile and preserves the limitation that data verification is not hardware-safety certification.
6. Re-run a customer migration to prove profile isolation and backward compatibility.

The current production deployment has passed these robotics checks. Repeat them after changes that can affect planning, routing, execution, verification, export, commit, destination identity, or rollback before renewing the production-verification claim for a new revision.

## 20. Local validation before deployment

Before a robotics-capable backend deployment, run the backend suite from `backend/`:

```bash
source .venv/bin/activate

make migrate
pytest -m "not database" -v
DATABASE_URL="postgresql://moveproof:moveproof_local_only@localhost:5433/moveproof" \
  pytest -m database -v
pytest tests/test_model_routing.py tests/test_date_policy_inference.py tests/test_robotics_workflow.py tests/test_robotics_verification.py tests/test_destination_profiles.py -v -m "not database"
make rust-test
```

If the full runnable suite is available in the local environment, run it as well:

```bash
pytest -v
```

Then, from the repository root:

```bash
npm run typecheck
npm run lint
rm -rf .next
npm run build
git diff --check
```

Do not deploy if required database migrations, backend tests, routing tests, frontend type checking, or the production build fail.

Model-routing tests prove the routing rule and safety boundaries. The automatic Super-to-Ultra path and the robotics clean, ambiguous, and multi-joint workflows have also been exercised on the deployed production stack.

Mocked Tavily tests prove application behavior around the provider boundary. They do not replace a real provider runtime check.

## 21. Cost controls

Actual costs depend on provider pricing, usage, region, account configuration, promotions, and credits.

At demonstration scale:

- Cloud SQL is generally the most persistent infrastructure cost.
- Cloud Run usage is typically small because the service scales to zero.
- Cloud Storage usage is typically small.
- Nebius Token Factory usage depends on token consumption.
- Nemotron 3 Super handles routine model-assisted proposals.
- Nemotron 3 Ultra is called only when deterministic validation detects two or more concerns, reducing unnecessary use of the larger reasoning model.
- Tavily usage depends on the provider plan and the number of External Evidence Checks.

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

## 22. Application deployment rollback

Inspect Cloud Run revisions:

```bash
gcloud run revisions list \
  --service=moveproof-backend \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT_ID"
```

Route traffic back to an earlier revision:

```bash
gcloud run services update-traffic moveproof-backend \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT_ID" \
  --to-revisions=PREVIOUS_REVISION=100
```

Rolling Cloud Run back to an earlier application revision does not undo data already committed by a migration.

Migration rollback must be performed explicitly through MoveProof.

If an adaptive-routing deployment has an operational problem, rolling back to the previous Cloud Run revision also removes the new routing configuration from the active service while leaving committed migration data untouched.

## 23. Production readiness checklist

Before treating the robotics-capable deployment as fully verified, confirm:

1. The Vercel production URL loads successfully.
2. The frontend uses the intended Cloud Run backend.
3. `/health` reports PostgreSQL connected.
4. `/health` reports the Rust verifier available.
5. JSON, HTML, and PDF evidence capabilities are available.
6. A real Super inference request succeeds through Nebius Token Factory.
7. Direct runtime access to `nvidia/Nemotron-3-Ultra-550b-a55b` succeeds.
8. `NEBIUS_BASE_URL`, `NEBIUS_MODEL_ID`, and `NEBIUS_ESCALATION_MODEL_ID` match the intended production values.
9. The known production automatic-routing check remains documented: a real migration produced two deterministic concerns, triggered Ultra, and recorded `model_routing_decided` with `escalated: true`.
10. `003_evidence_events.sql` and `004_robotics_destination.sql` are applied to the production database.
11. `tavily-api-key` exists in Secret Manager and a real External Evidence Check still returns advisory sources without exposing the credential.
12. The running Cloud Run revision points at the intended immutable backend image digest.
13. `GET /api/schema/profiles` exposes only the expected allowlisted profiles and reports `customers_v1` as the backward-compatible default.
14. A customer migration still stages, verifies, exports, commits, produces evidence, and rolls back as before.
15. `robot_calibration_clean.csv` completes the robotics path and remains on Super when the proposal carries fewer than two concerns.
16. `robot_calibration_ambiguous.csv` surfaces date and decimal ambiguity, triggers Ultra when the two-concern rule is met, and cannot be approved until the human decisions are supplied.
17. `robot_calibration_multi_joint.csv` verifies composite identity `(robot_id, joint_name)` without treating repeated robot IDs as duplicates.
18. Leading-zero robot IDs such as `0017` remain strings, and firmware text such as `3.08` is not numerically coerced.
19. Robotics evidence names `robot_calibration_v1`, includes routing and approval context, and states that migration verification is not hardware-safety certification.
20. Robotics verified CSV is generated only from stored verified data.
21. Robotics commit remains fail-closed on mandatory verification failures or destination conflicts.
22. Robotics rollback removes only rows written by that migration.
23. Running External Evidence Check does not alter verification state or commit eligibility for either destination profile.
24. Frontend type checking, linting, and production build complete successfully.
25. Backend non-database and database/API suites are green.
26. Rust verifier tests are green.
27. `git diff --check` is clean.
28. GitHub CI is green.

The core customer workflow, Tavily External Evidence Check, and automatic Super → Ultra reasoning escalation are already production-verified.

`robot_calibration_v1` is currently **production-verified end to end** on the deployed robotics-capable revision. The relevant production checks, including the deployed database migration, immutable backend revision, clean path, ambiguous Super-to-Ultra path, composite identity, exact verified export, fail-closed destination conflict behavior, evidence, commit, and rollback, have been exercised. Repeat the checklist after relevant implementation or infrastructure changes.