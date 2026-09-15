-- External Evidence Check auditability.
--
-- The check has to leave a trace: which migration, which field, what question
-- was asked, what query actually left the system, and which sources came back.
-- Recording that as prose in `message` would make it unreadable and
-- unqueryable, and a whole new table for one event type is more structure than
-- the job needs.
--
-- A nullable JSONB column on the existing events table is the smallest change
-- that supports it. Every existing row stays valid, every existing query keeps
-- working, and no other event type has to start populating it.
--
-- What must never appear in here is listed in app/evidence/service.py: the
-- provider credential, uploaded rows, personal values and full data records.

ALTER TABLE moveproof.events
    ADD COLUMN IF NOT EXISTS event_type TEXT,
    ADD COLUMN IF NOT EXISTS metadata   JSONB;

-- Events are read per migration and, for evidence, filtered by type.
CREATE INDEX IF NOT EXISTS moveproof_events_type
    ON moveproof.events (migration_id, event_type);
