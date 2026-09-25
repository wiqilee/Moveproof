"""Destination profiles.

MoveProof migrates into more than one shape of destination. A profile binds
together everything the workflow needs to serve one of them: the schema, the
verification contract, the physical tables, and the columns that may be
written.

Two profiles exist, and two is enough. This is deliberately a registry rather
than a plugin system: a dictionary of frozen dataclasses that the rest of the
pipeline reads, not a framework anything extends at runtime.

**The column and table names here are an allowlist, not a suggestion.** Every
identifier that reaches SQL for a destination comes from this module. A
profile id arriving from an API request is looked up here and resolved to a
known profile, or rejected. Nothing derives a table name from user input, so
there is no path by which a crafted profile field becomes part of a query.

Backward compatibility is a first-class concern. A migration recorded before
profiles existed has no profile stored, and `resolve` treats that absence as
the customer profile, which is what those rows have always been.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.domain.contract import (
    CUSTOMERS_CONTRACT_V1,
    ROBOT_CALIBRATION_CONTRACT_V1,
    VerificationContract,
)
from app.domain.schema import (
    CUSTOMERS_UNVERIFIED_PROPERTIES,
    CUSTOMERS_V1,
    ROBOT_CALIBRATION_UNVERIFIED_PROPERTIES,
    ROBOT_CALIBRATION_V1,
)
from app.domain.types import DestinationSchema

# Identifiers we are prepared to put into SQL. Belt and braces: the values in
# this module are all literals we wrote, and this pattern makes a future edit
# that introduces an interpolated name fail loudly rather than quietly.
SAFE_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


class UnknownDestinationProfile(Exception):
    """A profile id that is not in the registry. Never becomes a table name."""


@dataclass(frozen=True)
class DestinationProfile:
    """One destination MoveProof can migrate into."""

    id: str
    display_name: str
    description: str
    schema: DestinationSchema
    contract: VerificationContract
    #: Schema-qualified physical tables. Both are allowlisted literals.
    destination_table: str
    staging_table: str
    #: Columns written on commit, in order. Also the verified export header.
    write_columns: tuple[str, ...]
    #: Columns forming the destination primary key. One for customers, a pair
    #: for robotics, where a robot has one row per joint.
    key_columns: tuple[str, ...]
    #: Further columns carrying their own uniqueness constraint, independent
    #: of the key. A commit must preflight these too: an existing email under a
    #: different customer id would otherwise surface as a mid-insert integrity
    #: error with some rows already written.
    unique_columns: tuple[str, ...]
    #: Properties this contract does not check, reported rather than hidden.
    unverified_properties: tuple[tuple[str, str, str], ...]

    def __post_init__(self) -> None:
        for qualified in (self.destination_table, self.staging_table):
            schema_part, _, table_part = qualified.partition(".")
            if not SAFE_IDENTIFIER.match(schema_part) or not SAFE_IDENTIFIER.match(
                table_part
            ):
                raise ValueError(f"unsafe table identifier in profile: {qualified!r}")
        for column in (*self.write_columns, *self.key_columns, *self.unique_columns):
            if not SAFE_IDENTIFIER.match(column):
                raise ValueError(f"unsafe column identifier in profile: {column!r}")

    @property
    def key_column(self) -> str:
        """The single column the verifier treats as the row identity."""
        return self.contract.key_column

    def key_of(self, values: dict) -> tuple[str, ...]:
        """The destination key of one staged row, as text.

        Text on purpose. These values are compared against what the database
        already holds, and an identifier that has kept its leading zeros must
        not lose them on the way into a comparison.
        """
        return tuple(str(values[column]) for column in self.key_columns)


CUSTOMERS_PROFILE = DestinationProfile(
    id="customers_v1",
    display_name="Customer records",
    description=(
        "Customer master data: identifiers, contact details, signup dates and "
        "balances."
    ),
    schema=CUSTOMERS_V1,
    contract=CUSTOMERS_CONTRACT_V1,
    destination_table="public.customers",
    staging_table="staging.customers",
    write_columns=(
        "customer_id",
        "full_name",
        "email",
        "signup_date",
        "balance",
        "region",
    ),
    key_columns=("customer_id",),
    unique_columns=("email",),
    unverified_properties=CUSTOMERS_UNVERIFIED_PROPERTIES,
)

ROBOT_CALIBRATION_PROFILE = DestinationProfile(
    id="robot_calibration_v1",
    display_name="Robotics calibration",
    description=(
        "Per-joint calibration records: robot and joint identity, zero offset, "
        "gear ratio, firmware version, sensor frame and calibration date."
    ),
    schema=ROBOT_CALIBRATION_V1,
    contract=ROBOT_CALIBRATION_CONTRACT_V1,
    destination_table="public.robot_calibrations",
    staging_table="staging.robot_calibrations",
    write_columns=(
        "robot_id",
        "joint_name",
        "zero_offset_deg",
        "gear_ratio",
        "firmware_version",
        "sensor_frame",
        "calibration_date",
    ),
    # A robot's calibration is per joint, so neither column is unique alone.
    # The pair is, and the destination table carries that constraint. Nothing
    # else on this schema is independently unique.
    key_columns=("robot_id", "joint_name"),
    unique_columns=(),
    unverified_properties=ROBOT_CALIBRATION_UNVERIFIED_PROPERTIES,
)

PROFILES: dict[str, DestinationProfile] = {
    CUSTOMERS_PROFILE.id: CUSTOMERS_PROFILE,
    ROBOT_CALIBRATION_PROFILE.id: ROBOT_CALIBRATION_PROFILE,
}

#: What a migration with no stored profile has always been.
DEFAULT_PROFILE_ID = CUSTOMERS_PROFILE.id


def resolve(profile_id: str | None) -> DestinationProfile:
    """Look up a profile, treating absence as the customer profile.

    `None` and the empty string both mean "recorded before profiles existed",
    which is every migration created up to now. Anything else must name a
    profile in the registry; an unknown id raises rather than falling back,
    because silently migrating into the wrong destination is worse than an
    error.
    """
    if not profile_id:
        return PROFILES[DEFAULT_PROFILE_ID]
    try:
        return PROFILES[profile_id]
    except KeyError as exc:
        known = ", ".join(sorted(PROFILES))
        raise UnknownDestinationProfile(
            f"Unknown destination profile {profile_id!r}. Known profiles: {known}."
        ) from exc


def listing() -> list[dict[str, object]]:
    """The profiles a client may offer, for the destination step."""
    return [
        {
            "id": profile.id,
            "display_name": profile.display_name,
            "description": profile.description,
            "destination_table": profile.destination_table,
            "schema_version": profile.schema.version,
            "column_count": len(profile.schema.columns),
            "required_count": len(profile.schema.required_columns),
        }
        for profile in PROFILES.values()
    ]
