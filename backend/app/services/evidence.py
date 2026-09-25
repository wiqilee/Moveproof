"""The canonical evidence object.

One structure, assembled from stored records. The HTML view, the JSON export
and the PDF all render this and nothing else, which is what stops them
disagreeing about the same migration.

Nothing here is written by a model. A model may help explain a result
elsewhere in the product, but every value in this object comes from the
database.
"""

from __future__ import annotations

import uuid
from typing import Any

import psycopg

from app.db import repository
from app.domain.contract import VerificationContract
from app.domain.types import RowAccounting, RowDisposition


def _iso(value: Any) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else value


def _normalise_evidence(check: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
    """Render one piece of evidence in the shape every consumer expects.

    The field name is read defensively. `Evidence.to_dict` emits `field`, but a
    row written by an earlier build carries `field_name`, and a missing key
    here would turn an entire report into a 500. A report about data integrity
    should not fall over on its own serialisation.
    """
    return {
        "check_id": check["check_id"],
        "check_name": check["name"],
        "status": check["status"],
        "row_key": entry.get("row_key", ""),
        "field": entry.get("field", entry.get("field_name", "")),
        "source_value": entry.get("source_value", ""),
        "destination_value": entry.get("destination_value", ""),
    }


def build_evidence(
    conn: psycopg.Connection,
    migration_id: uuid.UUID,
    run_id: uuid.UUID,
    contract: VerificationContract,
) -> dict[str, Any]:
    migration = repository.load_migration(conn, migration_id)
    source_meta = repository.source_file_metadata(conn, migration_id)
    run = repository.load_run(conn, run_id)
    plan = repository.load_plan(conn, migration_id, run["plan_version"])
    checks = repository.load_checks(conn, run_id)
    errors = repository.load_transform_errors(conn, run_id)
    approvals = repository.list_approvals(conn, migration_id)
    staged = repository.load_staged_rows(conn, run_id)
    commit_record = repository.load_commit(conn, run_id)

    dispositions: dict[str, int] = {}
    for row in staged:
        dispositions[row["disposition"]] = dispositions.get(row["disposition"], 0) + 1

    accounting = RowAccounting(
        source_rows=migration["row_count"],
        duplicates_excluded=dispositions.get(RowDisposition.DUPLICATE_EXCLUDED.value, 0),
        conflicts_unresolved=dispositions.get(RowDisposition.CONFLICT_UNRESOLVED.value, 0),
        quarantined=dispositions.get(RowDisposition.QUARANTINED.value, 0),
        policy_excluded=dispositions.get(RowDisposition.POLICY_EXCLUDED.value, 0),
        rejected=dispositions.get(RowDisposition.REJECTED.value, 0),
    )

    summary = {
        "passed": sum(1 for c in checks if c["status"] == "passed"),
        "failed": sum(1 for c in checks if c["status"] == "failed"),
        "review": sum(1 for c in checks if c["status"] == "review"),
        "not_verified": sum(1 for c in checks if c["status"] == "not_verified"),
        "total": len(checks),
    }

    discrepancies = [
        _normalise_evidence(check, entry)
        for check in checks
        if check["status"] in ("failed", "review")
        for entry in (check["evidence"] or [])
    ]

    return {
        "schema_version": "moveproof.evidence.v1",
        "migration_id": str(migration_id),
        "run_id": str(run_id),
        "state": migration["state"],
        "source_file": {
            "filename": source_meta["filename"],
            "content_type": source_meta["content_type"],
            "byte_size": source_meta["byte_size"],
            "checksum": source_meta["checksum"],
            "uploaded_by": source_meta["uploaded_by"],
            "uploaded_at": _iso(source_meta["uploaded_at"]),
            "row_count": migration["row_count"],
            "columns": migration["source_columns"],
        },
        "destination": {
            # The profile is resolved from the migration rather than passed in,
            # so an evidence report always names the destination the rows
            # actually went to. A migration recorded before profiles existed
            # resolves to the customer profile, which is what it has always been.
            "profile": repository.profile_for_migration(conn, migration_id).id,
            "schema": contract.destination_schema,
            "schema_version": contract.destination_schema_version,
            "table": contract.destination_schema,
        },
        "plan": {
            "version": plan["version"],
            "proposed_by": plan["proposed_by"],
            "approved_by": plan["approved_by"],
            "approved_at": _iso(plan["approved_at"]),
            "acknowledgements": plan["acknowledgements"],
            "conflict_policy": plan["conflict_policy"],
            "contract_hash": plan["contract_hash"],
            "mappings": plan["body"]["mappings"],
        },
        "contract": {
            **contract.as_dict(),
            "hash": contract.hash(),
        },
        "execution": {
            "started_at": _iso(run["started_at"]),
            "finished_at": _iso(run["finished_at"]),
            "verified_at": _iso(run["verified_at"]),
            "applied_operations": run["applied_operations"] or [],
            "transform_errors": [
                {
                    "row_number": error.row_number,
                    "source_key": error.source_key,
                    "field": error.field_name,
                    "source_value": error.source_value,
                    "reason": error.reason,
                }
                for error in errors
            ],
        },
        "row_accounting": {
            "source_rows": accounting.source_rows,
            "duplicates_excluded": accounting.duplicates_excluded,
            "rejected": accounting.rejected,
            "staged_rows": accounting.staged_rows,
            "quarantined": accounting.quarantined,
            "policy_excluded": accounting.policy_excluded,
            "conflicts_unresolved": accounting.conflicts_unresolved,
            "committable_rows": accounting.committable_rows,
            "arithmetic": accounting.as_arithmetic(),
        },
        "verification": {
            "summary": summary,
            "checks": [
                {
                    "check_id": check["check_id"],
                    "name": check["name"],
                    "expected": check["expected"],
                    "observed": check["observed"],
                    "status": check["status"],
                    "mandatory": contract.is_mandatory(check["check_id"]),
                    "evidence": check["evidence"],
                    "checked_at": _iso(check["checked_at"]),
                }
                for check in checks
            ],
        },
        "discrepancies": discrepancies,
        "approvals": [
            {
                "action": approval["action"],
                "plan_version": approval["plan_version"],
                "approved_by": approval["approved_by"],
                "approved_at": _iso(approval["approved_at"]),
            }
            for approval in approvals
        ],
        "commit": (
            {
                "committed_at": _iso(commit_record["committed_at"]),
                "committed_by": commit_record["committed_by"],
                "expected_rows": commit_record["expected_rows"],
                "written_rows": commit_record["written_rows"],
                "skipped_rows": commit_record["skipped_rows"],
                "conflict_policy": commit_record["conflict_policy"],
            }
            if commit_record
            else None
        ),
        "limitations": list(contract.exclusions),
        "not_verified": [
            check["name"] for check in checks if check["status"] == "not_verified"
        ],
        "disclaimer": (
            "A passed verification means the invariants in this contract held. "
            "It does not mean every possible semantic error has been ruled out. "
            "Human approvals recorded here are audit entries, not cryptographic "
            "signatures."
        ),
    }
