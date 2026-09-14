# Deployment

MoveProof is deployed as a split production architecture:

- Next.js frontend on Vercel;
- FastAPI backend on Google Cloud Run;
- PostgreSQL on Google Cloud SQL;
- private object storage on Google Cloud Storage;
- Rust verifier packaged with the backend;
- model inference through Nebius Token Factory.

## Current Production Deployment

Frontend:

`https://moveproof-wiqi.vercel.app`

Backend:

`https://moveproof-backend-579259634424.asia-southeast2.run.app`

Production model:

`nvidia/nemotron-3-super-120b-a12b`

Nebius Token Factory base URL:

`https://api.tokenfactory.nebius.com/v1`

The deployed application has successfully completed a full browser workflow including:

upload → plan approval → staging → verification failure → repair → rerun from original source bytes → verification pass → commit → evidence generation.

A live Nebius Token Factory inference call has also been verified separately using the production model.

The sections below document how the stack is structured, reproduced, configured, and verified.

## What Runs Where

| Component | Host | Responsibility |
| --- | --- | --- |
| Next.js frontend | Vercel | Public interface and migration workspace |
| FastAPI backend | Google Cloud Run | Workflow orchestration and API |
| Rust verifier | Backend container | Independent canonical reconciliation |
| PostgreSQL | Google Cloud SQL | Workflow state, staging, verification records, and destination data |
| Object storage | Google Cloud Storage | Private cloud storage |
| Model inference | Nebius Token Factory | NVIDIA model inference |

The production NVIDIA model is:

`nvidia/nemotron-3-super-120b-a12b`

Google Cloud performs no model inference in this architecture.

Vertex AI and Gemini are deliberately not part of the MoveProof inference path.

## Architecture Principle

MoveProof follows this boundary:

> AI proposes. Validated code executes. Independent evidence decides. Humans approve ambiguity.

Nebius provides model reasoning.

The model does not directly execute SQL, shell commands, Python, or arbitrary application code.

Transformation execution remains deterministic and constrained by the supported operation allowlist.

Verification is performed separately from planning.

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