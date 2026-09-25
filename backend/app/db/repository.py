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

import hashlib
import json
import uuid
from dataclasses import asdict
from datetime import date
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from app.domain.contract import VerificationContract
from app.domain.profiles import DestinationProfile, resolve as resolve_profile

#: Key used by preflight_conflicts to report a composite-key collision as one
#: value per row, so a caller can exclude exactly the colliding rows.
COMPOSITE_KEY = "__key__"


def _join_key(values: tuple[str, ...]) -> str:
    """Render a composite key as one comparable string."""
    return "\u001f".join(str(value) for value in values)
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
    destination_profile: str | None = None,
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
                 source_columns, row_count, state, destination_profile)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                destination_profile,
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


def profile_for_migration(
    conn: psycopg.Connection, migration_id: uuid.UUID
) -> DestinationProfile:
    """Which destination this migration targets.

    A migration recorded before the column existed stores NULL, and resolve()
    reads that as the customer profile, which is what those rows have always
    been. Nothing is backfilled: the absence is already the answer.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT destination_profile FROM moveproof.migrations WHERE id = %s",
            (migration_id,),
        )
        record = cur.fetchone()
    if record is None:
        raise NotFound(f"No migration {migration_id}")
    return resolve_profile(record["destination_profile"])


def profile_for_run(conn: psycopg.Connection, run_id: uuid.UUID) -> DestinationProfile:
    """The profile of the migration a run belongs to."""
    with conn.cursor() as cur:
        cur.execute("SELECT migration_id FROM moveproof.runs WHERE id = %s", (run_id,))
        record = cur.fetchone()
    if record is None:
        raise NotFound(f"No run {run_id}")
    return profile_for_migration(conn, record["migration_id"])


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


def next_plan_version(conn: psycopg.Connection, migration_id: uuid.UUID) -> int:
    """One past the highest version, approved or not.

    Proposals and approvals share the version sequence, so a stored proposal
    can never collide with an approved plan and both stay on the record.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COALESCE(MAX(version), 0) AS v FROM moveproof.plans "
            "WHERE migration_id = %s",
            (migration_id,),
        )
        return int(cur.fetchone()["v"]) + 1


def proposal_hash(plan: MigrationPlan) -> str:
    """A stable fingerprint of a plan body.

    Approval quotes this back. If the stored proposal has moved on since the
    browser rendered it, the hashes disagree and the approval is refused
    rather than applied to a plan nobody looked at.
    """
    body = json.dumps(_plan_body(plan), sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(body.encode("utf-8")).hexdigest()


def store_proposal(
    conn: psycopg.Connection,
    migration_id: uuid.UUID,
    plan: MigrationPlan,
    source: str,
) -> dict[str, Any]:
    """Persist a validated proposal, unapproved, and return its identity.

    Stored as an ordinary plan row with no approver and no approval time, so
    it is visible in the plan history and immutable like every other version.
    """
    version = next_plan_version(conn, migration_id)
    stored = MigrationPlan(
        version=version,
        mappings=plan.mappings,
        proposed_by=plan.proposed_by,
        key_column=plan.key_column,
        date_format_policy=plan.date_format_policy,
        duplicate_policy=plan.duplicate_policy,
        required_field_policy=plan.required_field_policy,
        conflict_policy=plan.conflict_policy,
    )
    save_plan(conn, migration_id, stored)
    return {
        "version": version,
        "hash": proposal_hash(stored),
        "source": source,
        "proposed_by": stored.proposed_by,
    }


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
    # The staging table is decided by the destination, which is resolved from
    # the migration rather than assumed. Without this the function referred to
    # a `profile` it never defined.
    profile = profile_for_migration(conn, migration_id)

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
        # The table name is an allowlisted literal from the profile registry,
        # never anything derived from a request.
        cur.executemany(
            f"""
            INSERT INTO {profile.staging_table}
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
    conn: psycopg.Connection,
    run_id: uuid.UUID,
    committable_only: bool = False,
    profile: DestinationProfile | None = None,
) -> list[dict[str, Any]]:
    """Staged rows for one run, from that run's own staging table.

    `profile` is resolved from the run when it is not supplied, so every
    existing caller keeps working and a customer run keeps reading
    staging.customers.
    """
    profile = profile or profile_for_run(conn, run_id)
    clause = "AND disposition = 'staged'" if committable_only else ""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT row_number, source_key, values, disposition, reason
            FROM {profile.staging_table}
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
                   m.created_at, m.updated_at, m.destination_profile,
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
            SELECT run_id, level, message, event_type, metadata, created_at
            FROM moveproof.events WHERE migration_id = %s ORDER BY id
            """,
            (migration_id,),
        )
        return [dict(record) for record in cur.fetchall()]


# --------------------------------------------------------------------- commit


def _composite_match(table: str, columns: tuple[str, ...]) -> str:
    """A join that matches rows on a multi-column key.

    `(a, b) = ANY(%s)` reads naturally but requires a registered composite
    type on the server; a Python list of tuples does not adapt to one. This
    joins against two unnested arrays instead, which is ordinary SQL and fully
    parameterised.

    Only column and table names are interpolated, and every one of them comes
    from the profile registry allowlist. Values are always bound.
    """
    first, second = columns
    return f"""
        FROM {table} AS t
        JOIN (
            SELECT unnest(%s::text[]) AS k1, unnest(%s::text[]) AS k2
        ) AS k ON t.{first}::text = k.k1 AND t.{second}::text = k.k2
    """


def preflight_conflicts(
    conn: psycopg.Connection,
    run_id: uuid.UUID,
    profile: DestinationProfile | None = None,
) -> dict[str, list[str]]:
    """Find destination rows that would collide before writing anything.

    Every uniqueness constraint the profile declares is checked, not only the
    key. A collision discovered mid-insert would otherwise surface as an
    integrity error with part of the batch already written.

    The two profiles differ in shape, and the difference is real. A customer is
    unique by `customer_id`, and separately by `email`. A robot calibration is
    unique by the pair `(robot_id, joint_name)`: one robot has many joints, so
    neither column identifies a row on its own.

    Returns one list per declared unique column, plus `COMPOSITE_KEY` holding
    the colliding keys as joined tuples, which is what a caller needs in order
    to exclude exactly the colliding rows.
    """
    profile = profile or profile_for_run(conn, run_id)
    rows = load_staged_rows(conn, run_id, committable_only=True, profile=profile)

    conflicts: dict[str, list[str]] = {
        column: [] for column in (*profile.key_columns, *profile.unique_columns)
    }
    conflicts[COMPOSITE_KEY] = []
    if not rows:
        return conflicts

    # Every identifier below comes from the profile registry, never a request.
    table = profile.destination_table
    key_columns = profile.key_columns
    keys = [profile.key_of(row["values"]) for row in rows]

    with conn.cursor() as cur:
        if len(key_columns) == 1:
            column = key_columns[0]
            cur.execute(
                f"SELECT {column} FROM {table} WHERE {column} = ANY(%s)",
                ([key[0] for key in keys],),
            )
            found = [(record[column],) for record in cur.fetchall()]
            conflicts[column] = sorted(value for (value,) in found)
        else:
            first, second = key_columns
            cur.execute(
                f"SELECT t.{first}, t.{second} {_composite_match(table, (first, second))}",
                ([key[0] for key in keys], [key[1] for key in keys]),
            )
            found = [(record[first], record[second]) for record in cur.fetchall()]
            conflicts[first] = sorted({value for value, _ in found})
            conflicts[second] = sorted({value for _, value in found})

        conflicts[COMPOSITE_KEY] = sorted(_join_key(key) for key in found)

        # Unique columns outside the key, checked independently. A row whose
        # key already collides is excluded, so one row is reported once.
        for column in profile.unique_columns:
            values = [str(row["values"][column]) for row in rows]
            cur.execute(
                f"""
                SELECT {column} FROM {table}
                WHERE {column} = ANY(%s) AND {key_columns[0]} <> ALL(%s)
                """,
                (values, [key[0] for key in keys]),
            )
            conflicts[column] = sorted(record[column] for record in cur.fetchall())

    return conflicts


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

    # The destination is decided by the migration, never by the request.
    profile = profile_for_migration(conn, migration_id)

    rows = load_staged_rows(conn, run_id, committable_only=True, profile=profile)
    expected = len(rows)

    conflicts = preflight_conflicts(conn, run_id, profile=profile)
    conflicting_keys = set(conflicts[COMPOSITE_KEY])

    # A unique constraint outside the key is never covered by a conflict
    # policy. Skipping such a row would leave the destination holding somebody
    # else's value under this migration's name.
    for column in profile.unique_columns:
        colliding = conflicts.get(column) or []
        if colliding:
            raise CommitRefused(
                f"{len(colliding)} value(s) in {column} already exist in the "
                f"destination under a different {profile.key_columns[0]}. No "
                "conflict policy covers a unique constraint other than the key."
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
        row for row in rows if _join_key(profile.key_of(row["values"])) not in conflicting_keys
    ]
    skipped = expected - len(to_write)

    # Column list and placeholders are built from the profile's allowlisted
    # write columns, so the statement is fixed for a given destination and no
    # part of it comes from the data.
    columns = ", ".join(profile.write_columns)
    placeholders = ", ".join(["%s"] * len(profile.write_columns))
    key_set = set(profile.key_columns)

    with conn.cursor() as cur:
        cur.executemany(
            f"""
            INSERT INTO {profile.destination_table}
                ({columns}, migration_id)
            VALUES ({placeholders}, %s)
            """,
            [
                (
                    *(
                        # Identifiers keep their text form. Everything else is
                        # written as the executor produced it, already typed.
                        str(row["values"][column])
                        if column in key_set
                        else row["values"].get(column)
                        for column in profile.write_columns
                    ),
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
        written_keys = [profile.key_of(row["values"]) for row in to_write]
        if written_keys:
            if len(profile.key_columns) == 1:
                column = profile.key_columns[0]
                cur.execute(
                    f"""
                    SELECT COUNT(*) AS written FROM {profile.destination_table}
                    WHERE migration_id = %s AND {column} = ANY(%s)
                    """,
                    (migration_id, [key[0] for key in written_keys]),
                )
            else:
                first, second = profile.key_columns
                match = _composite_match(profile.destination_table, (first, second))
                cur.execute(
                    f"SELECT COUNT(*) AS written {match} WHERE t.migration_id = %s",
                    (
                        [key[0] for key in written_keys],
                        [key[1] for key in written_keys],
                        migration_id,
                    ),
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


def remove_committed_rows(
    conn: psycopg.Connection,
    migration_id: uuid.UUID,
    profile: DestinationProfile | None = None,
) -> int:
    """Delete the destination rows this migration wrote, and nothing else.

    Split out from rollback_migration because deletion needs the same removal
    without the audit trail that follows it. Writing an event about a record
    that is about to be cascade-deleted is work with no reader.

    Scoped by migration and by that migration's own destination table, so a
    robotics rollback cannot reach customer rows and a customer rollback
    cannot reach robotics rows.
    """
    profile = profile or profile_for_migration(conn, migration_id)
    with conn.cursor() as cur:
        cur.execute(
            f"DELETE FROM {profile.destination_table} WHERE migration_id = %s",
            (migration_id,),
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


def count_committed_rows(
    conn: psycopg.Connection,
    migration_id: uuid.UUID,
    profile: DestinationProfile | None = None,
) -> int:
    """How many destination rows this migration still holds."""
    profile = profile or profile_for_migration(conn, migration_id)
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT COUNT(*) AS n FROM {profile.destination_table} "
            "WHERE migration_id = %s",
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
