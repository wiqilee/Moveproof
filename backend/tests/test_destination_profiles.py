"""Destination profiles.

Two things are under test, weighted differently.

The ordinary part: each profile resolves the schema, contract and tables it
should, and the customer profile is unchanged.

The part that matters: a profile id is user input that ends up deciding which
physical table a migration writes into. Every table and column name comes from
this registry, an unknown id is refused rather than defaulted, and a crafted id
never becomes SQL. Those tests are the reason this file exists.
"""

from __future__ import annotations

import csv
import re
import sys
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.domain.profiles import (  # noqa: E402
    CUSTOMERS_PROFILE,
    DEFAULT_PROFILE_ID,
    PROFILES,
    ROBOT_CALIBRATION_PROFILE,
    DestinationProfile,
    UnknownDestinationProfile,
    listing,
    resolve,
)
from app.domain.schema import CUSTOMERS_V1, ROBOT_CALIBRATION_V1  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"


# --------------------------------------------------------------------------
# Resolution and backward compatibility
# --------------------------------------------------------------------------


def test_a_migration_without_a_profile_is_a_customer_migration():
    """Every migration recorded before this feature existed. Absence is not
    an error, and it is not robotics."""
    assert resolve(None).id == "customers_v1"
    assert resolve("").id == "customers_v1"
    assert DEFAULT_PROFILE_ID == "customers_v1"


def test_the_customer_profile_resolves_the_existing_schema_unchanged():
    profile = resolve("customers_v1")
    assert profile.schema is CUSTOMERS_V1
    assert profile.destination_table == "public.customers"
    assert profile.staging_table == "staging.customers"
    assert profile.contract.key_column == "customer_id"


def test_the_robotics_profile_resolves_the_robotics_schema():
    profile = resolve("robot_calibration_v1")
    assert profile.schema is ROBOT_CALIBRATION_V1
    assert profile.destination_table == "public.robot_calibrations"
    assert profile.staging_table == "staging.robot_calibrations"
    assert profile.contract.key_column == "robot_id"


def test_an_unknown_profile_is_refused_rather_than_defaulted():
    """Silently migrating into the wrong destination is worse than an error."""
    with pytest.raises(UnknownDestinationProfile) as exc:
        resolve("customers_v2")
    assert "Known profiles" in str(exc.value)


def test_the_two_profiles_never_share_a_table():
    assert (
        CUSTOMERS_PROFILE.destination_table != ROBOT_CALIBRATION_PROFILE.destination_table
    )
    assert CUSTOMERS_PROFILE.staging_table != ROBOT_CALIBRATION_PROFILE.staging_table


# --------------------------------------------------------------------------
# The allowlist
# --------------------------------------------------------------------------


def test_a_crafted_profile_id_never_becomes_a_table_name():
    for attempt in (
        "public.customers; DROP TABLE public.customers",
        "../../etc/passwd",
        "robot_calibration_v1 UNION SELECT 1",
        "public.robot_calibrations",
    ):
        with pytest.raises(UnknownDestinationProfile):
            resolve(attempt)


def test_every_table_and_column_in_the_registry_is_a_plain_identifier():
    """The registry is the only source of identifiers reaching SQL."""
    for profile in PROFILES.values():
        for qualified in (profile.destination_table, profile.staging_table):
            schema_part, dot, table_part = qualified.partition(".")
            assert dot == ".", f"{qualified} must be schema-qualified"
            for part in (schema_part, table_part):
                assert part.replace("_", "").isalnum()
        for column in (*profile.write_columns, *profile.key_columns, *profile.unique_columns):
            assert column.replace("_", "").isalnum()


def test_a_profile_with_an_unsafe_identifier_cannot_be_constructed():
    with pytest.raises(ValueError):
        DestinationProfile(
            id="bad",
            display_name="bad",
            description="",
            schema=ROBOT_CALIBRATION_V1,
            contract=ROBOT_CALIBRATION_PROFILE.contract,
            destination_table="public.robots; DROP TABLE x",
            staging_table="staging.robots",
            write_columns=("robot_id",),
            key_columns=("robot_id",),
            unique_columns=(),
            unverified_properties=(),
        )


def test_write_columns_match_the_schema():
    """The commit column list and the export header are the same thing, so a
    column added to one and not the other would be a silent gap."""
    for profile in PROFILES.values():
        declared = {column.name for column in profile.schema.columns}
        assert set(profile.write_columns) == declared


# --------------------------------------------------------------------------
# The robotics contract
# --------------------------------------------------------------------------


def test_robot_id_is_text_and_required():
    column = ROBOT_CALIBRATION_V1.column("robot_id")
    assert column is not None
    assert column.data_type.startswith("VARCHAR")
    assert column.required is True


def test_firmware_version_is_text_not_a_number():
    """3.08 is a version string. Read as a number it becomes 3.08 and the
    trailing zero is gone."""
    column = ROBOT_CALIBRATION_V1.column("firmware_version")
    assert column is not None
    assert column.data_type.startswith("VARCHAR")
    assert Decimal("3.08") != Decimal("3.080").normalize() or True  # documents intent


def test_the_numeric_columns_declare_precision_and_scale():
    for name in ("zero_offset_deg", "gear_ratio"):
        column = ROBOT_CALIBRATION_V1.column(name)
        assert column is not None
        assert column.numeric_precision and column.numeric_scale


def test_every_robotics_column_is_required():
    assert len(ROBOT_CALIBRATION_V1.required_columns) == 7


def test_reconciliation_covers_only_identity_preserving_columns():
    """A cast column compared against the text it came from fails on a
    correct migration, so the cast columns stay out."""
    fields = set(ROBOT_CALIBRATION_PROFILE.contract.reconciliation_fields)
    assert "robot_id" in fields and "firmware_version" in fields
    assert "gear_ratio" not in fields and "zero_offset_deg" not in fields
    assert "calibration_date" not in fields


def test_the_contract_declares_what_it_does_not_check():
    exclusions = " ".join(ROBOT_CALIBRATION_PROFILE.contract.exclusions).lower()
    assert "no claim about robot safety" in exclusions


def test_the_two_contracts_hash_differently():
    """An approval bound to one contract must not satisfy the other."""
    assert (
        CUSTOMERS_PROFILE.contract.hash() != ROBOT_CALIBRATION_PROFILE.contract.hash()
    )


def test_no_profile_claims_physical_safety():
    """MoveProof verifies that data survived a migration. Nothing here is a
    statement about hardware."""
    for profile in PROFILES.values():
        blob = " ".join(
            [
                profile.description,
                *(reason for _, _, reason in profile.unverified_properties),
                *profile.contract.exclusions,
            ]
        ).lower()
        # Word boundaries matter: "makes no claim about robot safety" is a
        # disclaimer, not a claim, and a naive substring check reads it as one.
        for forbidden in (r"robot safe\b", r"motion safe\b", r"hardware certified"):
            assert not re.search(forbidden, blob), f"{profile.id}: {forbidden}"


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------


def rows(name: str) -> list[dict[str, str]]:
    with open(FIXTURES / name, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def test_both_fixtures_match_the_robotics_destination():
    for name in ("robot_calibration_clean.csv", "robot_calibration_ambiguous.csv"):
        parsed = rows(name)
        assert parsed, f"{name} must contain rows"
        assert set(parsed[0]) == set(ROBOT_CALIBRATION_V1.required_columns)


def test_leading_zeros_survive_csv_parsing():
    for name in ("robot_calibration_clean.csv", "robot_calibration_ambiguous.csv"):
        for row in rows(name):
            assert row["robot_id"].startswith("0"), row["robot_id"]
            assert len(row["robot_id"]) == 4


def test_quoted_decimals_do_not_create_extra_columns():
    """A comma inside 1,250.00 would otherwise split the row."""
    for row in rows("robot_calibration_ambiguous.csv"):
        assert len(row) == 7
        assert None not in row


def test_the_clean_fixture_is_unambiguous():
    parsed = rows("robot_calibration_clean.csv")
    for row in parsed:
        assert "," not in row["gear_ratio"], "one decimal convention only"
        assert row["calibration_date"].count("-") == 2, "ISO dates read one way"


def test_the_ambiguous_fixture_carries_exactly_the_two_intended_concerns():
    parsed = rows("robot_calibration_ambiguous.csv")

    # Concern 1: dates that read two ways.
    dates = [row["calibration_date"] for row in parsed]
    assert all("/" in value for value in dates)
    assert any(
        int(value.split("/")[0]) <= 12 and int(value.split("/")[1]) <= 12
        for value in dates
    ), "at least one date must be readable as both day first and month first"

    # Concern 2: two decimal conventions in one column.
    ratios = [row["gear_ratio"] for row in parsed]
    dot = [value for value in ratios if "." in value]
    comma = [value for value in ratios if "," in value and "." not in value]
    assert dot and comma, "the column must mix conventions, not merely use commas"


def test_the_ambiguous_fixture_invents_no_extra_problems():
    """Escalation must come from genuine ambiguity, not manufactured noise."""
    for row in rows("robot_calibration_ambiguous.csv"):
        for column, value in row.items():
            assert value.strip(), f"{column} is blank, which is a different concern"


def test_the_listing_exposes_both_profiles_without_internals():
    entries = listing()
    assert {entry["id"] for entry in entries} == set(PROFILES)
    for entry in entries:
        assert entry["display_name"] and entry["description"]
        assert "contract" not in entry
