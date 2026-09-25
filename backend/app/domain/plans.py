"""Deterministic plan builders.

Two baselines, both available without any credential:

    safe    every column carried across under the operation that preserves it
    legacy  the same plan with one deliberately unsafe cast, so the failure
            this product exists to catch can be demonstrated from a real
            approved plan rather than a hardcoded result

Both are written per destination. A robotics migration asking for the safe
baseline must not receive customer mappings, so the mappings are declared next
to the destination they belong to rather than inferred from column names.

Adding a destination means adding one entry to `PROFILE_PLANS`. It does not
mean a second pipeline: everything downstream still receives an ordinary
MigrationPlan.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.domain.types import (
    DateFormatPolicy,
    DuplicatePolicy,
    Mapping,
    MigrationPlan,
    Operation,
    RequiredFieldPolicy,
)

#: The customer mappings. Kept under the original name because callers that
#: predate profiles import it directly.
SAFE_MAPPINGS = (
    Mapping("customer_id", "customer_id", Operation.PRESERVE_IDENTIFIER_AS_STRING),
    Mapping("full_name", "full_name", Operation.NORMALIZE_WHITESPACE),
    Mapping("email", "email", Operation.RENAME_FIELD),
    Mapping("signup_date", "signup_date", Operation.PARSE_DATE),
    Mapping("balance", "balance", Operation.CAST_TO_DECIMAL, options={"scale": 2}),
    Mapping("region", "region", Operation.NULL_HANDLING),
)

ROBOTICS_SAFE_MAPPINGS = (
    # The identifier. 0017 must arrive as 0017.
    Mapping("robot_id", "robot_id", Operation.PRESERVE_IDENTIFIER_AS_STRING),
    Mapping("joint_name", "joint_name", Operation.NORMALIZE_WHITESPACE),
    Mapping(
        "zero_offset_deg",
        "zero_offset_deg",
        Operation.CAST_TO_DECIMAL,
        options={"scale": 3},
    ),
    Mapping(
        "gear_ratio", "gear_ratio", Operation.CAST_TO_DECIMAL, options={"scale": 4}
    ),
    # A firmware version is text. Read as a number, 3.08 loses its trailing
    # zero and stops matching the build it names.
    Mapping(
        "firmware_version",
        "firmware_version",
        Operation.PRESERVE_IDENTIFIER_AS_STRING,
    ),
    Mapping("sensor_frame", "sensor_frame", Operation.NORMALIZE_WHITESPACE),
    Mapping("calibration_date", "calibration_date", Operation.PARSE_DATE),
)


@dataclass(frozen=True)
class ProfilePlans:
    """The two deterministic baselines for one destination."""

    key_column: str
    safe_mappings: tuple[Mapping, ...]
    #: The column the legacy profile damages, and how.
    legacy_column: str
    legacy_operation: Operation


PROFILE_PLANS: dict[str, ProfilePlans] = {
    "customers_v1": ProfilePlans(
        key_column="customer_id",
        safe_mappings=SAFE_MAPPINGS,
        # An integer cast on the identifier: 00127 becomes 127.
        legacy_column="customer_id",
        legacy_operation=Operation.CAST_TO_INTEGER,
    ),
    "robot_calibration_v1": ProfilePlans(
        key_column="robot_id",
        safe_mappings=ROBOTICS_SAFE_MAPPINGS,
        # The same class of damage on a robot identifier: 0017 becomes 17, and
        # a calibration is then attributed to the wrong machine.
        legacy_column="robot_id",
        legacy_operation=Operation.CAST_TO_INTEGER,
    ),
}

DEFAULT_PLAN_PROFILE_ID = "customers_v1"


def _plans_for(profile_id: str | None) -> ProfilePlans:
    """Absence means the customer destination, as everywhere else."""
    return PROFILE_PLANS.get(
        profile_id or DEFAULT_PLAN_PROFILE_ID, PROFILE_PLANS[DEFAULT_PLAN_PROFILE_ID]
    )


def safe_plan(
    date_policy: DateFormatPolicy | None = DateFormatPolicy.ISO,
    required_field_policy: RequiredFieldPolicy | None = RequiredFieldPolicy.QUARANTINE,
    profile_id: str | None = None,
) -> MigrationPlan:
    """Every column carried across under the operation that preserves it."""
    spec = _plans_for(profile_id)
    return MigrationPlan(
        version=1,
        mappings=spec.safe_mappings,
        proposed_by="deterministic-baseline",
        key_column=spec.key_column,
        date_format_policy=date_policy,
        duplicate_policy=DuplicatePolicy.KEEP_FIRST_EXACT,
        required_field_policy=required_field_policy,
    )


def legacy_integer_cast_plan(
    date_policy: DateFormatPolicy | None = DateFormatPolicy.ISO,
    profile_id: str | None = None,
) -> MigrationPlan:
    """The controlled unsafe scenario, per destination.

    Validation marks the cast review required and it cannot be approved
    without an explicit acknowledgement. If an operator does approve it, the
    executor runs it faithfully and the verifier reports the damage.
    """
    spec = _plans_for(profile_id)
    mappings = tuple(
        Mapping(spec.legacy_column, spec.legacy_column, spec.legacy_operation)
        if mapping.source_column == spec.legacy_column
        else mapping
        for mapping in spec.safe_mappings
    )
    return MigrationPlan(
        version=1,
        mappings=mappings,
        proposed_by="legacy-import-profile",
        key_column=spec.key_column,
        date_format_policy=date_policy,
        duplicate_policy=DuplicatePolicy.KEEP_FIRST_EXACT,
        required_field_policy=RequiredFieldPolicy.QUARANTINE,
    )
