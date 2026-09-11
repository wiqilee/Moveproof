-- Batch 3 corrections.
--
-- Four things this migration makes possible:
--   1. Commits that meet an existing destination key fail closed.
--   2. Approvals bind to an immutable plan version and a contract hash.
--   3. Execution evidence survives storage instead of being assumed empty.
--   4. The original uploaded bytes are kept, not just the parsed rows.

-- ------------------------------------------------- 4. original source bytes
--
-- Parsed rows are a derived artefact. Keeping the bytes means a checksum can be
-- recomputed later and a corrupted or substituted source can be detected.
CREATE TABLE IF NOT EXISTS moveproof.source_files (
    migration_id UUID PRIMARY KEY REFERENCES moveproof.migrations(id) ON DELETE CASCADE,
    filename     TEXT        NOT NULL,
    content_type TEXT        NOT NULL,
    byte_size    BIGINT      NOT NULL,
    checksum     TEXT        NOT NULL,
    content      BYTEA,
    storage_uri  TEXT,
    uploaded_by  TEXT        NOT NULL DEFAULT 'operator',
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Either the bytes are here or they are in object storage. Never neither,
    -- because then nothing authoritative exists to repair from.
    CONSTRAINT source_content_present
        CHECK (content IS NOT NULL OR storage_uri IS NOT NULL)
);

-- ------------------------------------------------- 3. execution evidence
CREATE TABLE IF NOT EXISTS moveproof.transform_errors (
    id           BIGSERIAL PRIMARY KEY,
    run_id       UUID    NOT NULL REFERENCES moveproof.runs(id) ON DELETE CASCADE,
    row_number   INTEGER NOT NULL,
    source_key   TEXT    NOT NULL,
    field_name   TEXT    NOT NULL,
    source_value TEXT    NOT NULL,
    reason       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS transform_errors_run ON moveproof.transform_errors (run_id);

-- ------------------------------------------------- 2. approval binding
ALTER TABLE moveproof.plans
    ADD COLUMN IF NOT EXISTS contract_hash    TEXT,
    ADD COLUMN IF NOT EXISTS acknowledgements TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS conflict_policy  TEXT   NOT NULL DEFAULT 'fail_closed';

ALTER TABLE moveproof.runs
    ADD COLUMN IF NOT EXISTS contract_hash TEXT,
    ADD COLUMN IF NOT EXISTS contract_body JSONB,
    ADD COLUMN IF NOT EXISTS verified_at   TIMESTAMPTZ;

-- A run must name the plan version it executed, and that version has to exist.
ALTER TABLE moveproof.runs
    DROP CONSTRAINT IF EXISTS runs_plan_version_fk;
ALTER TABLE moveproof.runs
    ADD CONSTRAINT runs_plan_version_fk
    FOREIGN KEY (migration_id, plan_version)
    REFERENCES moveproof.plans (migration_id, version)
    ON DELETE CASCADE;

-- ------------------------------------------------- 1. commit reconciliation
CREATE TABLE IF NOT EXISTS moveproof.commits (
    id             BIGSERIAL PRIMARY KEY,
    migration_id   UUID        NOT NULL REFERENCES moveproof.migrations(id) ON DELETE CASCADE,
    run_id         UUID        NOT NULL REFERENCES moveproof.runs(id) ON DELETE CASCADE,
    expected_rows  INTEGER     NOT NULL,
    written_rows   INTEGER     NOT NULL,
    skipped_rows   INTEGER     NOT NULL DEFAULT 0,
    conflict_policy TEXT       NOT NULL,
    committed_by   TEXT        NOT NULL,
    committed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A commit row may only exist when the numbers add up. The reconciliation
    -- is therefore enforced by the database, not only by the code path.
    CONSTRAINT commit_reconciles CHECK (written_rows + skipped_rows = expected_rows),
    -- One successful commit per run. A repeated attempt collides here rather
    -- than writing a second batch.
    CONSTRAINT one_commit_per_run UNIQUE (run_id)
);
