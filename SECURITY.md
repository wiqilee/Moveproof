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
- a server-side destination-profile registry for allowlisted customer and robot-calibration contracts;
- a Rust verification component;
- Nebius Token Factory for NVIDIA model inference;
- an optional Tavily integration for External Evidence Check.

The current production MoveProof core uses the frontend, backend, PostgreSQL, Rust verifier, and Nebius Token Factory. The `robot_calibration_v1` database migration and allowlisted destination-profile infrastructure are deployed, and the robotics workflow has been exercised end to end in production with clean, ambiguous, and multi-joint fixtures. The production claim covers migration integrity under the declared contract; it does not certify calibration quality, robot behavior, or physical safety.

External Evidence Check is part of the active production path only after its database migration, backend configuration, Secret Manager credential, and deployed Tavily runtime call have been verified. The current production deployment has completed those checks.

Local development can run without live model or external-evidence credentials.

The Rust verifier may also be unavailable in some local environments. When the Rust verifier is unavailable, canonical reconciliation is reported as `not verified`; it is never reported as passed.

MoveProof processes uploaded spreadsheets that may contain sensitive information. Depending on the workflow, the system stores or processes:

- original uploaded source bytes;
- parsed source rows;
- destination-profile selection and contract metadata;
- approved transformation plans;
- staged transformed rows;
- verification results;
- audit events;
- commit and rollback records;
- generated evidence reports.

Treat every deployment as capable of handling sensitive data, even when the product is being demonstrated with synthetic fixtures.

## Security Principles

### Uploaded files are untrusted

CSV, TSV, XLSX, and XLSM files are treated as untrusted input.

The application validates file type, file size, structure, and parsing behavior before data enters the migration workflow.

Spreadsheet formulas are never evaluated by MoveProof.

Formula-like values are preserved as uploaded data and are escaped or neutralized when required by an output format that could otherwise interpret them.

### Model output is untrusted

Model output is treated as untrusted input.

The NVIDIA models served through Nebius Token Factory propose column mappings and attach a risk note to each mapping. Failure diagnosis and repair proposals are produced by deterministic backend code, not by a model. The models do not directly control the executor.

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
- `TAVILY_API_KEY`;
- database credentials;
- cloud credentials;

remain on trusted backend infrastructure.

Provider credentials are never included in frontend bundles, normal API responses, audit events, or intentionally logged application output.

### Provider errors are sanitized

Errors returned by external providers are not blindly passed through to clients.

Provider exception text can contain request context or implementation details, so MoveProof converts upstream failures into controlled application errors before returning them through the public API.

Credentials must never be returned as part of an error message.

### Database access is constrained

Database access uses parameterized SQL and least-privilege credentials.

Workflow state, verification results, commit records, rollback state, and destination writes are enforced server-side.

A client-side control cannot bypass the database-backed commit gate.

### Destination profiles are server allowlisted

Destination profile IDs supplied by a client are resolved through the server-side profile registry.

A profile ID is never treated as an arbitrary SQL table or column identifier. Destination table names, staging table names, key columns, verification fields, and schema definitions come from the allowlisted registry, and an unknown profile is refused.

For `robot_calibration_v1`, row identity is the composite key `(robot_id, joint_name)`. `robot_id` is also checked separately as an identifier-preservation field so a value such as `0017` cannot silently become `17` merely because the destination accepts both strings.

### Full datasets are not sent to the model

MoveProof does not send an entire uploaded dataset to Nebius Token Factory.

The model receives only the information needed for its reasoning task, including:

- schema information;
- a limited sample of source rows.

The current default sample limit is controlled by `MODEL_SAMPLE_ROWS` and is set to five rows in the production configuration.

This model boundary does not prevent deterministic backend code from inspecting the complete persisted source locally. Full-source checks do not enlarge the model prompt. For example, a model-assisted `PARSE_DATE` mapping receives an automatic ISO policy only when every non-empty value in the relevant stored source column is a canonical `YYYY-MM-DD` calendar date. Any other representation leaves the date policy undecided for human review.

Field values are not intentionally written into model audit logs.

### External Evidence Check is metadata-only

External Evidence Check has a narrower data boundary than model-assisted planning.

MoveProof does not send uploaded files, full datasets, sampled rows, or raw spreadsheet values to Tavily.

The server constructs the request from approved metadata needed to investigate a semantic question, such as:

- a source column name;
- a destination column name;
- declared or inferred type information;
- the proposed operation;
- a question selected from an allowlisted set.

The query is composed server-side.

The External Evidence query boundary does not accept arbitrary reviewer free text.

This design reduces the risk that names, email addresses, identifiers, row values, or other uploaded content are accidentally sent to the external evidence provider.

### External evidence is advisory

Tavily results are advisory evidence for human review.

External Evidence Check cannot:

- modify source data;
- modify staged data;
- rewrite an approved plan;
- approve a plan;
- change a verification result;
- change migration state;
- change commit eligibility;
- bypass a verification gate;
- write destination rows.

A source returned by Tavily is not automatically treated as authoritative merely because it was retrieved successfully.

The interface preserves source identity and URLs so the reviewer can judge the evidence.

### Audit logs avoid sensitive field values

Audit events record workflow actions, identifiers, plan versions, outcomes, and relevant metadata without intentionally logging uploaded field values.

External Evidence Check audit metadata records the review action and safe structural metadata rather than uploaded row contents.

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

External evidence does not alter any of these outcomes.

### Robotics verification is not hardware safety certification

A passed `robot_calibration_v1` migration means the approved data invariants held across the migration. It does not establish that a calibration value is physically correct, that a robot is safe to operate, or that MoveProof evaluated hardware behavior.

MoveProof does not command robots. Its robotics scope is the integrity and auditability of calibration data as that data moves between structured systems.

### Commit fails closed

A migration cannot be committed merely because execution completed.

The commit gate evaluates stored workflow and verification records before destination rows are written.

If mandatory checks fail, remain unresolved, are missing, or no longer correspond to the approved execution contract, commit is refused.

Destination conflicts also fail closed.

External evidence cannot override the commit gate.

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

For example, if an integer conversion changes `00127` to `127`, the repair workflow does not attempt to infer the missing zero from `127`.

It reruns the corrected plan against the original source bytes.

## Production Boundaries

The deployed architecture separates responsibilities as follows:

- Vercel hosts the Next.js frontend.
- Google Cloud Run hosts the FastAPI backend.
- Google Cloud SQL hosts PostgreSQL.
- Google Cloud Storage provides private object storage.
- The Rust verifier runs with the backend.
- Nebius Token Factory provides NVIDIA model inference.
- Tavily provides external public-reference discovery when External Evidence Check is enabled.

Adding `robot_calibration_v1` does not add a provider, secret, browser credential, IAM role, or model authority. It adds a server-defined data contract and destination tables inside the existing trust boundaries.

The production NVIDIA models are:

- `nvidia/nemotron-3-super-120b-a12b`, the default for every model-assisted proposal;
- `nvidia/Nemotron-3-Ultra-550b-a55b`, called only when deterministic validation finds two or more interpretation concerns. It receives the same bounded input and gains no additional authority.

Google Cloud does not provide model inference for MoveProof.

Vertex AI and Gemini are not part of the production inference path.

Nebius and Tavily have different trust boundaries.

Nebius assists with mapping and reasoning over a deliberately limited sample.

Tavily receives metadata-only External Evidence queries.

Neither provider can directly execute transformations, determine deterministic verification outcomes, or authorize a commit.

## Data Handling

Do not upload production data unless the deployment operator has reviewed the environment, retention policy, access controls, third-party data boundaries, and legal requirements applicable to that data.

The public hackathon deployment should be treated as a demonstration environment unless explicitly operated under a separate production data policy.

Synthetic fixtures are the recommended data source for demonstrations and public testing.

Robot calibration datasets can be operationally sensitive even when they contain no personal data. Treat robot IDs, firmware identifiers, sensor-frame names, offsets, ratios, and calibration dates as sensitive operational data unless the deployment operator has explicitly classified them otherwise.

## Third-Party Data Boundaries

MoveProof uses external services for narrowly defined purposes.

### Nebius Token Factory

Nebius receives model-assistance requests containing schema information and a limited sample of source rows.

It does not receive the full uploaded dataset.

### Tavily

When External Evidence Check is enabled, Tavily receives only the server-generated metadata query required for external semantic investigation.

It does not receive uploaded files, full datasets, sampled spreadsheet rows, or intentionally supplied personal field values.

External-provider behavior remains subject to the provider's own infrastructure and policies, so operators should review those policies before using MoveProof with sensitive production data.

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
- verify the live health endpoint;
- verify Nebius through a real runtime inference call;
- verify Tavily through a real runtime External Evidence Check if the feature is enabled;
- confirm provider credentials do not appear in API responses or audit output;
- confirm database migrations include `004_robotics_destination.sql` before enabling `robot_calibration_v1` in production;
- confirm `/api/schema/profiles` exposes only the intended allowlisted profiles;
- after changes that affect the robotics workflow, re-run the clean, ambiguous, and multi-joint fixtures end to end before renewing the production-verification claim.

Do not use automated dependency upgrade commands that force breaking changes without reviewing and retesting the application.

## Security Limitations

MoveProof reduces specific classes of migration risk. It does not claim to detect every possible semantic, business-rule, or security error.

A successful verification means the invariants defined by the approved migration contract were satisfied.

It does not mean that every possible property of the dataset was proven correct. For robotics, it also does not mean that MoveProof certified calibration quality, robot behavior, or physical safety.

External evidence can help a reviewer investigate semantic ambiguity, but it is not proof that a proposed interpretation is correct.

Search results can be incomplete, outdated, conflicting, or incorrect.

Evidence reports preserve the distinction between:

- what was checked;
- what passed;
- what failed;
- what requires review;
- what was not verified.

That distinction is intentional and forms part of MoveProof's security and verification model.