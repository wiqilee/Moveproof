"""The predefined destination schemas.

One schema per destination profile. Both are literal declarations rather than
anything derived at runtime: the workflow validates a proposed plan against
these, so they are the authority on what a destination will accept.
"""

from __future__ import annotations

from app.domain.types import DestinationColumn, DestinationSchema

CUSTOMERS_V1 = DestinationSchema(
    name="public.customers",
    version="v1",
    columns=(
        DestinationColumn(
            name="customer_id",
            data_type="VARCHAR(20)",
            required=True,
            unique=True,
            max_length=20,
            description="Exact source identifier with leading zeros preserved",
        ),
        DestinationColumn(
            name="full_name",
            data_type="VARCHAR(255)",
            required=True,
            max_length=255,
            description="Customer display name",
        ),
        DestinationColumn(
            name="email",
            data_type="VARCHAR(255)",
            required=True,
            unique=True,
            max_length=255,
            description="Primary contact email",
        ),
        DestinationColumn(
            name="signup_date",
            data_type="DATE",
            required=True,
            description="Account creation date",
        ),
        DestinationColumn(
            name="balance",
            data_type="NUMERIC(12,2)",
            required=True,
            numeric_precision=12,
            numeric_scale=2,
            description="Current balance held as an exact decimal",
        ),
        DestinationColumn(
            name="region",
            data_type="VARCHAR(50)",
            required=False,
            max_length=50,
            description="Sales region code",
        ),
    ),
)

ROBOT_CALIBRATION_V1 = DestinationSchema(
    name="public.robot_calibrations",
    version="v1",
    columns=(
        DestinationColumn(
            name="robot_id",
            data_type="VARCHAR(20)",
            required=True,
            max_length=20,
            description=(
                "Exact source robot identifier with leading zeros preserved. "
                "0017 is not 17."
            ),
        ),
        DestinationColumn(
            name="joint_name",
            data_type="VARCHAR(64)",
            required=True,
            max_length=64,
            description="Joint this calibration applies to, ordinary text",
        ),
        DestinationColumn(
            name="zero_offset_deg",
            data_type="NUMERIC(8,3)",
            required=True,
            numeric_precision=8,
            numeric_scale=3,
            description="Zero offset in degrees, held as an exact decimal",
        ),
        DestinationColumn(
            name="gear_ratio",
            data_type="NUMERIC(12,4)",
            required=True,
            numeric_precision=12,
            numeric_scale=4,
            description="Gear ratio, held as an exact decimal",
        ),
        DestinationColumn(
            name="firmware_version",
            data_type="VARCHAR(32)",
            required=True,
            max_length=32,
            description=(
                "Firmware version as text. 3.08 is a version string, not the "
                "number 3.08, and must not be read as one."
            ),
        ),
        DestinationColumn(
            name="sensor_frame",
            data_type="VARCHAR(64)",
            required=True,
            max_length=64,
            description="Reference frame the calibration was measured in",
        ),
        DestinationColumn(
            name="calibration_date",
            data_type="DATE",
            required=True,
            description="Date the calibration was recorded",
        ),
    ),
)

# Neither schema has a uniqueness constraint that a single column satisfies on
# the robotics side: a robot has one row per joint, so the pair is the key.

CUSTOMERS_UNVERIFIED_PROPERTIES = (
    (
        "aggregate_reconciliation",
        "Aggregate reconciliation",
        "No source of truth ledger is configured for this schema, so row sums were not reconciled.",
    ),
    (
        "referential_integrity",
        "Referential integrity",
        "This migration targets a single table, so foreign keys were not checked.",
    ),
)

# The historical name. Kept so existing imports continue to resolve to the
# customer properties they have always meant.
UNVERIFIED_PROPERTIES = CUSTOMERS_UNVERIFIED_PROPERTIES

ROBOT_CALIBRATION_UNVERIFIED_PROPERTIES = (
    (
        "aggregate_reconciliation",
        "Aggregate reconciliation",
        "No calibration ledger is configured for this schema, so totals were not reconciled.",
    ),
    (
        "referential_integrity",
        "Referential integrity",
        "This migration targets a single table, so links to a robot registry were not checked.",
    ),
    (
        "physical_validity",
        "Physical calibration validity",
        (
            "MoveProof verifies that the recorded values survived the migration. "
            "It does not evaluate whether a calibration is correct for the hardware, "
            "and makes no safety claim about any robot."
        ),
    ),
)
