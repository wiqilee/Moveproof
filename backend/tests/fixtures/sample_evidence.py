"""A canonical evidence object used by the report tests.

This is a fixture, not a source of truth for the application. It mirrors the
structure `app.services.evidence.build_evidence` produces so the report
renderers can be tested without a database.
"""

from __future__ import annotations

from typing import Any


def sample_evidence(committed: bool = False, failed: bool = True) -> dict[str, Any]:
    checks = [
        {
            "check_id": "row_accounting",
            "name": "Source and staging row accounting",
            "expected": "Every source row has exactly one disposition",
            "observed": "4 source rows, 4 accounted for",
            "status": "passed",
            "mandatory": True,
            "evidence": [],
            "checked_at": "2026-09-09T08:00:00+00:00",
        },
        {
            "check_id": "identifier_preservation",
            "name": "Unique identifier preservation",
            "expected": "customer_id matches the source value exactly, as a string",
            "observed": "4 row(s) differ. 00127 became 127." if failed else "All identifiers match",
            "status": "failed" if failed else "passed",
            "mandatory": True,
            "evidence": (
                [
                    {
                        "row_key": "00127",
                        "field": "customer_id",
                        "source_value": "00127",
                        "destination_value": "127",
                    }
                ]
                if failed
                else []
            ),
            "checked_at": "2026-09-09T08:00:00+00:00",
        },
        {
            "check_id": "decimal_precision",
            "name": "Decimal precision preservation",
            "expected": "Every staged decimal equals its source value exactly",
            "observed": "4 decimal value(s) compared, all exact",
            "status": "passed",
            "mandatory": True,
            "evidence": [],
            "checked_at": "2026-09-09T08:00:00+00:00",
        },
        {
            "check_id": "date_parsing",
            "name": "Date parsing and format confirmation",
            "expected": "Every date has one unambiguous reading",
            "observed": "1 value reads as either day first or month first",
            "status": "review",
            "mandatory": True,
            "evidence": [
                {
                    "row_key": "00129",
                    "field": "signup_date",
                    "source_value": "03/04/2024",
                    "destination_value": "2024-04-03",
                }
            ],
            "checked_at": "2026-09-09T08:00:00+00:00",
        },
        {
            "check_id": "aggregate_reconciliation",
            "name": "Aggregate reconciliation",
            "expected": "Row sums reconcile against a ledger",
            "observed": "No ledger is configured for this schema",
            "status": "not_verified",
            "mandatory": False,
            "evidence": [],
            "checked_at": None,
        },
    ]

    summary = {
        "passed": sum(1 for c in checks if c["status"] == "passed"),
        "failed": sum(1 for c in checks if c["status"] == "failed"),
        "review": sum(1 for c in checks if c["status"] == "review"),
        "not_verified": sum(1 for c in checks if c["status"] == "not_verified"),
        "total": len(checks),
    }

    discrepancies = [
        {
            "check_id": check["check_id"],
            "check_name": check["name"],
            "status": check["status"],
            **entry,
        }
        for check in checks
        if check["status"] in ("failed", "review")
        for entry in check["evidence"]
    ]

    return {
        "schema_version": "moveproof.evidence.v1",
        "migration_id": "3f2a9c14-7b6e-4d58-9a01-6c2e4b8d5f70",
        "run_id": "9d7e0412-3a5b-4c6d-8e9f-0a1b2c3d4e5f",
        "state": "committed" if committed else "verification_failed",
        "source_file": {
            "filename": "customers_export.csv",
            "content_type": "text/csv",
            "byte_size": 1432,
            "checksum": "sha256:3e9a1c74b0d85f2a6c31e8047d5b9a1fc2e70b93aa4d16c8e5f2b0743c91f02b",
            "uploaded_by": "operator",
            "uploaded_at": "2026-09-09T07:58:00+00:00",
            "row_count": 4,
            "columns": ["customer_id", "full_name", "email", "signup_date", "balance", "region"],
        },
        "destination": {"schema": "public.customers", "schema_version": "v1"},
        "plan": {
            "version": 1,
            "proposed_by": "legacy-import-profile",
            "approved_by": "operator",
            "approved_at": "2026-09-09T07:59:00+00:00",
            "acknowledgements": ["customer_id"],
            "conflict_policy": "fail_closed",
            "contract_hash": "sha256:abc123",
            "mappings": [
                {
                    "source_column": "customer_id",
                    "destination_column": "customer_id",
                    "operation": "cast_to_integer",
                    "status": "approved",
                    "note": "Type cast risk",
                    "requires_acknowledgement": True,
                },
                {
                    "source_column": "balance",
                    "destination_column": "balance",
                    "operation": "cast_to_decimal",
                    "status": "approved",
                    "note": None,
                    "requires_acknowledgement": False,
                },
            ],
        },
        "contract": {"version": "vc-1", "hash": "sha256:abc123", "exclusions": []},
        "execution": {
            "started_at": "2026-09-09T07:59:30+00:00",
            "finished_at": "2026-09-09T07:59:40+00:00",
            "verified_at": "2026-09-09T08:00:00+00:00",
            "applied_operations": ["customer_id -> customer_id: cast_to_integer"],
            "transform_errors": [
                {
                    "row_number": 4,
                    "source_key": "00130",
                    "field": "signup_date",
                    "source_value": "2024-02-30",
                    "reason": "not a real calendar date under the approved policy",
                }
            ],
        },
        "row_accounting": {
            "source_rows": 4,
            "duplicates_excluded": 0,
            "rejected": 1,
            "staged_rows": 3,
            "quarantined": 0,
            "policy_excluded": 0,
            "conflicts_unresolved": 0,
            "committable_rows": 3,
            "arithmetic": [
                "4 source rows",
                "minus 1 rejected at transformation",
                "equals 3 staged rows",
                "equals 3 rows eligible to commit",
            ],
        },
        "verification": {"summary": summary, "checks": checks},
        "discrepancies": discrepancies,
        "approvals": [
            {
                "action": "Approved plan v1, acknowledging customer_id",
                "plan_version": 1,
                "approved_by": "operator",
                "approved_at": "2026-09-09T07:59:00+00:00",
            }
        ],
        "commit": (
            {
                "committed_at": "2026-09-09T08:01:00+00:00",
                "committed_by": "operator",
                "expected_rows": 3,
                "written_rows": 3,
                "skipped_rows": 0,
                "conflict_policy": "fail_closed",
            }
            if committed
            else None
        ),
        "limitations": [
            "Aggregate reconciliation against a source of truth ledger. No ledger is configured.",
            "Referential integrity with related tables. This migration targets a single table.",
        ],
        "not_verified": ["Aggregate reconciliation"],
        "disclaimer": (
            "A passed verification means the invariants in this contract held. It does "
            "not mean every possible semantic error has been ruled out. Human approvals "
            "recorded here are audit entries, not cryptographic signatures."
        ),
    }
