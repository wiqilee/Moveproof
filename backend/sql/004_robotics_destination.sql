-- Robotics calibration destination.
--
-- Entirely additive. Nothing here alters the meaning of an existing table, no
-- existing row changes, and every customer migration continues to resolve
-- exactly as before.
--
-- Three things are added:
--
--   1. a destination_profile column on moveproof.migrations, nullable, so
--      every migration recorded before profiles existed keeps working and
--      resolves to the customer profile in application code;
--   2. staging.robot_calibrations, mirroring staging.customers so the staging
--      lifecycle is identical rather than special-cased;
--   3. public.robot_calibrations, the real destination.
--
-- Customer and robotics rows never share a table. A robotics migration writes
-- only to public.robot_calibrations, and a customer migration only to
-- public.customers.

-- 1. Which destination a migration targets.
--
-- Deliberately nullable with no default. NULL means "recorded before this
-- column existed", which app.domain.profiles.resolve() treats as the customer
-- profile. Backfilling would assert something about those rows that the data
-- itself already implies, and a default would hide the distinction.
ALTER TABLE moveproof.migrations
    ADD COLUMN IF NOT EXISTS destination_profile TEXT;

CREATE INDEX IF NOT EXISTS moveproof_migrations_profile
    ON moveproof.migrations (destination_profile);

-- 2. Robotics staging, isolated from customer staging.
--
-- Same shape as staging.customers on purpose: the executor and verifier read
-- staged rows through one code path, and a different shape here would mean
-- writing a second one.
CREATE TABLE IF NOT EXISTS staging.robot_calibrations (
    run_id       UUID    NOT NULL REFERENCES moveproof.runs(id) ON DELETE CASCADE,
    row_number   INTEGER NOT NULL,
    source_key   TEXT    NOT NULL,
    values       JSONB   NOT NULL,
    disposition  TEXT    NOT NULL,
    reason       TEXT,
    PRIMARY KEY (run_id, row_number)
);

CREATE INDEX IF NOT EXISTS staging_robot_calibrations_disposition
    ON staging.robot_calibrations (run_id, disposition);

-- 3. The robotics destination.
--
-- Types carry the guarantees the contract verifies:
--
--   robot_id          VARCHAR, never numeric. 0017 must not become 17.
--   firmware_version  VARCHAR, never numeric. 3.08 is a version, not a number.
--   zero_offset_deg   NUMERIC(8,3), exact. Degrees, and negative is ordinary.
--   gear_ratio        NUMERIC(12,4), exact. No float anywhere near it.
--   calibration_date  DATE, written only under an approved date policy.
--
-- A robot has one calibration row per joint, so neither robot_id nor
-- joint_name is unique alone. The pair is, and the constraint says so rather
-- than leaving the commit gate to discover it.
CREATE TABLE IF NOT EXISTS public.robot_calibrations (
    robot_id          VARCHAR(20)   NOT NULL,
    joint_name        VARCHAR(64)   NOT NULL,
    zero_offset_deg   NUMERIC(8,3)  NOT NULL,
    gear_ratio        NUMERIC(12,4) NOT NULL,
    firmware_version  VARCHAR(32)   NOT NULL,
    sensor_frame      VARCHAR(64)   NOT NULL,
    calibration_date  DATE          NOT NULL,
    migration_id      UUID          NOT NULL REFERENCES moveproof.migrations(id),
    committed_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (robot_id, joint_name)
);

-- Rollback removes the rows one migration wrote, so that lookup is indexed.
CREATE INDEX IF NOT EXISTS robot_calibrations_migration
    ON public.robot_calibrations (migration_id);
