"""The predefined destination schema for the customer migration."""

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

UNVERIFIED_PROPERTIES = (
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
