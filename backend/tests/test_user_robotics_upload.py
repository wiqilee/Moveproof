"""A robotics calibration file the operator brings, not one of the demo fixtures.

The three demo datasets name every column exactly as the destination does.
A real file need not: a workshop export may say RobotID and Joint where the
destination says robot_id and joint_name. These tests cover what happens to
such a file on the way through the same pipeline:

    parsing        CSV, TSV, XLSX and XLSM, including date cells in a workbook
    compatibility  a file that cannot map to robot_calibration_v1 is refused
                   at validation, before anything is approvable
    renamed        columns the approved plan maps under a different name are
                   staged, keyed and verified through that mapping
    fail closed    a changed identifier, an ambiguous date, a mixed decimal
                   and a repeated (robot_id, joint_name) still stop the run

Database-backed behaviour (upload endpoint, stored bytes and checksum, commit)
is covered by the API suites, which need PostgreSQL.
"""

from __future__ import annotations

import io
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.domain.contract import ROBOT_CALIBRATION_CONTRACT_V1  # noqa: E402
from app.domain.plan import ApprovalRefused, approve, validate_plan  # noqa: E402
from app.domain.plans import safe_plan  # noqa: E402
from app.domain.profiles import ROBOT_CALIBRATION_PROFILE  # noqa: E402
from app.domain.schema import ROBOT_CALIBRATION_V1  # noqa: E402
from app.domain.types import (  # noqa: E402
    CheckStatus,
    DateFormatPolicy,
    Mapping,
    MigrationPlan,
    Operation,
    RequiredFieldPolicy,
    SourceRow,
)
from app.domain.verification import source_rows_by_destination, verify  # noqa: E402
from app.execute.executor import execute_plan  # noqa: E402
from app.ingest.parser import ParseError, parse_upload  # noqa: E402

APPROVED_AT = "2026-10-25T09:00:00Z"

# A workshop export: same meaning, different header names, and robot 0042 is
# not in any demo fixture.
USER_HEADER = (
    "RobotID",
    "Joint",
    "ZeroOffset",
    "GearRatio",
    "Firmware",
    "Frame",
    "CalibratedOn",
)
USER_ROWS = (
    ("0042", "hip_left", "4.500", "640.00", "2.10", "leg_left", "2026-09-14"),
    ("0042", "hip_right", "-0.125", "640.00", "2.10", "leg_right", "2026-09-14"),
    ("0043", "knee_left", "0.000", "1,120.50", "2.09", "leg_left", "2026-09-15"),
)

# The plan a model proposal produces for that file: every column mapped
# across, under the operation that preserves it.
RENAMED = {
    "RobotID": ("robot_id", Operation.PRESERVE_IDENTIFIER_AS_STRING),
    "Joint": ("joint_name", Operation.NORMALIZE_WHITESPACE),
    "ZeroOffset": ("zero_offset_deg", Operation.CAST_TO_DECIMAL),
    "GearRatio": ("gear_ratio", Operation.CAST_TO_DECIMAL),
    "Firmware": ("firmware_version", Operation.PRESERVE_IDENTIFIER_AS_STRING),
    "Frame": ("sensor_frame", Operation.NORMALIZE_WHITESPACE),
    "CalibratedOn": ("calibration_date", Operation.PARSE_DATE),
}


def user_csv(rows=USER_ROWS, header=USER_HEADER, delimiter=",") -> bytes:
    def cell(value: str) -> str:
        return f'"{value}"' if delimiter in value else value

    lines = [delimiter.join(header)]
    lines += [delimiter.join(cell(v) for v in row) for row in rows]
    return ("\n".join(lines) + "\n").encode("utf-8")


def renamed_plan(
    date_policy=DateFormatPolicy.ISO, gear_convention: str | None = "dot_decimal"
) -> MigrationPlan:
    mappings = []
    for source, (destination, operation) in RENAMED.items():
        options = {}
        if destination == "gear_ratio" and gear_convention:
            options = {"decimal_convention": gear_convention}
        mappings.append(Mapping(source, destination, operation, options=options))
    mappings.append(Mapping("(duplicate rows)", None, Operation.DEDUPLICATE))
    return MigrationPlan(
        version=1,
        mappings=tuple(mappings),
        proposed_by="nebius:test",
        key_column=ROBOT_CALIBRATION_CONTRACT_V1.key_column,
        date_format_policy=date_policy,
        required_field_policy=RequiredFieldPolicy.QUARANTINE,
    )


def approved(plan: MigrationPlan, columns: tuple[str, ...]):
    validation = validate_plan(plan, ROBOT_CALIBRATION_V1, columns)
    acknowledgements = tuple(
        m.source_column for m in validation.plan.mappings if m.requires_acknowledgement
    )
    return approve(
        validation,
        "operator",
        APPROVED_AT,
        acknowledgements=acknowledgements,
        contract=ROBOT_CALIBRATION_CONTRACT_V1,
    )


def column_sources(plan: MigrationPlan) -> dict[str, str]:
    """What pipeline.verify reads from the approved plan."""
    return {
        m.destination_column: m.source_column
        for m in plan.mappings
        if m.destination_column is not None
    }


def run(raw: bytes, filename: str = "workshop_export.csv", plan=None):
    parsed = parse_upload(raw, filename)
    plan = approved(plan or renamed_plan(), parsed.source_file.columns)
    result = execute_plan(
        plan,
        ROBOT_CALIBRATION_V1,
        parsed.rows,
        parsed.source_file.columns,
        identity_columns=ROBOT_CALIBRATION_PROFILE.key_columns,
    )
    return parsed, plan, result


def checks_for(parsed, plan, result, *, translate: bool = True):
    rows = parsed.rows
    if translate:
        rows = source_rows_by_destination(rows, column_sources(plan))
    conventions = {
        m.destination_column: m.options["decimal_convention"]
        for m in plan.mappings
        if m.destination_column and m.options.get("decimal_convention")
    }
    contract = ROBOT_CALIBRATION_CONTRACT_V1
    return {
        check.check_id: check
        for check in verify(
            rows,
            result,
            ROBOT_CALIBRATION_V1,
            key_column=contract.key_column,
            destination_key_column=contract.key_column,
            date_columns=contract.date_columns,
            unverified_properties=ROBOT_CALIBRATION_PROFILE.unverified_properties,
            identity_columns=ROBOT_CALIBRATION_PROFILE.key_columns,
            date_format_policy=plan.date_format_policy.value
            if plan.date_format_policy
            else None,
            decimal_conventions=conventions,
        )
    }


def mandatory_blockers(checks) -> list[str]:
    return [
        check_id
        for check_id, check in checks.items()
        if ROBOT_CALIBRATION_CONTRACT_V1.is_mandatory(check_id)
        and check.status in (CheckStatus.FAILED, CheckStatus.REVIEW)
    ]


# --------------------------------------------------------------------------
# Parsing a file the operator brings
# --------------------------------------------------------------------------


def test_a_user_csv_is_parsed_as_written():
    parsed = parse_upload(user_csv(), "workshop_export.csv")

    assert parsed.source_file.columns == USER_HEADER
    assert parsed.source_file.row_count == 3
    assert parsed.rows[0].values["RobotID"] == "0042"
    assert parsed.rows[0].values["Firmware"] == "2.10"
    assert parsed.source_file.checksum.startswith("sha256:")


def test_a_user_tsv_is_parsed_as_written():
    parsed = parse_upload(user_csv(delimiter="\t"), "workshop_export.tsv")

    assert parsed.source_file.columns == USER_HEADER
    assert parsed.rows[2].values["GearRatio"] == "1,120.50"


@pytest.mark.parametrize("suffix", [".xlsx", ".xlsm", ".XLSX"])
def test_a_user_workbook_is_parsed_with_its_date_cells_as_iso(suffix):
    """A date cell is already a date. It arrives as the ISO day it stores,
    not as '2026-09-14 00:00:00', which no date policy accepts."""
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.append(list(USER_HEADER))
    sheet.append(["0042", "hip_left", "4.500", "640.00", "2.10", "leg_left", date(2026, 9, 14)])
    sheet.append(
        ["0043", "knee_left", "0.000", "640.00", "2.09", "leg_left", datetime(2026, 9, 15)]
    )
    buffer = io.BytesIO()
    workbook.save(buffer)

    parsed = parse_upload(buffer.getvalue(), f"workshop_export{suffix}")

    assert parsed.rows[0].values["CalibratedOn"] == "2026-09-14"
    assert parsed.rows[1].values["CalibratedOn"] == "2026-09-15"
    # Text cells are untouched: the identifier keeps its zeros, the version
    # its trailing zero.
    assert parsed.rows[0].values["RobotID"] == "0042"
    assert parsed.rows[0].values["Firmware"] == "2.10"


def test_a_workbook_time_of_day_is_not_dropped():
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["robot_id", "logged_at"])
    sheet.append(["0042", datetime(2026, 9, 14, 13, 45)])
    buffer = io.BytesIO()
    workbook.save(buffer)

    parsed = parse_upload(buffer.getvalue(), "log.xlsx")
    assert parsed.rows[0].values["logged_at"] == "2026-09-14 13:45:00"


def test_an_unsupported_file_type_is_refused_with_the_accepted_formats():
    with pytest.raises(ParseError, match="CSV, TSV, XLSX or XLSM"):
        parse_upload(b"robot_id\n0042\n", "calibration.json")


# --------------------------------------------------------------------------
# Compatibility with robot_calibration_v1, decided before approval
# --------------------------------------------------------------------------


def test_a_customer_file_cannot_become_a_robotics_plan():
    customer_columns = ("customer_id", "full_name", "email", "signup_date", "balance", "region")
    validation = validate_plan(
        safe_plan(profile_id="robot_calibration_v1"), ROBOT_CALIBRATION_V1, customer_columns
    )

    reasons = " ".join(issue.reason for issue in validation.fatal_issues)
    assert "The source file has no such column." in reasons
    with pytest.raises(ApprovalRefused):
        approve(validation, "operator", APPROVED_AT, contract=ROBOT_CALIBRATION_CONTRACT_V1)


def test_a_missing_required_column_is_named_and_refused():
    plan = renamed_plan()
    without_joint = MigrationPlan(
        version=1,
        mappings=tuple(m for m in plan.mappings if m.source_column != "Joint"),
        proposed_by=plan.proposed_by,
        key_column=plan.key_column,
        date_format_policy=plan.date_format_policy,
        required_field_policy=plan.required_field_policy,
    )
    columns = tuple(c for c in USER_HEADER if c != "Joint")
    validation = validate_plan(without_joint, ROBOT_CALIBRATION_V1, columns)

    assert any(
        "Required destination column 'joint_name' has no mapping" in issue.reason
        for issue in validation.fatal_issues
    )
    with pytest.raises(ApprovalRefused):
        approve(validation, "operator", APPROVED_AT, contract=ROBOT_CALIBRATION_CONTRACT_V1)


def test_the_deterministic_baseline_does_not_guess_renamed_columns():
    """The credential-free baseline maps destination names only. It refuses a
    renamed file rather than inventing a mapping; the model proposal is the
    path that maps one, and a human still approves it."""
    validation = validate_plan(
        safe_plan(profile_id="robot_calibration_v1"), ROBOT_CALIBRATION_V1, USER_HEADER
    )
    assert validation.fatal_issues


# --------------------------------------------------------------------------
# Renamed columns are staged, keyed and verified through the approved plan
# --------------------------------------------------------------------------


def test_renamed_columns_are_staged_under_destination_names():
    _, _, result = run(user_csv())

    staged = result.committable()
    assert len(staged) == 3
    assert {row.values["robot_id"] for row in staged} == {"0042", "0043"}
    assert all(row.values["firmware_version"] in ("2.10", "2.09") for row in staged)
    assert staged[0].values["calibration_date"] == date(2026, 9, 14)
    assert isinstance(staged[0].values["zero_offset_deg"], Decimal)


def test_the_source_key_is_read_from_the_mapped_column():
    """Before this was resolved through the plan, the executor looked for a
    source column literally called robot_id, found none, and refused."""
    _, _, result = run(user_csv())
    assert [row.source_key for row in result.staged] == ["0042", "0042", "0043"]


def test_one_robot_with_two_joints_is_not_a_conflict_under_renamed_columns():
    _, _, result = run(user_csv())
    assert result.accounting.conflicts_unresolved == 0


def test_a_renamed_file_passes_every_mandatory_check():
    parsed, plan, result = run(user_csv())
    checks = checks_for(parsed, plan, result)

    assert mandatory_blockers(checks) == []
    assert checks["identifier_preservation"].status is CheckStatus.PASSED
    assert checks["date_parsing"].status is CheckStatus.PASSED
    assert checks["decimal_precision"].status is CheckStatus.PASSED


def test_without_the_plan_a_renamed_identifier_would_read_as_changed():
    """The defect the translation removes: compared by destination name, the
    source has no robot_id, so every identifier looked altered."""
    parsed, plan, result = run(user_csv())
    checks = checks_for(parsed, plan, result, translate=False)
    assert checks["identifier_preservation"].status is CheckStatus.FAILED


def test_a_file_with_destination_names_is_verified_exactly_as_before():
    rows = [SourceRow(row_number=1, values={"robot_id": "0017"})]
    assert source_rows_by_destination(rows, {"robot_id": "robot_id"}) is rows
    assert source_rows_by_destination(rows, None) is rows


def test_translation_keeps_the_original_source_values():
    rows = [SourceRow(row_number=1, values={"RobotID": "0042"})]
    translated = source_rows_by_destination(rows, {"robot_id": "RobotID"})
    assert translated[0].values == {"RobotID": "0042", "robot_id": "0042"}
    assert rows[0].values == {"RobotID": "0042"}


# --------------------------------------------------------------------------
# A user file still fails closed
# --------------------------------------------------------------------------


def test_a_changed_identifier_in_a_user_file_blocks_commit():
    parsed, plan, result = run(user_csv())
    result.staged[0].values["robot_id"] = "42"

    checks = checks_for(parsed, plan, result)
    assert checks["identifier_preservation"].status is CheckStatus.FAILED
    assert "identifier_preservation" in mandatory_blockers(checks)


def test_an_ambiguous_user_date_needs_a_human_reading():
    """With no approved reading the renamed date column is held for review,
    and an unacknowledged plan cannot be approved."""
    rows = (("0042", "hip_left", "4.500", "640.00", "2.10", "leg_left", "03/04/2026"),)
    parsed = parse_upload(user_csv(rows=rows), "workshop_export.csv")
    validation = validate_plan(
        renamed_plan(date_policy=None), ROBOT_CALIBRATION_V1, parsed.source_file.columns
    )

    flagged = [m.source_column for m in validation.plan.mappings if m.requires_acknowledgement]
    assert flagged == ["CalibratedOn"]
    with pytest.raises(ApprovalRefused):
        approve(validation, "operator", APPROVED_AT, contract=ROBOT_CALIBRATION_CONTRACT_V1)


def test_a_wrong_reading_of_an_ambiguous_date_cannot_reach_commit():
    """Even if a non-ISO date were staged under the ISO policy, the verifier
    finds no determined reading for it and the mandatory check blocks."""
    rows = (("0042", "hip_left", "4.500", "640.00", "2.10", "leg_left", "03/04/2026"),)
    parsed, plan, result = run(
        user_csv(rows=rows), plan=renamed_plan(date_policy=DateFormatPolicy.ISO)
    )

    checks = checks_for(parsed, plan, result)
    assert checks["date_parsing"].status is CheckStatus.REVIEW
    assert "date_parsing" in mandatory_blockers(checks)


def test_an_approved_day_first_reading_applies_to_a_renamed_date_column():
    rows = (("0042", "hip_left", "4.500", "640.00", "2.10", "leg_left", "03/04/2026"),)
    parsed, plan, result = run(
        user_csv(rows=rows), plan=renamed_plan(date_policy=DateFormatPolicy.DAY_FIRST)
    )

    assert result.committable()[0].values["calibration_date"] == date(2026, 4, 3)
    assert checks_for(parsed, plan, result)["date_parsing"].status is CheckStatus.PASSED


def test_mixed_decimals_in_a_user_file_need_an_approved_reading():
    rows = (
        ("0042", "hip_left", "4.500", "1,250.00", "2.10", "leg_left", "2026-09-14"),
        ("0042", "hip_right", "4.500", "1250,00", "2.10", "leg_right", "2026-09-14"),
    )
    _, _, refused = run(user_csv(rows=rows), plan=renamed_plan(gear_convention="dot_decimal"))
    assert refused.errors, "a comma value is refused under a dot reading"

    parsed, plan, accepted = run(
        user_csv(rows=rows), plan=renamed_plan(gear_convention="strict_either")
    )
    assert [r.values["gear_ratio"] for r in accepted.committable()] == [
        Decimal("1250.00"),
        Decimal("1250.00"),
    ]
    assert checks_for(parsed, plan, accepted)["decimal_precision"].status is CheckStatus.PASSED


def test_a_repeated_robot_and_joint_with_different_content_is_a_conflict():
    rows = (
        ("0042", "hip_left", "4.500", "640.00", "2.10", "leg_left", "2026-09-14"),
        ("0042", "hip_left", "4.750", "640.00", "2.10", "leg_left", "2026-09-14"),
    )
    _, _, result = run(user_csv(rows=rows))

    assert result.accounting.conflicts_unresolved == 2
    assert not result.committable()
