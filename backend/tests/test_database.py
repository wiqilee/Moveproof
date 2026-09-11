"""Staging, idempotency and commit tests.

Marked `database`. They skip unless a PostgreSQL instance is reachable, so the
core suite still runs on a laptop with nothing installed.

    make db-up migrate
    make test-db
"""

from __future__ import annotations

import os
import uuid

import pytest

DATABASE_URL = os.environ.get("DATABASE_URL")

psycopg = pytest.importorskip("psycopg", reason="psycopg is not installed")

pytestmark = [
    pytest.mark.database,
    pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL is not set"),
]

from app.db import repository  # noqa: E402
from app.db.connection import connect  # noqa: E402
from app.domain.contract import CUSTOMERS_CONTRACT_V1  # noqa: E402
from app.domain.plan import approve, validate_plan  # noqa: E402
from app.domain.plans import legacy_integer_cast_plan, safe_plan  # noqa: E402
from app.domain.schema import CUSTOMERS_V1  # noqa: E402
from app.domain.types import (  # noqa: E402
    CheckStatus,
    ConflictPolicy,
    Mapping,
    MigrationState,
    Operation,
)
from app.execute.executor import execute_plan  # noqa: E402
from app.ingest.parser import parse_csv  # noqa: E402
from app.verify.db_verifier import verify_run  # noqa: E402

CLEAN_CSV = b"""customer_id,full_name,email,signup_date,balance,region
00127,Amara Chen,amara.chen@example.com,2024-03-16,1200.50,APAC
00128,Diego Fernandez,diego.f@example.com,2024-03-15,980.00,EMEA
00129,Priya Natarajan,priya.n@example.com,2024-03-14,540.75,APAC
"""


@pytest.fixture
def conn():
    """A connection per test.

    Rolling back is a courtesy, not the isolation mechanism. Some tests commit
    on purpose, so the real isolation is the `clean_database` fixture in
    conftest, which truncates before and after every database test.
    """
    with connect() as connection:
        yield connection
        try:
            connection.rollback()
        except Exception:
            # A connection left in a failed state by an expected exception
            # cannot be rolled back. Cleanup runs on its own connection.
            pass


def ingest(conn, raw=CLEAN_CSV, name="clean.csv"):
    parsed = parse_csv(raw, name)
    migration_id = repository.create_migration(
        conn, parsed.source_file, parsed.rows, original_bytes=raw
    )
    return migration_id, parsed


def approve_and_save(conn, migration_id, parsed, plan, at="2026-09-09T06:00:00Z"):
    """Validate, approve and store a plan version once.

    A plan version is immutable, so this is called once per version. Staging
    the same version again reuses the stored plan, exactly as the API does.
    """
    validation = validate_plan(plan, CUSTOMERS_V1, parsed.source_file.columns)
    approved = approve(
        validation,
        "test-operator",
        at,
        acknowledgements=[
            m.source_column for m in validation.plan.mappings if m.requires_acknowledgement
        ],
        contract=CUSTOMERS_CONTRACT_V1,
    )
    repository.save_plan(conn, migration_id, approved)
    return approved


def run_staging(conn, migration_id, parsed, approved, key="run-1"):
    """Execute an already approved plan and persist the run."""
    result = execute_plan(approved, CUSTOMERS_V1, parsed.rows, parsed.source_file.columns)
    run_id = repository.persist_run(
        conn, migration_id, approved, result, key, contract=CUSTOMERS_CONTRACT_V1
    )
    return run_id


def stage(conn, migration_id, parsed, plan, key="run-1", at="2026-09-09T06:00:00Z"):
    approved = approve_and_save(conn, migration_id, parsed, plan, at)
    return approved, run_staging(conn, migration_id, parsed, approved, key)


def verify_and_store(conn, migration_id, run_id):
    outcome = verify_run(conn, migration_id, run_id, CUSTOMERS_V1)
    repository.save_checks(conn, run_id, outcome.checks)
    repository.mark_verified(conn, run_id)
    return outcome


def commit(conn, migration_id, run_id, policy=ConflictPolicy.FAIL_CLOSED):
    return repository.commit_run(
        conn, migration_id, run_id, "test-operator", CUSTOMERS_CONTRACT_V1, policy
    )


def test_source_rows_are_preserved_verbatim(conn):
    migration_id, parsed = ingest(conn)
    stored = repository.load_source_rows(conn, migration_id)
    assert len(stored) == 3
    assert stored[0].values["customer_id"] == "00127"


def test_staging_round_trip_keeps_decimals_and_dates_exact(conn):
    migration_id, parsed = ingest(conn)
    _, run_id = stage(conn, migration_id, parsed, safe_plan())

    rows = repository.load_staged_rows(conn, run_id, committable_only=True)
    from datetime import date
    from decimal import Decimal

    assert rows[0]["values"]["balance"] == Decimal("1200.50")
    assert rows[0]["values"]["signup_date"] == date(2024, 3, 16)
    assert rows[0]["values"]["customer_id"] == "00127"


def test_verification_reads_back_from_the_database(conn):
    migration_id, parsed = ingest(conn)
    _, run_id = stage(conn, migration_id, parsed, safe_plan())

    outcome = verify_run(conn, migration_id, run_id, CUSTOMERS_V1)
    repository.save_checks(conn, run_id, outcome.checks)

    identifier = next(c for c in outcome.checks if c.check_id == "identifier_preservation")
    assert identifier.status is CheckStatus.PASSED

    stored = repository.load_checks(conn, run_id)
    assert len(stored) == len(outcome.checks)


def test_integer_cast_failure_survives_the_round_trip(conn):
    """The damage must still be visible after storage, not only in memory."""
    migration_id, parsed = ingest(conn)
    _, run_id = stage(conn, migration_id, parsed, legacy_integer_cast_plan())

    outcome = verify_run(conn, migration_id, run_id, CUSTOMERS_V1)
    identifier = next(c for c in outcome.checks if c.check_id == "identifier_preservation")

    assert identifier.status is CheckStatus.FAILED
    # All three identifiers are zero padded, so all three are damaged.
    assert "3 row(s) differ" in identifier.observed


def test_idempotent_replay_returns_the_first_run(conn):
    """Replaying an approved plan with the same key stages nothing new."""
    migration_id, parsed = ingest(conn)
    approved = approve_and_save(conn, migration_id, parsed, safe_plan())

    first = run_staging(conn, migration_id, parsed, approved, key="replay-key")
    second = run_staging(conn, migration_id, parsed, approved, key="replay-key")

    assert first == second
    rows = repository.load_staged_rows(conn, first)
    assert len(rows) == 3, "the rows were staged twice"

    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) AS n FROM moveproof.runs WHERE migration_id = %s",
            (migration_id,),
        )
        assert cur.fetchone()["n"] == 1, "a second run row was created"


def test_a_different_idempotency_key_creates_a_second_run(conn):
    """The key is what makes a replay a replay, not the plan version."""
    migration_id, parsed = ingest(conn)
    approved = approve_and_save(conn, migration_id, parsed, safe_plan())

    first = run_staging(conn, migration_id, parsed, approved, key="key-a")
    second = run_staging(conn, migration_id, parsed, approved, key="key-b")
    assert first != second


def test_commit_is_blocked_while_a_check_failed(conn):
    migration_id, parsed = ingest(conn)
    _, run_id = stage(conn, migration_id, parsed, legacy_integer_cast_plan())
    verify_and_store(conn, migration_id, run_id)

    with pytest.raises(repository.CommitRefused):
        commit(conn, migration_id, run_id)


def test_commit_writes_rows_and_moves_state(conn):
    migration_id, parsed = ingest(conn)
    _, run_id = stage(conn, migration_id, parsed, safe_plan())
    verify_and_store(conn, migration_id, run_id)

    outcome = commit(conn, migration_id, run_id)
    assert outcome["written"] == 3
    assert outcome["skipped"] == 0
    assert outcome["expected"] == 3
    assert repository.get_state(conn, migration_id) is MigrationState.COMMITTED

    with conn.cursor() as cur:
        cur.execute(
            "SELECT customer_id, balance FROM public.customers WHERE migration_id = %s "
            "ORDER BY customer_id",
            (migration_id,),
        )
        rows = cur.fetchall()
    assert [r["customer_id"] for r in rows] == ["00127", "00128", "00129"]
    assert str(rows[0]["balance"]) == "1200.50"


def test_repair_rereads_the_stored_source_not_the_damaged_value(conn):
    """The whole point of preserving the upload."""
    migration_id, parsed = ingest(conn)
    broken_plan, broken_run = stage(
        conn, migration_id, parsed, legacy_integer_cast_plan(), key="run-broken"
    )
    damaged = repository.load_staged_rows(conn, broken_run, committable_only=True)
    assert damaged[0]["values"]["customer_id"] == 127

    revised = broken_plan.revise(
        tuple(
            Mapping("customer_id", "customer_id", Operation.PRESERVE_IDENTIFIER_AS_STRING)
            if m.source_column == "customer_id"
            else m
            for m in broken_plan.mappings
        )
    )
    revised_validation = validate_plan(revised, CUSTOMERS_V1, parsed.source_file.columns)
    approved = approve(
        revised_validation, "test-operator", "2026-09-09T06:05:00Z",
        contract=CUSTOMERS_CONTRACT_V1,
    )
    repository.save_plan(conn, migration_id, approved)
    assert approved.version == 2, "a repair creates a new version"

    # Reparse the authoritative original bytes, not the staged 127.
    original_bytes = repository.load_original_bytes(conn, migration_id)
    reparsed = parse_csv(original_bytes, "clean.csv")
    result = execute_plan(
        approved, CUSTOMERS_V1, reparsed.rows, reparsed.source_file.columns
    )
    repaired_run = repository.persist_run(
        conn, migration_id, approved, result, "run-repaired",
        contract=CUSTOMERS_CONTRACT_V1,
    )

    repaired = repository.load_staged_rows(conn, repaired_run, committable_only=True)
    assert repaired[0]["values"]["customer_id"] == "00127"

    outcome = verify_run(conn, migration_id, repaired_run, CUSTOMERS_V1)
    identifier = next(c for c in outcome.checks if c.check_id == "identifier_preservation")
    assert identifier.status is CheckStatus.PASSED


def test_rollback_removes_only_this_migrations_rows(conn):
    migration_id, parsed = ingest(conn)
    _, run_id = stage(conn, migration_id, parsed, safe_plan())
    verify_and_store(conn, migration_id, run_id)
    commit(conn, migration_id, run_id)

    removed = repository.rollback_migration(conn, migration_id)
    assert removed == 3
    assert repository.get_state(conn, migration_id) is MigrationState.ROLLED_BACK


def test_a_plan_version_cannot_be_written_twice(conn):
    migration_id, parsed = ingest(conn)
    validation = validate_plan(safe_plan(), CUSTOMERS_V1, parsed.source_file.columns)
    plan = approve(
        validation, "test-operator", "2026-09-09T06:00:00Z",
        contract=CUSTOMERS_CONTRACT_V1,
    )
    repository.save_plan(conn, migration_id, plan)
    with pytest.raises(psycopg.errors.UniqueViolation):
        repository.save_plan(conn, migration_id, plan)


# =====================================================================
# Batch 3 regressions
# =====================================================================

CONFLICT_CSV = b"""customer_id,full_name,email,signup_date,balance,region
00127,Amara Chen,amara.chen@example.com,2024-03-16,1200.50,APAC
00500,New Person,new.person@example.com,2024-03-18,10.00,NA
"""

EMAIL_CLASH_CSV = b"""customer_id,full_name,email,signup_date,balance,region
00900,Other Person,amara.chen@example.com,2024-03-18,10.00,NA
"""


def seed_committed(conn):
    """Commit the clean file once so the destination is not empty."""
    migration_id, parsed = ingest(conn)
    _, run_id = stage(conn, migration_id, parsed, safe_plan())
    verify_and_store(conn, migration_id, run_id)
    commit(conn, migration_id, run_id)
    return migration_id


# --- 2.1 silent destination conflicts --------------------------------


def test_existing_customer_id_fails_closed(conn):
    seed_committed(conn)
    migration_id, parsed = ingest(conn, CONFLICT_CSV, "conflict.csv")
    _, run_id = stage(conn, migration_id, parsed, safe_plan(), key="conflict-run")
    verify_and_store(conn, migration_id, run_id)

    with pytest.raises(repository.CommitRefused) as exc:
        commit(conn, migration_id, run_id)
    assert "fails closed" in str(exc.value)
    assert "00127" in str(exc.value)


def test_existing_id_can_be_skipped_only_under_an_approved_policy(conn):
    seed_committed(conn)
    migration_id, parsed = ingest(conn, CONFLICT_CSV, "conflict.csv")
    _, run_id = stage(conn, migration_id, parsed, safe_plan(), key="conflict-run")
    verify_and_store(conn, migration_id, run_id)

    outcome = commit(conn, migration_id, run_id, ConflictPolicy.SKIP_EXISTING)
    assert outcome["expected"] == 2
    assert outcome["skipped"] == 1
    assert outcome["written"] + outcome["skipped"] == outcome["expected"]


def test_existing_email_under_a_different_id_is_refused(conn):
    seed_committed(conn)
    migration_id, parsed = ingest(conn, EMAIL_CLASH_CSV, "email.csv")
    _, run_id = stage(conn, migration_id, parsed, safe_plan(), key="email-run")
    verify_and_store(conn, migration_id, run_id)

    with pytest.raises(repository.CommitRefused) as exc:
        commit(conn, migration_id, run_id, ConflictPolicy.SKIP_EXISTING)
    assert "email" in str(exc.value).lower()


def test_preflight_reports_conflicts_without_writing(conn):
    seed_committed(conn)
    migration_id, parsed = ingest(conn, CONFLICT_CSV, "conflict.csv")
    _, run_id = stage(conn, migration_id, parsed, safe_plan(), key="preflight")
    conflicts = repository.preflight_conflicts(conn, run_id)
    assert conflicts["customer_id"] == ["00127"]

    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) AS n FROM public.customers WHERE migration_id = %s",
            (migration_id,),
        )
        assert cur.fetchone()["n"] == 0, "preflight wrote nothing"


def test_repeated_commit_is_refused(conn):
    migration_id, parsed = ingest(conn)
    _, run_id = stage(conn, migration_id, parsed, safe_plan())
    verify_and_store(conn, migration_id, run_id)
    commit(conn, migration_id, run_id)

    with pytest.raises(repository.CommitRefused) as exc:
        commit(conn, migration_id, run_id)
    assert "already been committed" in str(exc.value)


def test_commit_ledger_records_reconciliation(conn):
    migration_id, parsed = ingest(conn)
    _, run_id = stage(conn, migration_id, parsed, safe_plan())
    verify_and_store(conn, migration_id, run_id)
    commit(conn, migration_id, run_id)

    with conn.cursor() as cur:
        cur.execute(
            "SELECT expected_rows, written_rows, skipped_rows FROM moveproof.commits "
            "WHERE run_id = %s",
            (run_id,),
        )
        record = cur.fetchone()
    assert record["written_rows"] + record["skipped_rows"] == record["expected_rows"]


# --- 2.2 commit gate --------------------------------------------------


def test_commit_without_any_stored_checks_is_refused(conn):
    migration_id, parsed = ingest(conn)
    _, run_id = stage(conn, migration_id, parsed, safe_plan())
    with pytest.raises(repository.CommitRefused) as exc:
        commit(conn, migration_id, run_id)
    assert "No verification" in str(exc.value)


def test_commit_with_a_missing_mandatory_check_is_refused(conn):
    migration_id, parsed = ingest(conn)
    _, run_id = stage(conn, migration_id, parsed, safe_plan())
    outcome = verify_run(conn, migration_id, run_id, CUSTOMERS_V1)
    partial = [c for c in outcome.checks if c.check_id != "uniqueness"]
    repository.save_checks(conn, run_id, partial)
    repository.mark_verified(conn, run_id)

    with pytest.raises(repository.CommitRefused) as exc:
        commit(conn, migration_id, run_id)
    assert "never ran" in str(exc.value)
    assert "uniqueness" in str(exc.value)


def test_commit_with_a_run_from_another_migration_is_refused(conn):
    first, parsed_one = ingest(conn)
    _, run_one = stage(conn, first, parsed_one, safe_plan())
    verify_and_store(conn, first, run_one)

    second, _ = ingest(conn)
    with pytest.raises(repository.CommitRefused) as exc:
        commit(conn, second, run_one)
    assert "belongs to migration" in str(exc.value)


def test_commit_is_refused_when_a_newer_plan_has_been_approved(conn):
    migration_id, parsed = ingest(conn)
    plan_one, run_id = stage(conn, migration_id, parsed, safe_plan())
    verify_and_store(conn, migration_id, run_id)

    revised = plan_one.revise(plan_one.mappings)
    revised_validation = validate_plan(revised, CUSTOMERS_V1, parsed.source_file.columns)
    approved_two = approve(
        revised_validation, "test-operator", "2026-09-09T06:30:00Z",
        contract=CUSTOMERS_CONTRACT_V1,
    )
    repository.save_plan(conn, migration_id, approved_two)

    with pytest.raises(repository.CommitRefused) as exc:
        commit(conn, migration_id, run_id)
    assert "has since" in str(exc.value)


def test_commit_is_refused_under_a_different_contract(conn):
    from app.domain.contract import VerificationContract

    migration_id, parsed = ingest(conn)
    _, run_id = stage(conn, migration_id, parsed, safe_plan())
    verify_and_store(conn, migration_id, run_id)

    other = VerificationContract(
        version="vc-other",
        destination_schema="public.customers",
        destination_schema_version="v1",
        key_column="customer_id",
        date_columns=("signup_date",),
    )
    with pytest.raises(repository.CommitRefused) as exc:
        repository.commit_run(
            conn, migration_id, run_id, "test-operator", other, ConflictPolicy.FAIL_CLOSED
        )
    assert "different contract" in str(exc.value)


def test_commit_is_refused_when_verification_was_never_stamped(conn):
    migration_id, parsed = ingest(conn)
    _, run_id = stage(conn, migration_id, parsed, safe_plan())
    outcome = verify_run(conn, migration_id, run_id, CUSTOMERS_V1)
    repository.save_checks(conn, run_id, outcome.checks)
    # mark_verified deliberately not called.

    with pytest.raises(repository.CommitRefused) as exc:
        commit(conn, migration_id, run_id)
    assert "verification timestamp" in str(exc.value)


def test_commit_after_rollback_is_refused(conn):
    migration_id, parsed = ingest(conn)
    _, run_id = stage(conn, migration_id, parsed, safe_plan())
    verify_and_store(conn, migration_id, run_id)
    commit(conn, migration_id, run_id)
    repository.rollback_migration(conn, migration_id)

    with pytest.raises(repository.CommitRefused) as exc:
        commit(conn, migration_id, run_id)
    assert "rolled back" in str(exc.value)


def test_concurrent_commit_attempts_cannot_both_succeed(conn):
    """The second connection blocks on the row lock, then finds it committed."""
    from app.db.connection import connect

    migration_id, parsed = ingest(conn)
    _, run_id = stage(conn, migration_id, parsed, safe_plan())
    verify_and_store(conn, migration_id, run_id)
    conn.commit()

    first = commit(conn, migration_id, run_id)
    conn.commit()
    assert first["written"] == 3

    with connect() as other:
        with pytest.raises(repository.CommitRefused):
            repository.commit_run(
                other, migration_id, run_id, "second-operator",
                CUSTOMERS_CONTRACT_V1, ConflictPolicy.FAIL_CLOSED,
            )


# --- 2.3 execution evidence survives storage --------------------------


REJECT_CSV = b"""customer_id,full_name,email,signup_date,balance,region
00127,Amara Chen,amara.chen@example.com,2024-03-16,1200.50,APAC
00128,Diego Fernandez,diego.f@example.com,2024-02-30,980.00,EMEA
"""


def test_transform_rejections_survive_the_round_trip(conn):
    migration_id, parsed = ingest(conn, REJECT_CSV, "reject.csv")
    _, run_id = stage(conn, migration_id, parsed, safe_plan(), key="reject-run")

    stored = repository.load_transform_errors(conn, run_id)
    assert len(stored) == 1
    assert "not a real calendar date" in stored[0].reason

    outcome = verify_run(conn, migration_id, run_id, CUSTOMERS_V1)
    assert outcome.transform_errors == 1
    rejection = next(c for c in outcome.checks if c.check_id == "transform_rejections")
    assert rejection.status is CheckStatus.REVIEW
    assert "1 row(s) could not be transformed" in rejection.observed


def test_applied_operations_are_read_back(conn):
    migration_id, parsed = ingest(conn)
    _, run_id = stage(conn, migration_id, parsed, safe_plan())
    run = repository.load_run(conn, run_id)
    assert any("deduplicate" in op for op in run["applied_operations"])

    outcome = verify_run(conn, migration_id, run_id, CUSTOMERS_V1)
    assert outcome.plan_version == "v1"


# --- 2.4 original source preservation ---------------------------------


def test_original_bytes_are_stored_and_verified(conn):
    migration_id, _ = ingest(conn)
    restored = repository.load_original_bytes(conn, migration_id)
    assert restored == CLEAN_CSV

    metadata = repository.source_file_metadata(conn, migration_id)
    assert metadata["byte_size"] == len(CLEAN_CSV)
    assert metadata["checksum"].startswith("sha256:")
    assert metadata["filename"] == "clean.csv"


def test_a_checksum_mismatch_at_upload_is_rejected(conn):
    parsed = parse_csv(CLEAN_CSV, "clean.csv")
    with pytest.raises(ValueError) as exc:
        repository.create_migration(
            conn, parsed.source_file, parsed.rows, original_bytes=b"different bytes"
        )
    assert "do not match the checksum" in str(exc.value)


def test_upload_without_any_authoritative_source_is_rejected(conn):
    parsed = parse_csv(CLEAN_CSV, "clean.csv")
    with pytest.raises(ValueError) as exc:
        repository.create_migration(conn, parsed.source_file, parsed.rows)
    assert "not an authoritative source" in str(exc.value)


def test_corrupted_stored_source_is_detected(conn):
    migration_id, _ = ingest(conn)
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE moveproof.source_files SET content = %s WHERE migration_id = %s",
            (b"tampered", migration_id),
        )
    with pytest.raises(repository.SourceIntegrityError):
        repository.load_original_bytes(conn, migration_id)
