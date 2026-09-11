# Security policy

## Reporting

This is a hackathon project maintained by one person. If you find a security
issue, open a GitHub issue describing the problem. Do not include real personal
data or credentials in the report.

## Scope

MoveProof is a full stack application: a Next.js frontend, a FastAPI backend,
PostgreSQL, an optional Rust verifier, and an optional Nebius Token Factory
integration.

It handles uploaded spreadsheets, which may contain sensitive data. It stores
the original bytes, parsed rows, staged transformations and an audit trail.
Treat a deployment as handling real data even when demonstrating with the
synthetic generator.

## Principles carried into the backend

- Uploaded files are untrusted. Type, size and structure are validated before
  parsing, and parsing runs under resource limits.
- Model output is untrusted. It is validated against an operation allowlist
  before it reaches a human or an executor. The model never emits SQL, shell
  commands or executable code.
- Secrets never reach the browser. No credential carries a `NEXT_PUBLIC_`
  prefix.
- Database access uses parameterised statements and least privilege
  credentials, scoped separately for staging and destination schemas.
- Full datasets are never sent to a model. Only a schema summary and a small
  sample leave the backend, and the interface states what is being sent.
- Audit logs record actions and plan versions without leaking field values.
- Formula-like cell values are stored exactly as uploaded and never evaluated.
  They are neutralised only when written back out, so the stored value stays
  faithful to the source.
- HTML report output escapes every value, so a script tag inside a cell
  appears as text rather than markup.
- Commit is gated in the database layer against stored records and fails
  closed on a destination conflict.
