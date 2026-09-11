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
from app.domain.schema import UNVERIFIED_PROPERTIES
from app.domain.types import (
    Check,
    DestinationSchema,
    ExecutionResult,
    RowAccounting,
    RowDisposition,
    SourceRow,
    StagedRow,
)
from app.domain.verification import verify


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
    key_column: str = "customer_id",
    date_columns: tuple[str, ...] = ("signup_date",),
    reconciliation_fields: tuple[str, ...] = (),
) -> DatabaseVerification:
    source_rows: list[SourceRow] = repository.load_source_rows(conn, migration_id)
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
        unverified_properties=UNVERIFIED_PROPERTIES,
        reconciliation_fields=reconciliation_fields,
    )
    return DatabaseVerification(
        checks=checks,
        source_rows=len(source_rows),
        staged_rows=len(staged),
        transform_errors=len(errors),
        plan_version=reconstructed.plan_version,
    )
