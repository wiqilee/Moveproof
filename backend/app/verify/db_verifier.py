"""Verification against staged rows read back from PostgreSQL.

The in-memory verifier compares Python objects. This one reads the source rows
and the staged rows out of the database first, so what is checked is what was
actually written rather than what the executor believed it wrote.

That distinction matters. A JSON round trip, a type adapter or a truncating
column would all be invisible to an in-memory check and visible here.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import psycopg

from app.db import repository
from app.domain.types import (
    Check,
    DestinationSchema,
    ExecutionResult,
    RowAccounting,
    RowDisposition,
    SourceRow,
    StagedRow,
)
from app.domain.verification import source_rows_by_destination, verify


@dataclass
class DatabaseVerification:
    checks: list[Check]
    source_rows: int
    staged_rows: int
    transform_errors: int
    plan_version: str


def verify_run(
    conn: psycopg.Connection,
    migration_id: uuid.UUID,
    run_id: uuid.UUID,
    schema: DestinationSchema,
    # No default. A shared verifier that silently assumes the customer key
    # would check a column the robotics destination does not have, and report
    # a pass for a property it never examined. The caller names it.
    key_column: str,
    # Required, like key_column. A shared verifier holding a customer default
    # would report customer limitations on a robotics report.
    unverified_properties: tuple[tuple[str, str, str], ...],
    # The customer default is dropped here too: a date column named for one
    # destination is wrong for the other.
    date_columns: tuple[str, ...] = (),
    reconciliation_fields: tuple[str, ...] = (),
    identity_columns: tuple[str, ...] = (),
    #: Read from the approved plan by the caller, never from a request.
    date_format_policy: str | None = None,
    decimal_conventions: dict[str, str] | None = None,
    #: Destination column -> the source column the approved plan read it
    #: from. Read from the approved plan by the caller, like the policies.
    column_sources: dict[str, str] | None = None,
) -> DatabaseVerification:
    """Verify one run against the destination it was staged for.

    `key_column` is the identifier whose exact form must survive, which for
    robotics is robot_id and is not on its own unique. `identity_columns` is
    what makes a row distinct in the destination, which for robotics is
    (robot_id, joint_name). Conflating the two would report three joints of
    the same robot as duplicates.

    The defaults describe the customer destination, so a caller that predates
    profiles keeps its behaviour. Every caller in the product passes the
    destination profile's own values.
    """
    source_rows: list[SourceRow] = repository.load_source_rows(conn, migration_id)
    # Every check reads a source value under its destination column name.
    # A file that names a column differently is read through the plan.
    source_rows = source_rows_by_destination(source_rows, column_sources)
    staged_records = repository.load_staged_rows(conn, run_id)

    staged: list[StagedRow] = [
        StagedRow(
            row_number=record["row_number"],
            source_key=record["source_key"],
            values=record["values"],
            disposition=RowDisposition(record["disposition"]),
            reason=record["reason"],
        )
        for record in staged_records
    ]

    accounting = RowAccounting(
        source_rows=len(source_rows),
        duplicates_excluded=sum(
            1 for row in staged if row.disposition is RowDisposition.DUPLICATE_EXCLUDED
        ),
        conflicts_unresolved=sum(
            1 for row in staged if row.disposition is RowDisposition.CONFLICT_UNRESOLVED
        ),
        quarantined=sum(
            1 for row in staged if row.disposition is RowDisposition.QUARANTINED
        ),
        policy_excluded=sum(
            1 for row in staged if row.disposition is RowDisposition.POLICY_EXCLUDED
        ),
        rejected=sum(1 for row in staged if row.disposition is RowDisposition.REJECTED),
    )

    # Execution evidence is read back rather than assumed. An earlier version
    # of this function passed errors=[] and applied_operations=[], which meant
    # a rejected transformation became invisible after storage: the verifier
    # would report that nothing had been rejected when rows had been.
    errors = repository.load_transform_errors(conn, run_id)
    run_record = repository.load_run(conn, run_id)
    applied = run_record.get("applied_operations") or []

    reconstructed = ExecutionResult(
        plan_version=f"v{run_record['plan_version']}",
        staged=staged,
        accounting=accounting,
        errors=errors,
        applied_operations=list(applied),
    )

    checks = verify(
        source_rows,
        reconstructed,
        schema,
        key_column=key_column,
        destination_key_column=key_column,
        date_columns=date_columns,
        unverified_properties=unverified_properties,
        reconciliation_fields=reconciliation_fields,
        identity_columns=identity_columns,
        date_format_policy=date_format_policy,
        decimal_conventions=decimal_conventions,
    )
    return DatabaseVerification(
        checks=checks,
        source_rows=len(source_rows),
        staged_rows=len(staged),
        transform_errors=len(errors),
        plan_version=reconstructed.plan_version,
    )
