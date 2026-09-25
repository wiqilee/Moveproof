"""The verification contract.

A contract names the checks a migration must have executed before a commit is
permitted, and hashes itself so an approval can be bound to it. Approving a
plan under one contract and committing under a different one is then a
detectable error rather than a silent substitution.

Splitting mandatory from advisory matters. A mandatory check that never ran is
not a pass, and the commit gate treats a missing result exactly as it treats a
failure.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field

# Checks that must be present and resolved before any commit. A result that is
# absent from the stored set blocks the commit as firmly as a failed one.
MANDATORY_CHECKS: tuple[str, ...] = (
    "row_accounting",
    "identifier_preservation",
    "duplicate_detection",
    "required_field_validation",
    "uniqueness",
    "decimal_precision",
    "date_parsing",
    "transform_rejections",
)

# Checks that are reported but do not gate a commit, because the contract
# declares them out of scope for this schema.
ADVISORY_CHECKS: tuple[str, ...] = (
    "aggregate_reconciliation",
    "referential_integrity",
    # Advisory rather than mandatory on purpose. It is a whole-row cross check
    # over the field level rules, and an unbuilt Rust binary must not become a
    # reason a correct migration cannot be committed. When it does run and
    # fails, it fails loudly.
    "canonical_reconciliation",
)


@dataclass(frozen=True)
class VerificationContract:
    version: str
    destination_schema: str
    destination_schema_version: str
    key_column: str
    date_columns: tuple[str, ...]
    """Columns whose destination value must equal the source value exactly.

    Only identity preserving columns belong here. Including a column the plan
    casts would compare a typed value against the text it was derived from,
    which fails on a correct migration.
    """
    reconciliation_fields: tuple[str, ...] = ()
    mandatory_checks: tuple[str, ...] = MANDATORY_CHECKS
    advisory_checks: tuple[str, ...] = ADVISORY_CHECKS
    exclusions: tuple[str, ...] = field(default_factory=tuple)

    def as_dict(self) -> dict[str, object]:
        return {
            "version": self.version,
            "destination_schema": self.destination_schema,
            "destination_schema_version": self.destination_schema_version,
            "key_column": self.key_column,
            "date_columns": list(self.date_columns),
            "reconciliation_fields": list(self.reconciliation_fields),
            "mandatory_checks": list(self.mandatory_checks),
            "advisory_checks": list(self.advisory_checks),
            "exclusions": list(self.exclusions),
        }

    def hash(self) -> str:
        """A stable fingerprint of the contract.

        `sort_keys` keeps the digest independent of dictionary ordering, so the
        same contract always hashes the same way across processes.
        """
        payload = json.dumps(self.as_dict(), sort_keys=True, separators=(",", ":"))
        return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def missing_checks(self, executed_ids: set[str]) -> tuple[str, ...]:
        return tuple(c for c in self.mandatory_checks if c not in executed_ids)

    def is_mandatory(self, check_id: str) -> bool:
        return check_id in self.mandatory_checks


CUSTOMERS_CONTRACT_V1 = VerificationContract(
    version="vc-1",
    destination_schema="public.customers",
    destination_schema_version="v1",
    key_column="customer_id",
    date_columns=("signup_date",),
    # Identity preserving columns only. A column the plan casts or parses is
    # checked by the rule written for it, not by comparing the result against
    # the raw text it came from.
    reconciliation_fields=("customer_id", "full_name", "email"),
    exclusions=(
        "Aggregate reconciliation against a source of truth ledger. No ledger is configured.",
        "Referential integrity with related tables. This migration targets a single table.",
    ),
)


ROBOT_CALIBRATION_CONTRACT_V1 = VerificationContract(
    version="vc-r1",
    destination_schema="public.robot_calibrations",
    destination_schema_version="v1",
    key_column="robot_id",
    date_columns=("calibration_date",),
    # Identity preserving columns only, exactly as on the customer contract.
    # robot_id and firmware_version are text that must arrive unchanged:
    # 0017 is not 17, and 3.08 is a version string rather than a number.
    # zero_offset_deg and gear_ratio are cast, so they are checked by the
    # decimal rule rather than compared against the text they came from.
    reconciliation_fields=(
        "robot_id",
        "joint_name",
        "firmware_version",
        "sensor_frame",
    ),
    exclusions=(
        "Aggregate reconciliation against a calibration ledger. No ledger is configured.",
        "Referential integrity with a robot registry. This migration targets a single table.",
        (
            "Physical validity of a calibration. MoveProof verifies that recorded "
            "values survived the migration and makes no claim about robot safety."
        ),
    ),
)
