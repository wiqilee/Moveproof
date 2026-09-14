# Security Policy

## Reporting a Vulnerability

MoveProof is a hackathon project maintained by a single developer.

If you discover a security vulnerability, please avoid disclosing exploitable details in a public GitHub issue.

Use GitHub's private vulnerability reporting feature if it is available for this repository. If private reporting is unavailable, contact the maintainer through a private channel rather than publishing credentials, personal data, exploit details, or other sensitive information publicly.

Never include real personal data, API keys, database passwords, access tokens, private URLs, or other credentials in a vulnerability report.

## Scope

MoveProof is a full-stack data migration application composed of:

- a Next.js frontend;
- a FastAPI backend;
- PostgreSQL;
- a Rust verification component;
- Nebius Token Factory for model inference.

The production deployment uses all of these components.

Local development can run without live model credentials, and the Rust verifier may also be unavailable in some local environments. When the Rust verifier is unavailable, canonical reconciliation is reported as `not verified`; it is never reported as passed.

MoveProof processes uploaded spreadsheets that may contain sensitive information. Depending on the workflow, the system stores or processes:

- original uploaded source bytes;
- parsed source rows;
- approved transformation plans;
- staged transformed rows;
- verification results;
- audit events;
- commit and rollback records;
- generated evidence reports.

Treat every deployment as capable of handling sensitive data, even when the product is being demonstrated with synthetic fixtures.

## Security Principles

### Uploaded files are untrusted

CSV and XLSX files are treated as untrusted input.

The application validates file type, file size, structure, and parsing behavior before data enters the migration workflow.

Spreadsheet formulas are never evaluated by MoveProof.

Formula-like values are preserved as uploaded data and are escaped or neutralized only when required by an output format.

### Model output is untrusted

Model output is treated as untrusted input.

The NVIDIA model served through Nebius Token Factory proposes mappings, identifies risks, assists with failure diagnosis, and can propose repairs. It does not directly control the executor.

Every proposed transformation must pass deterministic validation against the supported operation allowlist.

The model does not emit or execute:

- SQL;
- shell commands;
- arbitrary Python;
- arbitrary application code.

A model proposal cannot become executable merely because the model produced it.

### Human approval does not bypass validation

Human approval applies only to validated plan versions.

Lossy transformations require explicit acknowledgement where applicable, and approvals are recorded against the relevant plan and contract.

Human approvals are audit records. They are not cryptographic signatures.

### Secrets never reach the browser

Backend secrets are never exposed through `NEXT_PUBLIC_*` variables.

Production credentials such as:

- `NEBIUS_API_KEY`;
- database credentials;
- cloud credentials;

remain on trusted backend infrastructure.

The Nebius API key is stored server-side and is never included in frontend bundles.

### Database access is constrained

Database access uses parameterized SQL and least-privilege credentials.

Workflow state, verification results, commit records, and destination writes are enforced server-side.

A client-side control cannot bypass the database-backed commit gate.

### Full datasets are not sent to the model

MoveProof does not send an entire uploaded dataset to Nebius Token Factory.

The model receives only the information needed for its reasoning task, including:

- schema information;
- a limited sample of source rows.

The current default sample limit is controlled by `MODEL_SAMPLE_ROWS` and is set to five rows in the production configuration.

Field values are not written into model audit logs.

### Audit logs avoid sensitive field values

Audit events record workflow actions, identifiers, plan versions, outcomes, and relevant metadata without intentionally logging uploaded field values.

This provides operational traceability while reducing unnecessary data exposure.

### HTML output is escaped

Untrusted values rendered in HTML evidence reports are escaped.

A value containing markup such as a `<script>` tag is rendered as text rather than interpreted as executable HTML.

### Verification is independent from planning

The component that proposes a transformation does not decide whether the migration is correct.

Verification is performed separately against the staged result.

MoveProof distinguishes four verification outcomes:

- `passed`;
- `failed`;
- `review required`;
- `not verified`.

`Not verified` never means `passed`.

### Commit fails closed

A migration cannot be committed merely because execution completed.

The commit gate evaluates stored workflow and verification records before destination rows are written.

If mandatory checks fail, remain unresolved, are missing, or no longer correspond to the approved execution contract, commit is refused.

Destination conflicts also fail closed.

### Rollback is explicit

A committed migration cannot be deleted directly.

The required workflow is:

1. explicitly roll back the committed migration;
2. confirm that rollback succeeds;
3. delete the migration record only afterward.

`DELETE` does not silently remove committed destination rows.

This keeps destructive destination changes explicit and auditable.

### Original source data remains authoritative

Repair does not attempt to reconstruct destroyed information from damaged transformed values.

When a revised plan is executed, MoveProof reparses the stored original upload.

For example, if an integer conversion changes `00127` to `127`, the repair workflow does not attempt to infer the missing zero from `127`. It reruns the corrected plan against the original source bytes.

## Production Boundaries

The deployed architecture separates responsibilities as follows:

- Vercel hosts the Next.js frontend.
- Google Cloud Run hosts the FastAPI backend.
- Google Cloud SQL hosts PostgreSQL.
- Google Cloud Storage provides private object storage.
- The Rust verifier runs with the backend.
- Nebius Token Factory provides model inference.
- The production model is `nvidia/nemotron-3-super-120b-a12b`.

Google Cloud does not provide model inference for MoveProof.

Vertex AI and Gemini are not part of the production inference path.

## Data Handling

Do not upload production data unless the deployment operator has reviewed the environment, retention policy, access controls, and legal requirements applicable to that data.

The public hackathon deployment should be treated as a demonstration environment unless explicitly operated under a separate production data policy.

Synthetic fixtures are the recommended data source for demonstrations and public testing.

## Dependency and Infrastructure Security

MoveProof relies on third-party runtime and build dependencies.

Before a production release:

- review dependency alerts;
- review GitHub Actions results;
- review cloud IAM permissions;
- confirm backend secrets are stored outside the repository;
- confirm `.env.local` and other secret-bearing files are ignored;
- confirm the deployed frontend bundle does not contain backend credentials;
- verify Cloud Run and Cloud SQL configuration;
- verify the live health endpoint.

Do not use automated dependency upgrade commands that force breaking changes without reviewing and retesting the application.

## Security Limitations

MoveProof reduces specific classes of migration risk. It does not claim to detect every possible semantic or business-rule error.

A successful verification means the invariants defined by the approved migration contract were satisfied.

It does not mean that every possible property of the dataset was proven correct.

Evidence reports explicitly preserve the distinction between what was checked and what was not verified.