"""Verification after a human has resolved an ambiguity.

The executor applies what was approved. These tests cover the other half:
whether the independent verifier can *prove* the approved reading was the one
applied, rather than merely noticing that the source was ambiguous.

Three properties matter here, and each was a real defect before:

    uniqueness       a robot has many joints, so (robot_id, joint_name) is the
                     row identity. robot_id alone is only the field whose exact
                     form must survive.
    date_parsing     after DAY_FIRST is approved, 03/04/2026 becoming
                     2026-04-03 is a pass, not a review. A mandatory check
                     stuck at review can never commit.
    decimal_precision  a value the verifier cannot parse must not be skipped
                     and then reported as passed. Silence is not agreement.

The verifier parses source values with its own strict readers. It shares no
code with the executor, which is the point: two implementations agreeing is
evidence, one implementation agreeing with itself is not.
"""

from __future__ import annotations

import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.domain.profiles import CUSTOMERS_PROFILE, ROBOT_CALIBRATION_PROFILE  # noqa: E402
from app.domain.schema import ROBOT_CALIBRATION_V1  # noqa: E402
from app.domain.types import (  # noqa: E402
    CheckStatus,
    ExecutionResult,
    RowAccounting,
    RowDisposition,
    SourceRow,
    StagedRow,
)
from app.domain.verification import verify  # noqa: E402

ROBOT_COLUMNS = (
    "robot_id",
    "joint_name",
    "zero_offset_deg",
    "gear_ratio",
    "firmware_version",
    "sensor_frame",
    "calibration_date",
)


def status_of(checks, check_id: str) -> CheckStatus:
    for check in checks:
        if check.check_id == check_id:
            return check.status
    raise AssertionError(f"no check {check_id!r} in {[c.check_id for c in checks]}")


def check_named(checks, check_id: str):
    for check in checks:
        if check.check_id == check_id:
            return check
    raise AssertionError(f"no check {check_id!r}")


def joint_rows(pairs: list[tuple[str, str]]) -> tuple[list[SourceRow], list[StagedRow]]:
    """Source and staged rows for one calibration per (robot, joint)."""
    source: list[SourceRow] = []
    staged: list[StagedRow] = []
    for index, (robot, joint) in enumerate(pairs, start=1):
        values = {
            "robot_id": robot,
            "joint_name": joint,
            "zero_offset_deg": "12.500",
            "gear_ratio": "1250.0000",
            "firmware_version": "3.08",
            "sensor_frame": "arm_left",
            "calibration_date": "2026-04-03",
        }
        source.append(SourceRow(row_number=index, values=dict(values)))
        staged.append(
            StagedRow(
                row_number=index,
                source_key=robot,
                values={
                    "robot_id": robot,
                    "joint_name": joint,
                    "zero_offset_deg": Decimal("12.500"),
                    "gear_ratio": Decimal("1250.0000"),
                    "firmware_version": "3.08",
                    "sensor_frame": "arm_left",
                    "calibration_date": date(2026, 4, 3),
                },
                disposition=RowDisposition.STAGED,
            )
        )
    return source, staged


def run_verify(
    source: list[SourceRow],
    staged: list[StagedRow],
    *,
    date_columns: tuple[str, ...] = ("calibration_date",),
    date_format_policy: str | None = None,
    decimal_conventions: dict[str, str] | None = None,
):
    result = ExecutionResult(
        plan_version="v1",
        staged=staged,
        accounting=RowAccounting(source_rows=len(source)),
        errors=[],
        applied_operations=[],
    )
    return verify(
        source,
        result,
        ROBOT_CALIBRATION_V1,
        key_column="robot_id",
        destination_key_column="robot_id",
        date_columns=date_columns,
        unverified_properties=ROBOT_CALIBRATION_PROFILE.unverified_properties,
        identity_columns=ROBOT_CALIBRATION_PROFILE.key_columns,
        reconciliation_fields=ROBOT_CALIBRATION_PROFILE.contract.reconciliation_fields,
        date_format_policy=date_format_policy,
        decimal_conventions=decimal_conventions,
    )


# --------------------------------------------------------------------------
# A and B: composite identity through the real verification path
# --------------------------------------------------------------------------


def test_one_robot_with_several_joints_passes_uniqueness():
    """The defect this guards: robot_id used alone as row identity turns a
    normal calibration file into three duplicate rows."""
    source, staged = joint_rows(
        [("0017", "elbow_left"), ("0017", "wrist_left"), ("0017", "shoulder_left")]
    )
    checks = run_verify(source, staged)

    assert status_of(checks, "uniqueness") is CheckStatus.PASSED


def test_a_repeated_robot_and_joint_pair_is_caught():
    source, staged = joint_rows(
        [("0017", "elbow_left"), ("0017", "elbow_left"), ("0018", "wrist_right")]
    )
    checks = run_verify(source, staged)

    assert status_of(checks, "uniqueness") is CheckStatus.FAILED


def test_identifier_preservation_is_separate_from_row_identity():
    """robot_id repeating is fine. robot_id losing its leading zero is not."""
    source, staged = joint_rows([("0017", "elbow_left"), ("0017", "wrist_left")])
    staged[1].values["robot_id"] = "17"

    checks = run_verify(source, staged)
    assert status_of(checks, "identifier_preservation") is CheckStatus.FAILED


# --------------------------------------------------------------------------
# C, D and E: the approved date reading is proved, not assumed
# --------------------------------------------------------------------------


def ambiguous_date_rows(staged_date: date):
    source = [
        SourceRow(
            row_number=1,
            values={
                "robot_id": "0017",
                "joint_name": "elbow_left",
                "zero_offset_deg": "12.500",
                "gear_ratio": "1250.0000",
                "firmware_version": "3.08",
                "sensor_frame": "arm_left",
                "calibration_date": "03/04/2026",
            },
        )
    ]
    staged = [
        StagedRow(
            row_number=1,
            source_key="0017",
            values={
                "robot_id": "0017",
                "joint_name": "elbow_left",
                "zero_offset_deg": Decimal("12.500"),
                "gear_ratio": Decimal("1250.0000"),
                "firmware_version": "3.08",
                "sensor_frame": "arm_left",
                "calibration_date": staged_date,
            },
            disposition=RowDisposition.STAGED,
        )
    ]
    return source, staged


def test_day_first_passes_when_the_staged_date_matches():
    source, staged = ambiguous_date_rows(date(2026, 4, 3))
    checks = run_verify(source, staged, date_format_policy="day_first")

    assert status_of(checks, "date_parsing") is CheckStatus.PASSED


def test_month_first_passes_when_the_staged_date_matches():
    source, staged = ambiguous_date_rows(date(2026, 3, 4))
    checks = run_verify(source, staged, date_format_policy="month_first")

    assert status_of(checks, "date_parsing") is CheckStatus.PASSED


def test_a_staged_date_that_contradicts_the_approved_reading_fails():
    """Approved day first, staged as month first. The verifier must catch it."""
    source, staged = ambiguous_date_rows(date(2026, 3, 4))
    checks = run_verify(source, staged, date_format_policy="day_first")

    assert status_of(checks, "date_parsing") is CheckStatus.FAILED


def test_an_ambiguous_date_with_no_approved_reading_is_not_a_pass():
    """Fail closed: no policy means the verifier cannot say it agrees."""
    source, staged = ambiguous_date_rows(date(2026, 4, 3))
    checks = run_verify(source, staged, date_format_policy=None)

    assert status_of(checks, "date_parsing") is not CheckStatus.PASSED


def test_an_iso_date_needs_no_policy():
    """Clean data stays unobtrusive: one reading, nothing to approve."""
    source, staged = joint_rows([("0017", "elbow_left")])
    checks = run_verify(source, staged, date_format_policy=None)

    assert status_of(checks, "date_parsing") is CheckStatus.PASSED


# --------------------------------------------------------------------------
# F and G: every mixed decimal is actually compared
# --------------------------------------------------------------------------


MIXED = ["1,250.00", "1250,00", "980,40", "1,004.05", "310,75"]
MIXED_EXPECTED = [
    Decimal("1250.00"),
    Decimal("1250.00"),
    Decimal("980.40"),
    Decimal("1004.05"),
    Decimal("310.75"),
]


def mixed_decimal_rows(staged_values: list[Decimal]):
    source: list[SourceRow] = []
    staged: list[StagedRow] = []
    for index, (raw, value) in enumerate(zip(MIXED, staged_values), start=1):
        source.append(
            SourceRow(
                row_number=index,
                values={
                    "robot_id": f"00{16 + index}",
                    "joint_name": f"joint_{index}",
                    "zero_offset_deg": "12.500",
                    "gear_ratio": raw,
                    "firmware_version": "3.08",
                    "sensor_frame": "arm_left",
                    "calibration_date": "2026-04-03",
                },
            )
        )
        staged.append(
            StagedRow(
                row_number=index,
                source_key=f"00{16 + index}",
                values={
                    "robot_id": f"00{16 + index}",
                    "joint_name": f"joint_{index}",
                    "zero_offset_deg": Decimal("12.500"),
                    "gear_ratio": value,
                    "firmware_version": "3.08",
                    "sensor_frame": "arm_left",
                    "calibration_date": date(2026, 4, 3),
                },
                disposition=RowDisposition.STAGED,
            )
        )
    return source, staged


def test_strict_either_verifies_every_mixed_value():
    source, staged = mixed_decimal_rows(list(MIXED_EXPECTED))
    checks = run_verify(
        source, staged, decimal_conventions={"gear_ratio": "strict_either"}
    )

    check = check_named(checks, "decimal_precision")
    assert check.status is CheckStatus.PASSED
    # The defect this guards: values the verifier could not parse were skipped,
    # so a pass could be reported having compared nothing at all. Five rows
    # across two decimal columns is ten comparisons, and every mixed
    # gear_ratio is among them.
    assert "10" in check.observed, check.observed


def test_a_tampered_mixed_decimal_fails():
    tampered = list(MIXED_EXPECTED)
    tampered[1] = Decimal("125.00")  # 1250,00 misread as one hundred twenty five
    source, staged = mixed_decimal_rows(tampered)

    checks = run_verify(
        source, staged, decimal_conventions={"gear_ratio": "strict_either"}
    )
    assert status_of(checks, "decimal_precision") is CheckStatus.FAILED


def test_an_unreadable_value_is_never_silently_passed():
    """A value outside the approved rule must be reported, not skipped."""
    source, staged = mixed_decimal_rows(list(MIXED_EXPECTED))
    source[0].values["gear_ratio"] = "1 250,00 ish"

    checks = run_verify(
        source, staged, decimal_conventions={"gear_ratio": "strict_either"}
    )
    assert status_of(checks, "decimal_precision") is not CheckStatus.PASSED


def test_a_dot_only_convention_does_not_silently_accept_comma_values():
    source, staged = mixed_decimal_rows(list(MIXED_EXPECTED))
    checks = run_verify(
        source, staged, decimal_conventions={"gear_ratio": "dot_decimal"}
    )
    assert status_of(checks, "decimal_precision") is not CheckStatus.PASSED


# --------------------------------------------------------------------------
# H: the customer path is untouched
# --------------------------------------------------------------------------


def test_the_customer_profile_still_verifies_on_a_single_key():
    assert CUSTOMERS_PROFILE.key_columns == ("customer_id",)
    assert CUSTOMERS_PROFILE.contract.key_column == "customer_id"


def test_robotics_limitations_name_the_absence_of_a_safety_claim():
    checks = run_verify(*joint_rows([("0017", "elbow_left")]))
    not_verified = [
        check for check in checks if check.status is CheckStatus.NOT_VERIFIED
    ]
    blob = " ".join(check.observed for check in not_verified).lower()

    assert not_verified, "unchecked properties must be reported, not hidden"
    assert "safety" in blob or "safe" in blob
