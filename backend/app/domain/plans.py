"""Plan builders for the demonstration migration.

These stand in for the model proposal until the Nebius client lands. They are
ordinary plan objects, so replacing them with a model response changes nothing
downstream.
"""

from __future__ import annotations

from app.domain.types import (
    DateFormatPolicy,
    DuplicatePolicy,
    Mapping,
    MigrationPlan,
    Operation,
    RequiredFieldPolicy,
)

SAFE_MAPPINGS = (
    Mapping("customer_id", "customer_id", Operation.PRESERVE_IDENTIFIER_AS_STRING),
    Mapping("full_name", "full_name", Operation.NORMALIZE_WHITESPACE),
    Mapping("email", "email", Operation.RENAME_FIELD),
    Mapping("signup_date", "signup_date", Operation.PARSE_DATE),
    Mapping("balance", "balance", Operation.CAST_TO_DECIMAL, options={"scale": 2}),
    Mapping("region", "region", Operation.NULL_HANDLING),
)


def safe_plan(
    date_policy: DateFormatPolicy | None = DateFormatPolicy.ISO,
    required_field_policy: RequiredFieldPolicy | None = RequiredFieldPolicy.QUARANTINE,
) -> MigrationPlan:
    return MigrationPlan(
        version=1,
        mappings=SAFE_MAPPINGS,
        proposed_by="deterministic-baseline",
        key_column="customer_id",
        date_format_policy=date_policy,
        duplicate_policy=DuplicatePolicy.KEEP_FIRST_EXACT,
        required_field_policy=required_field_policy,
    )


def legacy_integer_cast_plan(
    date_policy: DateFormatPolicy | None = DateFormatPolicy.ISO,
) -> MigrationPlan:
    """The controlled unsafe scenario.

    A legacy transformation that casts the identifier to an integer. Validation
    marks it review required and it cannot be approved without an explicit
    acknowledgement, but if an operator does approve it, the executor runs it
    faithfully and the verifier reports the damage.
    """
    mappings = tuple(
        Mapping("customer_id", "customer_id", Operation.CAST_TO_INTEGER)
        if m.source_column == "customer_id"
        else m
        for m in SAFE_MAPPINGS
    )
    return MigrationPlan(
        version=1,
        mappings=mappings,
        proposed_by="legacy-import-profile",
        key_column="customer_id",
        date_format_policy=date_policy,
        duplicate_policy=DuplicatePolicy.KEEP_FIRST_EXACT,
        required_field_policy=RequiredFieldPolicy.QUARANTINE,
    )
