-- MoveProof schema.
--
-- Three namespaces with different trust levels:
--   moveproof  control plane: migrations, plans, runs, checks, approvals
--   staging    transformed rows awaiting verification, never user visible
--   public     the destination the operator actually cares about
--
-- Commit moves rows from staging into public inside one transaction. Nothing
-- reaches public any other way.

CREATE SCHEMA IF NOT EXISTS moveproof;
CREATE SCHEMA IF NOT EXISTS staging;

-- ---------------------------------------------------------------- destination
CREATE TABLE IF NOT EXISTS public.customers (
    customer_id  VARCHAR(20)    PRIMARY KEY,
    full_name    VARCHAR(255)   NOT NULL,
    email        VARCHAR(255)   NOT NULL UNIQUE,
    signup_date  DATE           NOT NULL,
    balance      NUMERIC(12,2)  NOT NULL DEFAULT 0,
    region       VARCHAR(50),
    migration_id UUID           NOT NULL,
    committed_at TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------- control plane
CREATE TABLE IF NOT EXISTS moveproof.migrations (
    id            UUID PRIMARY KEY,
    filename      TEXT        NOT NULL,
    checksum      TEXT        NOT NULL,
    byte_size     BIGINT      NOT NULL,
    encoding      TEXT        NOT NULL,
    delimiter     TEXT        NOT NULL,
    source_columns TEXT[]     NOT NULL,
    row_count     INTEGER     NOT NULL,
    state         TEXT        NOT NULL DEFAULT 'draft',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The original uploaded rows, kept verbatim.
--
-- This table is what makes an honest repair possible. When an integer cast has
-- destroyed a leading zero, the corrected rerun reads from here rather than
-- from the damaged staged value, because 127 cannot yield 00127.
CREATE TABLE IF NOT EXISTS moveproof.source_rows (
    migration_id UUID    NOT NULL REFERENCES moveproof.migrations(id) ON DELETE CASCADE,
    row_number   INTEGER NOT NULL,
    values       JSONB   NOT NULL,
    PRIMARY KEY (migration_id, row_number)
);

-- A plan version is immutable. A revision is a new row, never an update.
CREATE TABLE IF NOT EXISTS moveproof.plans (
    migration_id UUID        NOT NULL REFERENCES moveproof.migrations(id) ON DELETE CASCADE,
    version      INTEGER     NOT NULL,
    body         JSONB       NOT NULL,
    proposed_by  TEXT        NOT NULL,
    approved_by  TEXT,
    approved_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (migration_id, version)
);

CREATE TABLE IF NOT EXISTS moveproof.runs (
    id             UUID PRIMARY KEY,
    migration_id   UUID        NOT NULL REFERENCES moveproof.migrations(id) ON DELETE CASCADE,
    plan_version   INTEGER     NOT NULL,
    idempotency_key TEXT       NOT NULL,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at    TIMESTAMPTZ,
    accounting     JSONB,
    applied_operations JSONB,
    -- The same approved plan replayed with the same key returns the first run
    -- rather than staging the rows a second time.
    UNIQUE (migration_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS moveproof.checks (
    run_id     UUID        NOT NULL REFERENCES moveproof.runs(id) ON DELETE CASCADE,
    check_id   TEXT        NOT NULL,
    name       TEXT        NOT NULL,
    expected   TEXT        NOT NULL,
    observed   TEXT        NOT NULL,
    status     TEXT        NOT NULL,
    evidence   JSONB       NOT NULL DEFAULT '[]'::jsonb,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, check_id)
);

CREATE TABLE IF NOT EXISTS moveproof.approvals (
    id           BIGSERIAL PRIMARY KEY,
    migration_id UUID        NOT NULL REFERENCES moveproof.migrations(id) ON DELETE CASCADE,
    plan_version INTEGER     NOT NULL,
    action       TEXT        NOT NULL,
    approved_by  TEXT        NOT NULL,
    approved_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS moveproof.events (
    id           BIGSERIAL PRIMARY KEY,
    migration_id UUID        NOT NULL REFERENCES moveproof.migrations(id) ON DELETE CASCADE,
    run_id       UUID,
    level        TEXT        NOT NULL,
    message      TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- staging
-- Deliberately permissive. Staging holds what the approved plan produced,
-- including values the destination would reject, so the verifier can compare
-- them against the source and report the difference.
CREATE TABLE IF NOT EXISTS staging.customers (
    run_id       UUID    NOT NULL REFERENCES moveproof.runs(id) ON DELETE CASCADE,
    row_number   INTEGER NOT NULL,
    source_key   TEXT    NOT NULL,
    values       JSONB   NOT NULL,
    disposition  TEXT    NOT NULL,
    reason       TEXT,
    PRIMARY KEY (run_id, row_number)
);

CREATE INDEX IF NOT EXISTS staging_customers_disposition
    ON staging.customers (run_id, disposition);

CREATE INDEX IF NOT EXISTS moveproof_events_migration
    ON moveproof.events (migration_id, created_at);
