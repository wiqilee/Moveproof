"""Persistence for the migration pipeline.

Three properties this module is responsible for:

**The original source is preserved.** Uploaded rows are written verbatim to
`moveproof.source_rows` before anything is transformed. A repair reads from
there, which is the only way a leading zero destroyed by an integer cast can
come back.

**Runs are idempotent.** Replaying an approved plan with the same idempotency
key returns the first run instead of staging the rows again.

**Commit is atomic.** Verified rows move from staging into the destination
inside one transaction, and the migration state changes in the same
transaction. There is no window where one is true and the other is not.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict
from datetime import date
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from app.domain.contract import VerificationContract
from app.domain.types import (
    Check,
    ConflictPolicy,
    TransformError,
    ExecutionResult,
    MigrationPlan,
    MigrationState,
    RowDisposition,
    SourceFile,
    SourceRow,
)


class NotFound(LookupError):
    """A record that was asked for does not exist.

    Deliberately narrower than LookupError. KeyError and IndexError are also
    LookupErrors, and mapping the whole family to 404 turned a serialisation
    bug into a missing-route report that took a real test run to uncover.
    """


class CommitRefused(Exception):
    """Raised when a commit is attempted while something mandatory is open."""


class SourceIntegrityError(Exception):
    """Raised when stored source bytes no longer match their recorded checksum."""


class SourceUnavailable(Exception):
    """Raised when the authoritative source is not reachable from this process."""


def _encode(value: Any) -> Any:
    """JSON encoding that keeps exact values exact.

    A Decimal becomes its string form rather than a float. Round tripping money
    through a float is precisely the corruption this product reports on.
    """
    if isinstance(value, Decimal):
        return {"__decimal__": str(value)}
    if isinstance(value, date):
        return {"__date__": value.isoformat()}
    return value


def _decode(value: Any) -> Any:
    if isinstance(value, dict):
        if "__decimal__" in value:
            return Decimal(value["__decimal__"])
        if "__date__" in value:
            return date.fromisoformat(value["__date__"])
    return value


def _encode_row(values: dict[str, Any]) -> dict[str, Any]:
    return {key: _encode(val) for key, val in values.items()}


def _decode_row(values: dict[str, Any]) -> dict[str, Any]:
    return {key: _decode(val) for key, val in values.items()}


# --------------------------------------------------------------- migrations


def create_migration(
    conn: psycopg.Connection,
    source_file: SourceFile,
    rows: list[SourceRow],
    original_bytes: bytes | None = None,
    content_type: str = "text/csv",
    storage_uri: str | None = None,
    uploaded_by: str = "operator",
) -> uuid.UUID:
    """Record an upload.

    Either the original bytes or an object storage reference must be supplied.
    Parsed rows alone are a derived artefact: without the source there is
    nothing authoritative to repair from and no way to recheck the checksum
    later.
    """
    if original_bytes is None and storage_uri is None:
        raise ValueError(
            "Either original_bytes or storage_uri is required. Parsed rows are "
            "not an authoritative source."
        )
    if original_bytes is not None:
        import hashlib

        recomputed = "sha256:" + hashlib.sha256(original_bytes).hexdigest()
        if recomputed != source_file.checksum:
            raise ValueError(
                "The supplied bytes do not match the checksum recorded at parse "
                f"time. Expected {source_file.checksum}, got {recomputed}."
            )

    migration_id = uuid.uuid4()
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO moveproof.migrations
                (id, filename, checksum, byte_size, encoding, delimiter,
                 source_columns, row_count, state)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                migration_id,
                source_file.filename,
                source_file.checksum,
                source_file.byte_size,
                source_file.encoding,
                source_file.delimiter,
                list(source_file.columns),
                source_file.row_count,
                MigrationState.DRAFT.value,
            ),
        )
        # Source rows are written once and never updated.
        cur.executemany(
            """
            INSERT INTO moveproof.source_rows (migration_id, row_number, values)
            VALUES (%s, %s, %s)
            """,
            [(migration_id, row.row_number, Jsonb(row.values)) for row in rows],
        )
        cur.execute(
            """
            INSERT INTO moveproof.source_files
                (migration_id, filename, content_type, byte_size, checksum,
                 content, storage_uri, uploaded_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                migration_id,
                source_file.filename,
                content_type,
                source_file.byte_size,
                source_file.checksum,
                original_bytes,
                storage_uri,
                uploaded_by,
            ),
        )
    log_event(conn, migration_id, None, "info", f"Uploaded {source_file.filename}")
    return migration_id


def load_original_bytes(conn: psycopg.Connection, migration_id: uuid.UUID) -> bytes:
    """Return the uploaded file exactly as it arrived.

    Raises when the stored bytes no longer hash to the checksum recorded at
    upload, so a corrupted or substituted source is caught rather than silently
    used as the basis for a repair.
    """
    import hashlib

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT checksum, byte_size, content, storage_uri
            FROM moveproof.source_files WHERE migration_id = %s
            """,
            (migration_id,),
        )
        record = cur.fetchone()

    if record is None:
        raise NotFound(f"No source file recorded for migration {migration_id}")
    if record["content"] is None:
        raise SourceUnavailable(
            f"The source is held at {record['storage_uri']} and was not fetched."
        )

    content = bytes(record["content"])
    recomputed = "sha256:" + hashlib.sha256(content).hexdigest()
    if recomputed != record["checksum"]:
        raise SourceIntegrityError(
            f"The stored source no longer matches its checksum. "
            f"Expected {record['checksum']}, computed {recomputed}."
        )
    if len(content) != record["byte_size"]:
        raise SourceIntegrityError(
            f"The stored source is {len(content)} bytes but {record['byte_size']} "
            "were recorded at upload."
        )
    return content


def source_file_metadata(
    conn: psycopg.Connection, migration_id: uuid.UUID
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT filename, content_type, byte_size, checksum, storage_uri,
                   uploaded_by, uploaded_at
            FROM moveproof.source_files WHERE migration_id = %s
            """,
            (migration_id,),
        )
        record = cur.fetchone()
    if record is None:
        raise NotFound(f"No source file recorded for migration {migration_id}")
    return dict(record)


def load_source_rows(conn: psycopg.Connection, migration_id: uuid.UUID) -> list[SourceRow]:
    """Read the original upload back.

    This is what a repair rerun uses. It never reads staged output.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT row_number, values FROM moveproof.source_rows
            WHERE migration_id = %s ORDER BY row_number
            """,
            (migration_id,),
        )
        return [
            SourceRow(row_number=record["row_number"], values=record["values"])
            for record in cur.fetchall()
        ]


def get_source_file(conn: psycopg.Connection, migration_id: uuid.UUID) -> SourceFile:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM moveproof.migrations WHERE id = %s", (migration_id,)
        )
        record = cur.fetchone()
    if record is None:
        raise NotFound(f"No migration {migration_id}")
    return SourceFile(
        filename=record["filename"],
        checksum=record["checksum"],
        encoding=record["encoding"],
        delimiter=record["delimiter"],
        byte_size=record["byte_size"],
        row_count=record["row_count"],
        column_count=len(record["source_columns"]),
        columns=tuple(record["source_columns"]),
    )


def set_state(
    conn: psycopg.Connection, migration_id: uuid.UUID, state: MigrationState
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE moveproof.migrations
            SET state = %s, updated_at = now()
            WHERE id = %s
            """,
            (state.value, migration_id),
        )


def get_state(conn: psycopg.Connection, migration_id: uuid.UUID) -> MigrationState:
    with conn.cursor() as cur:
        cur.execute("SELECT state FROM moveproof.migrations WHERE id = %s", (migration_id,))
        record = cur.fetchone()
    if record is None:
        raise NotFound(f"No migration {migration_id}")
    return MigrationState(record["state"])


# --------------------------------------------------------------------- plans


def _plan_body(plan: MigrationPlan) -> dict[str, Any]:
    return {
        "version": plan.version,
        "key_column": plan.key_column,
        "date_format_policy": plan.date_format_policy.value
        if plan.date_format_policy
        else None,
        "duplicate_policy": plan.duplicate_policy.value,
        "required_field_policy": plan.required_field_policy.value
        if plan.required_field_policy
        else None,
        "mappings": [
            {
                "source_column": m.source_column,
                "destination_column": m.destination_column,
                "operation": m.operation.value,
                "status": m.status.value,
                "note": m.note,
                "requires_acknowledgement": m.requires_acknowledgement,
                "options": m.options,
            }
            for m in plan.mappings
        ],
    }


def save_plan(
    conn: psycopg.Connection, migration_id: uuid.UUID, plan: MigrationPlan
) -> None:
    """Insert a plan version.

    There is no update path. Attempting to save the same version twice raises,
    because an approved plan that could be edited would make every evidence
    report unfalsifiable.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO moveproof.plans
                (migration_id, version, body, proposed_by, approved_by,
                 approved_at, contract_hash, acknowledgements, conflict_policy)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                migration_id,
                plan.version,
                Jsonb(_plan_body(plan)),
                plan.proposed_by,
                plan.approved_by,
                plan.approved_at,
                plan.contract_hash,
                list(plan.acknowledgements),
                plan.conflict_policy.value,
            ),
        )


def record_approval(
    conn: psycopg.Connection,
    migration_id: uuid.UUID,
    plan_version: int,
    action: str,
    approved_by: str,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO moveproof.approvals
                (migration_id, plan_version, action, approved_by)
            VALUES (%s, %s, %s, %s)
            """,
            (migration_id, plan_version, action, approved_by),
        )


def list_approvals(conn: psycopg.Connection, migration_id: uuid.UUID) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT plan_version, action, approved_by, approved_at
            FROM moveproof.approvals WHERE migration_id = %s ORDER BY id
            """,
            (migration_id,),
        )
        return [dict(record) for record in cur.fetchall()]


# ----------------------------------------------------------------------- runs


def find_run_by_key(
    conn: psycopg.Connection, migration_id: uuid.UUID, idempotency_key: str
) -> uuid.UUID | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id FROM moveproof.runs
            WHERE migration_id = %s AND idempotency_key = %s
            """,
            (migration_id, idempotency_key),
        )
        record = cur.fetchone()
    return record["id"] if record else None


def persist_run(
    conn: psycopg.Connection,
    migration_id: uuid.UUID,
    plan: MigrationPlan,
    result: ExecutionResult,
    idempotency_key: str,
    contract: VerificationContract | None = None,
) -> uuid.UUID:
    """Write a run and its staged rows.

    If the key has been seen before, the existing run id comes back untouched.
    Replaying a request is therefore safe: a retried network call cannot stage
    the same rows twice.
    """
    existing = find_run_by_key(conn, migration_id, idempotency_key)
    if existing is not None:
        log_event(
            conn,
            migration_id,
            existing,
            "info",
            f"Idempotency key {idempotency_key} already ran. Returning the first run.",
        )
        return existing

    run_id = uuid.uuid4()
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO moveproof.runs
                (id, migration_id, plan_version, idempotency_key,
                 finished_at, accounting, applied_operations,
                 contract_hash, contract_body)
            VALUES (%s, %s, %s, %s, now(), %s, %s, %s, %s)
            """,
            (
                run_id,
                migration_id,
                plan.version,
                idempotency_key,
                Jsonb(asdict(result.accounting)),
                Jsonb(result.applied_operations),
                plan.contract_hash,
                Jsonb(contract.as_dict()) if contract is not None else None,
            ),
        )
        # Transformation errors are evidence. Losing them would let a later
        # verification conclude that nothing was rejected.
        if result.errors:
            cur.executemany(
                """
                INSERT INTO moveproof.transform_errors
                    (run_id, row_number, source_key, field_name, source_value, reason)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                [
                    (
                        run_id,
                        error.row_number,
                        error.source_key,
                        error.field_name,
                        error.source_value,
                        error.reason,
                    )
                    for error in result.errors
                ],
            )
        cur.executemany(
            """
            INSERT INTO staging.customers
                (run_id, row_number, source_key, values, disposition, reason)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            [
                (
                    run_id,
                    row.row_number,
                    row.source_key,
                    Jsonb(_encode_row(row.values)),
                    row.disposition.value,
                    row.reason,
                )
                for row in result.staged
            ],
        )
    log_event(
        conn,
        migration_id,
        run_id,
        "info",
        f"Staged {result.accounting.staged_rows} row(s) under plan {plan.version_label}",
    )
    return run_id


def save_checks(conn: psycopg.Connection, run_id: uuid.UUID, checks: list[Check]) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO moveproof.checks
                (run_id, check_id, name, expected, observed, status, evidence)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (run_id, check_id) DO UPDATE
                SET observed = EXCLUDED.observed,
                    status = EXCLUDED.status,
                    evidence = EXCLUDED.evidence,
                    checked_at = now()
            """,
            [
                (
                    run_id,
                    check.check_id,
                    check.name,
                    check.expected,
                    check.observed,
                    check.status.value,
                    Jsonb([evidence.to_dict() for evidence in check.evidence]),
                )
                for check in checks
            ],
        )


def load_checks(conn: psycopg.Connection, run_id: uuid.UUID) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT check_id, name, expected, observed, status, evidence, checked_at
            FROM moveproof.checks WHERE run_id = %s ORDER BY check_id
            """,
            (run_id,),
        )
        return [dict(record) for record in cur.fetchall()]


def load_staged_rows(
    conn: psycopg.Connection, run_id: uuid.UUID, committable_only: bool = False
) -> list[dict[str, Any]]:
    clause = "AND disposition = 'staged'" if committable_only else ""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT row_number, source_key, values, disposition, reason
            FROM staging.customers
            WHERE run_id = %s {clause}
            ORDER BY row_number
            """,
            (run_id,),
        )
        return [
            {**dict(record), "values": _decode_row(record["values"])}
            for record in cur.fetchall()
        ]


def load_transform_errors(
    conn: psycopg.Connection, run_id: uuid.UUID
) -> list[TransformError]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT row_number, source_key, field_name, source_value, reason
            FROM moveproof.transform_errors WHERE run_id = %s ORDER BY id
            """,
            (run_id,),
        )
        return [
            TransformError(
                row_number=record["row_number"],
                source_key=record["source_key"],
                field_name=record["field_name"],
                source_value=record["source_value"],
                reason=record["reason"],
            )
            for record in cur.fetchall()
        ]


def load_migration(conn: psycopg.Connection, migration_id: uuid.UUID) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM moveproof.migrations WHERE id = %s", (migration_id,))
        record = cur.fetchone()
    if record is None:
        raise NotFound(f"No migration {migration_id}")
    return dict(record)


def list_migrations(conn: psycopg.Connection, limit: int = 100) -> list[dict[str, Any]]:
    """Migration index with the latest plan and run folded in.

    Everything the list view shows is derived here in one query rather than
    assembled per row in the interface, so the list and the detail page cannot
    disagree about a migration's state.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT m.id, m.filename, m.checksum, m.row_count, m.state,
                   m.created_at, m.updated_at,
                   (SELECT MAX(version) FROM moveproof.plans p
                     WHERE p.migration_id = m.id) AS latest_plan_version,
                   (SELECT MAX(version) FROM moveproof.plans p
                     WHERE p.migration_id = m.id AND p.approved_at IS NOT NULL)
                     AS approved_plan_version,
                   r.id AS latest_run_id,
                   r.finished_at AS latest_run_finished_at,
                   r.verified_at AS latest_run_verified_at,
                   c.committed_at AS committed_at
            FROM moveproof.migrations m
            LEFT JOIN LATERAL (
                SELECT id, finished_at, verified_at FROM moveproof.runs
                WHERE migration_id = m.id ORDER BY started_at DESC LIMIT 1
            ) r ON TRUE
            LEFT JOIN LATERAL (
                SELECT committed_at FROM moveproof.commits
                WHERE migration_id = m.id ORDER BY committed_at DESC LIMIT 1
            ) c ON TRUE
            ORDER BY m.created_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        return [dict(record) for record in cur.fetchall()]


def latest_run_id(conn: psycopg.Connection, migration_id: uuid.UUID) -> uuid.UUID | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id FROM moveproof.runs WHERE migration_id = %s
            ORDER BY started_at DESC LIMIT 1
            """,
            (migration_id,),
        )
        record = cur.fetchone()
    return record["id"] if record else None


def list_run_ids(conn: psycopg.Connection, migration_id: uuid.UUID) -> list[uuid.UUID]:
    """Every run for a migration, newest first."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id FROM moveproof.runs WHERE migration_id = %s
            ORDER BY started_at DESC
            """,
            (migration_id,),
        )
        return [record["id"] for record in cur.fetchall()]


def committed_run_id(
    conn: psycopg.Connection, migration_id: uuid.UUID
) -> uuid.UUID | None:
    """The run whose rows were written to the destination, if any.

    `moveproof.commits` has a unique constraint on run_id, so a migration has
    at most one committed run.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT run_id FROM moveproof.commits WHERE migration_id = %s
            ORDER BY committed_at DESC LIMIT 1
            """,
            (migration_id,),
        )
        record = cur.fetchone()
    return record["run_id"] if record else None


def load_commit(conn: psycopg.Connection, run_id: uuid.UUID) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM moveproof.commits WHERE run_id = %s", (run_id,))
        record = cur.fetchone()
    return dict(record) if record else None


def list_plans(conn: psycopg.Connection, migration_id: uuid.UUID) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT version, proposed_by, approved_by, approved_at, contract_hash,
                   acknowledgements, conflict_policy, body, created_at
            FROM moveproof.plans WHERE migration_id = %s ORDER BY version
            """,
            (migration_id,),
        )
        return [dict(record) for record in cur.fetchall()]


def search_migrations(
    conn: psycopg.Connection, term: str, limit: int = 10
) -> list[dict[str, Any]]:
    """Search by id prefix or filename. Used by the command palette."""
    pattern = f"%{term.lower()}%"
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, filename, state, created_at
            FROM moveproof.migrations
            WHERE lower(filename) LIKE %s OR CAST(id AS TEXT) LIKE %s
            ORDER BY created_at DESC LIMIT %s
            """,
            (pattern, pattern, limit),
        )
        return [dict(record) for record in cur.fetchall()]


def load_run(conn: psycopg.Connection, run_id: uuid.UUID) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM moveproof.runs WHERE id = %s", (run_id,))
        record = cur.fetchone()
    if record is None:
        raise NotFound(f"No run {run_id}")
    return dict(record)


def load_plan(
    conn: psycopg.Connection, migration_id: uuid.UUID, version: int
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT * FROM moveproof.plans
            WHERE migration_id = %s AND version = %s
            """,
            (migration_id, version),
        )
        record = cur.fetchone()
    if record is None:
        raise NotFound(f"No plan {version} for migration {migration_id}")
    return dict(record)


def latest_approved_plan_version(
    conn: psycopg.Connection, migration_id: uuid.UUID
) -> int | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT MAX(version) AS version FROM moveproof.plans
            WHERE migration_id = %s AND approved_at IS NOT NULL
            """,
            (migration_id,),
        )
        record = cur.fetchone()
    return record["version"] if record and record["version"] is not None else None


def log_event(
    conn: psycopg.Connection,
    migration_id: uuid.UUID,
    run_id: uuid.UUID | None,
    level: str,
    message: str,
    event_type: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Record an event. Field values are never written into the message.

    `event_type` and `metadata` are optional so every existing call site keeps
    working unchanged. They exist for events that carry structure worth
    querying later, such as an external evidence check, where prose in
    `message` would be neither readable nor searchable.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO moveproof.events
                (migration_id, run_id, level, message, event_type, metadata)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                migration_id,
                run_id,
                level,
                message,
                event_type,
                Jsonb(metadata) if metadata is not None else None,
            ),
        )


def list_events_by_type(
    conn: psycopg.Connection, migration_id: uuid.UUID, event_type: str
) -> list[dict[str, Any]]:
    """Structured events of one kind, newest first."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT run_id, level, message, event_type, metadata, created_at
            FROM moveproof.events
            WHERE migration_id = %s AND event_type = %s
            ORDER BY id DESC
            """,
            (migration_id, event_type),
        )
        return [dict(record) for record in cur.fetchall()]


def list_events(conn: psycopg.Connection, migration_id: uuid.UUID) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT run_id, level, message, event_type, created_at
            FROM moveproof.events WHERE migration_id = %s ORDER BY id
            """,
            (migration_id,),
        )
        return [dict(record) for record in cur.fetchall()]


# --------------------------------------------------------------------- commit


def preflight_conflicts(
    conn: psycopg.Connection, run_id: uuid.UUID
) -> dict[str, list[str]]:
    """Find destination rows that would collide before writing anything.

    Both unique constraints are checked, not only the primary key. An existing
    email under a different customer id would otherwise surface as a mid-insert
    integrity error with some rows already written.
    """
    rows = load_staged_rows(conn, run_id, committable_only=True)
    keys = [str(row["values"]["customer_id"]) for row in rows]
    emails = [str(row["values"]["email"]) for row in rows]

    if not keys:
        return {"customer_id": [], "email": []}

    with conn.cursor() as cur:
        cur.execute(
            "SELECT customer_id FROM public.customers WHERE customer_id = ANY(%s)",
            (keys,),
        )
        existing_keys = [record["customer_id"] for record in cur.fetchall()]
        cur.execute(
            """
            SELECT email FROM public.customers
            WHERE email = ANY(%s) AND customer_id <> ALL(%s)
            """,
            (emails, keys),
        )
        existing_emails = [record["email"] for record in cur.fetchall()]

    return {"customer_id": sorted(existing_keys), "email": sorted(existing_emails)}


def assert_commit_allowed(
    conn: psycopg.Connection,
    migration_id: uuid.UUID,
    run_id: uuid.UUID,
    contract: VerificationContract,
) -> dict[str, Any]:
    """Every condition a commit depends on, checked in one place.

    Absence of a failure is not the same as presence of a verification. A
    mandatory check that never executed blocks a commit exactly as firmly as
    one that failed, because an unchecked property is not a passing one.
    """
    run = load_run(conn, run_id)

    if run["migration_id"] != migration_id:
        raise CommitRefused(
            f"Run {run_id} belongs to migration {run['migration_id']}, not {migration_id}."
        )

    state = get_state(conn, migration_id)
    if state is MigrationState.COMMITTED:
        raise CommitRefused("This migration has already been committed.")
    if state is MigrationState.ROLLED_BACK:
        raise CommitRefused("This migration was rolled back and cannot be committed.")

    plan = load_plan(conn, migration_id, run["plan_version"])
    if plan["approved_at"] is None:
        raise CommitRefused(
            f"Plan {run['plan_version']} was executed but never approved."
        )

    latest = latest_approved_plan_version(conn, migration_id)
    if latest is not None and run["plan_version"] != latest:
        raise CommitRefused(
            f"This run executed plan v{run['plan_version']} but v{latest} has since "
            "been approved. Rerun before committing."
        )

    if run["contract_hash"] != contract.hash():
        raise CommitRefused(
            "The run was verified under a different contract than the one being "
            "used to commit."
        )
    if plan["contract_hash"] != contract.hash():
        raise CommitRefused(
            "The approved plan is bound to a different verification contract."
        )

    stored = load_checks(conn, run_id)
    if not stored:
        raise CommitRefused("No verification has been recorded for this run.")

    executed = {check["check_id"] for check in stored}
    missing = contract.missing_checks(executed)
    if missing:
        raise CommitRefused(
            "These mandatory checks never ran: " + ", ".join(missing)
        )

    blocking = [
        check
        for check in stored
        if contract.is_mandatory(check["check_id"])
        and check["status"] in ("failed", "review")
    ]
    if blocking:
        names = ", ".join(f"{c['check_id']} ({c['status']})" for c in blocking)
        raise CommitRefused(f"Commit is blocked by: {names}")

    if run["verified_at"] is None:
        raise CommitRefused("The run has no recorded verification timestamp.")
    if run["finished_at"] is not None and run["verified_at"] < run["finished_at"]:
        raise CommitRefused(
            "The stored verification predates the execution it claims to describe."
        )

    return run


def commit_run(
    conn: psycopg.Connection,
    migration_id: uuid.UUID,
    run_id: uuid.UUID,
    approved_by: str,
    contract: VerificationContract,
    conflict_policy: ConflictPolicy = ConflictPolicy.FAIL_CLOSED,
) -> dict[str, int]:
    """Move verified rows into the destination.

    Three properties hold here:

    **Serialised.** The migration row is locked FOR UPDATE first, so two
    concurrent attempts cannot both pass the gate. The second waits, then finds
    the state already committed and is refused.

    **Fail closed on conflict.** A destination row already holding one of these
    keys stops the commit unless a policy explicitly says otherwise. The old
    ON CONFLICT DO NOTHING silently skipped those rows while reporting success.

    **Reconciled.** The number of rows actually written is compared against the
    number expected, and a mismatch aborts the transaction. The commits table
    carries a CHECK constraint saying the same thing, so the database refuses an
    unreconciled record even if this function were wrong.
    """
    with conn.cursor() as cur:
        # Serialise commits for this migration.
        cur.execute(
            "SELECT id FROM moveproof.migrations WHERE id = %s FOR UPDATE",
            (migration_id,),
        )
        if cur.fetchone() is None:
            raise NotFound(f"No migration {migration_id}")

    assert_commit_allowed(conn, migration_id, run_id, contract)

    rows = load_staged_rows(conn, run_id, committable_only=True)
    expected = len(rows)

    conflicts = preflight_conflicts(conn, run_id)
    conflicting_keys = set(conflicts["customer_id"])

    if conflicts["email"]:
        raise CommitRefused(
            f"{len(conflicts['email'])} email address(es) already exist in the "
            "destination under a different customer id. No conflict policy covers "
            "a unique constraint other than the primary key."
        )

    if conflicting_keys:
        if conflict_policy is ConflictPolicy.FAIL_CLOSED:
            sample = ", ".join(sorted(conflicting_keys)[:5])
            raise CommitRefused(
                f"{len(conflicting_keys)} destination row(s) already hold these "
                f"identifiers: {sample}. No conflict policy has been approved, so "
                "the commit fails closed rather than skipping them."
            )
        if conflict_policy is ConflictPolicy.ABORT_ON_ANY:
            raise CommitRefused(
                f"{len(conflicting_keys)} identifier(s) already exist and the "
                "approved policy is to abort."
            )

    to_write = [
        row
        for row in rows
        if str(row["values"]["customer_id"]) not in conflicting_keys
    ]
    skipped = expected - len(to_write)

    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO public.customers
                (customer_id, full_name, email, signup_date, balance, region, migration_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            [
                (
                    str(row["values"]["customer_id"]),
                    row["values"]["full_name"],
                    row["values"]["email"],
                    row["values"]["signup_date"],
                    row["values"]["balance"],
                    row["values"].get("region"),
                    migration_id,
                )
                for row in to_write
            ],
        )

        # Count exactly the keys this statement was asked to write, rather
        # than every row the migration owns. Those two numbers agree on a
        # first commit and diverge on any migration that already has rows in
        # the destination, which would make the reconciliation meaningless in
        # precisely the case it exists to catch.
        written_keys = [str(row["values"]["customer_id"]) for row in to_write]
        if written_keys:
            cur.execute(
                """
                SELECT COUNT(*) AS written FROM public.customers
                WHERE migration_id = %s AND customer_id = ANY(%s)
                """,
                (migration_id, written_keys),
            )
            written = cur.fetchone()["written"]
        else:
            written = 0

    if written != len(to_write):
        raise CommitRefused(
            f"Reconciliation failed. {len(to_write)} row(s) were sent and {written} "
            "are present. The transaction is being rolled back."
        )

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO moveproof.commits
                (migration_id, run_id, expected_rows, written_rows, skipped_rows,
                 conflict_policy, committed_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                migration_id,
                run_id,
                expected,
                written,
                skipped,
                conflict_policy.value,
                approved_by,
            ),
        )

    set_state(conn, migration_id, MigrationState.COMMITTED)
    record_approval(
        conn,
        migration_id,
        0,
        f"Committed {written} row(s), {skipped} skipped under {conflict_policy.value}",
        approved_by,
    )
    log_event(
        conn,
        run_id=run_id,
        migration_id=migration_id,
        level="success",
        message=f"Committed {written} of {expected} row(s), {skipped} skipped",
    )
    return {"expected": expected, "written": written, "skipped": skipped}


def mark_verified(conn: psycopg.Connection, run_id: uuid.UUID) -> None:
    """Stamp a run as verified. Called only after checks have been stored."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE moveproof.runs SET verified_at = now() WHERE id = %s", (run_id,)
        )


def remove_committed_rows(conn: psycopg.Connection, migration_id: uuid.UUID) -> int:
    """Delete the destination rows this migration wrote, and nothing else.

    Split out from rollback_migration because deletion needs the same removal
    without the audit trail that follows it. Writing an event about a record
    that is about to be cascade-deleted is work with no reader.
    """
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM public.customers WHERE migration_id = %s", (migration_id,)
        )
        return cur.rowcount or 0


def rollback_migration(
    conn: psycopg.Connection, migration_id: uuid.UUID
) -> int:
    """Remove committed rows for one migration and record that it happened.

    Rollback is scoped to rows this migration wrote, inside this PostgreSQL
    instance. It is not a general undo, and the evidence report says so.

    Existence is established first. `moveproof.events` carries a foreign key to
    `moveproof.migrations`, so logging against an id that was never created
    raises a ForeignKeyViolation from the driver: a clear 404 turns into an
    unhandled database error.
    """
    load_migration(conn, migration_id)

    removed = remove_committed_rows(conn, migration_id)
    set_state(conn, migration_id, MigrationState.ROLLED_BACK)
    log_event(conn, migration_id, None, "warn", f"Rolled back {removed} row(s)")
    return removed


def count_committed_rows(conn: psycopg.Connection, migration_id: uuid.UUID) -> int:
    """How many destination rows this migration still holds."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) AS n FROM public.customers WHERE migration_id = %s",
            (migration_id,),
        )
        return cur.fetchone()["n"]


def purge_migration(conn: psycopg.Connection, migration_id: uuid.UUID) -> None:
    """Delete a migration and its derived control plane data.

    Deliberately does not touch the destination. Removing committed rows is a
    separate, explicitly requested act, and letting deletion do it as a side
    effect would make destination data disappear through a button labelled
    something else.

    The assertion below is defence in depth: if a caller ever reaches here with
    rows still committed, the delete is refused rather than orphaning them.

    No event is written. The audit trail is part of what is being destroyed,
    and a row inserted microseconds before its own cascade has no reader.
    """
    load_migration(conn, migration_id)

    remaining = count_committed_rows(conn, migration_id)
    if remaining:
        raise CommitRefused(
            f"This migration still holds {remaining} committed destination row(s). "
            "Roll it back before deleting."
        )

    with conn.cursor() as cur:
        cur.execute("DELETE FROM moveproof.migrations WHERE id = %s", (migration_id,))
