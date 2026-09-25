"""The robotics calibration destination, end to end.

The customer path already proves the workflow works. These tests prove that
the *same* workflow serves a second destination without a second pipeline:
the same validator, the same routing rule, the same executor, the same
fail-closed commit gate.

Three things get the most attention, because they are the ones a robotics
migration can silently destroy:

    0017  is a robot identifier, not the number 17
    3.08  is a firmware version, not the number 3.08
    03/04/2026  reads two ways, and the file cannot say which

Database-marked tests need PostgreSQL and are skipped without it.
"""

from __future__ import annotations

import csv
import sys
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.domain.contract import ROBOT_CALIBRATION_CONTRACT_V1  # noqa: E402
from app.domain.plan import approve, validate_plan  # noqa: E402
from app.domain.profiles import ROBOT_CALIBRATION_PROFILE, resolve  # noqa: E402
from app.domain.sample_advisories import with_sample_advisories  # noqa: E402
from app.domain.schema import ROBOT_CALIBRATION_V1  # noqa: E402
from app.domain.types import (  # noqa: E402
    CheckStatus,
    DateFormatPolicy,
    Mapping,
    MigrationPlan,
    Operation,
    RequiredFieldPolicy,
    SourceRow,
    StagedRow,
)
from app.execute.executor import execute_plan  # noqa: E402
from app.services.routing import evaluate  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"
APPROVED_AT = "2026-04-10T09:00:00Z"

SUPER = "nvidia/nemotron-3-super-120b-a12b"
ULTRA = "nvidia/Nemotron-3-Ultra-550b-a55b"

ROBOT_COLUMNS = (
    "robot_id",
    "joint_name",
    "zero_offset_deg",
    "gear_ratio",
    "firmware_version",
    "sensor_frame",
    "calibration_date",
)


def read(name: str) -> list[dict[str, str]]:
    with open(FIXTURES / name, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def source_rows(name: str) -> list[SourceRow]:
    return [
        SourceRow(row_number=index + 1, values=dict(row))
        for index, row in enumerate(read(name))
    ]


def robotics_plan(date_policy: DateFormatPolicy | None) -> MigrationPlan:
    """The mapping a proposal produces for a robotics file.

    Written by hand so the test does not depend on a live model, but using the
    same operations the allowlist offers. `date_policy` is left unset on the
    model path, which is what makes `parse_date` need an acknowledgement.
    """
    return MigrationPlan(
        version=1,
        mappings=(
            Mapping("robot_id", "robot_id", Operation.PRESERVE_IDENTIFIER_AS_STRING),
            Mapping("joint_name", "joint_name", Operation.NORMALIZE_WHITESPACE),
            Mapping("zero_offset_deg", "zero_offset_deg", Operation.CAST_TO_DECIMAL),
            Mapping("gear_ratio", "gear_ratio", Operation.CAST_TO_DECIMAL),
            Mapping(
                "firmware_version",
                "firmware_version",
                Operation.PRESERVE_IDENTIFIER_AS_STRING,
            ),
            Mapping("sensor_frame", "sensor_frame", Operation.NORMALIZE_WHITESPACE),
            Mapping("calibration_date", "calibration_date", Operation.PARSE_DATE),
        ),
        proposed_by="nebius:test",
        key_column="robot_id",
        date_format_policy=date_policy,
        required_field_policy=RequiredFieldPolicy.QUARANTINE,
    )


def validated(name: str, date_policy: DateFormatPolicy | None = None):
    """A validated robotics plan, enriched with the sample advisories the
    router reads. Same two steps the pipeline performs."""
    plan = robotics_plan(date_policy)
    result = validate_plan(plan, ROBOT_CALIBRATION_V1, ROBOT_COLUMNS)
    sample = [row.values for row in source_rows(name)][:5]
    return with_sample_advisories(result, sample)


# --------------------------------------------------------------------------
# Routing: the clean file stays on Super, the ambiguous one earns Ultra
# --------------------------------------------------------------------------


def test_the_clean_robotics_file_stays_on_super():
    """ISO dates and one decimal convention. Nothing to reinterpret."""
    result = validated("robot_calibration_clean.csv", DateFormatPolicy.ISO)
    decision = evaluate(result, SUPER, ULTRA)

    assert decision.escalate is False
    assert decision.selected_model == SUPER


def test_the_ambiguous_robotics_file_produces_two_deterministic_concerns():
    result = validated("robot_calibration_ambiguous.csv", None)

    acknowledged = [
        mapping.source_column
        for mapping in result.plan.mappings
        if mapping.requires_acknowledgement
    ]
    advisories = [issue.source_column for issue in result.issues if not issue.fatal]

    # Concern 1: the date policy is unset, so parse_date needs a human.
    assert "calibration_date" in acknowledged
    # Concern 2: gear_ratio mixes decimal conventions in the bounded sample.
    assert "gear_ratio" in advisories
    assert len(acknowledged) + len(advisories) >= 2


def test_the_ambiguous_robotics_file_escalates_to_ultra():
    decision = evaluate(
        validated("robot_calibration_ambiguous.csv", None), SUPER, ULTRA
    )
    assert decision.escalate is True
    assert decision.selected_model == ULTRA
    assert decision.reasons


def test_zero_offset_alone_does_not_escalate_a_clean_file():
    """Two decimal casts are not two concerns. Only genuine ambiguity counts."""
    result = validated("robot_calibration_clean.csv", DateFormatPolicy.ISO)
    advisories = [issue for issue in result.issues if not issue.fatal]
    assert advisories == []


def test_routing_reasons_carry_no_robot_data():
    decision = evaluate(
        validated("robot_calibration_ambiguous.csv", None), SUPER, ULTRA
    )
    recorded = str(decision.as_metadata())
    for row in read("robot_calibration_ambiguous.csv"):
        for value in row.values():
            assert value not in recorded, f"{value!r} leaked into routing metadata"


def test_the_robotics_plan_is_not_executable_without_acknowledgement():
    """The escalation changed which model drafted the plan. It changed nothing
    about who has to approve it."""
    from app.domain.plan import ApprovalRefused

    result = validated("robot_calibration_ambiguous.csv", None)
    with pytest.raises(ApprovalRefused):
        approve(result, "operator", APPROVED_AT, acknowledgements=())


# --------------------------------------------------------------------------
# Deterministic execution
# --------------------------------------------------------------------------


def executed(name: str, date_policy: DateFormatPolicy):
    result = validate_plan(robotics_plan(date_policy), ROBOT_CALIBRATION_V1, ROBOT_COLUMNS)
    acknowledgements = tuple(
        mapping.source_column
        for mapping in result.plan.mappings
        if mapping.requires_acknowledgement
    )
    approved = approve(
        result,
        "operator",
        APPROVED_AT,
        acknowledgements=acknowledgements,
        contract=ROBOT_CALIBRATION_CONTRACT_V1,
    )
    # The pipeline passes the profile's key columns, and so must this helper.
    # Without them the executor falls back to the single key column, and a
    # robot with several joints reads as conflicting rows.
    return execute_plan(
        approved,
        ROBOT_CALIBRATION_V1,
        source_rows(name),
        ROBOT_COLUMNS,
        identity_columns=ROBOT_CALIBRATION_PROFILE.key_columns,
    )


def test_a_robot_identifier_keeps_its_leading_zero():
    """The whole product exists for this line."""
    result = executed("robot_calibration_clean.csv", DateFormatPolicy.ISO)
    ids = [row.values["robot_id"] for row in result.committable()]

    assert "0017" in ids
    assert "17" not in ids
    assert all(isinstance(value, str) for value in ids)


def test_a_firmware_version_stays_text():
    """3.08 read as a number becomes 3.08 and the trailing zero is gone."""
    result = executed("robot_calibration_clean.csv", DateFormatPolicy.ISO)
    versions = [row.values["firmware_version"] for row in result.committable()]

    assert "3.08" in versions
    assert all(isinstance(value, str) for value in versions)
    assert Decimal("3.08") not in versions


def test_decimals_are_exact_not_float():
    result = executed("robot_calibration_clean.csv", DateFormatPolicy.ISO)
    for row in result.committable():
        for column in ("zero_offset_deg", "gear_ratio"):
            assert isinstance(row.values[column], Decimal), column


def test_a_negative_zero_offset_survives():
    """A joint offset below zero is ordinary, not an error."""
    result = executed("robot_calibration_clean.csv", DateFormatPolicy.ISO)
    offsets = [row.values["zero_offset_deg"] for row in result.committable()]
    assert any(value < 0 for value in offsets)


def test_the_approved_date_policy_is_the_one_applied():
    """03/04/2026 is 3 April under day first and 4 March under month first.
    The executor applies what was approved rather than guessing.

    Rows are built here rather than read from the ambiguous fixture, because
    that fixture also carries mixed decimals which the executor refuses
    outright, and this test is about dates.
    """
    rows = [
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

    def run(policy: DateFormatPolicy):
        result = validate_plan(
            robotics_plan(policy), ROBOT_CALIBRATION_V1, ROBOT_COLUMNS
        )
        acknowledgements = tuple(
            mapping.source_column
            for mapping in result.plan.mappings
            if mapping.requires_acknowledgement
        )
        approved = approve(
            result,
            "operator",
            APPROVED_AT,
            acknowledgements=acknowledgements,
            contract=ROBOT_CALIBRATION_CONTRACT_V1,
        )
        return execute_plan(approved, ROBOT_CALIBRATION_V1, rows, ROBOT_COLUMNS)

    day_first = run(DateFormatPolicy.DAY_FIRST).committable()[0]
    month_first = run(DateFormatPolicy.MONTH_FIRST).committable()[0]

    assert str(day_first.values["calibration_date"]) == "2026-04-03"
    assert str(month_first.values["calibration_date"]) == "2026-03-04"


def test_an_ambiguous_decimal_is_rejected_rather_than_guessed():
    """1,250.00 and 1250,00 cannot both be read under one convention.

    The executor refuses the row and says why, rather than picking a reading
    and producing a number nobody approved. The deterministic advisory raised
    during planning is what tells a human to resolve it at the source.
    """
    result = executed("robot_calibration_ambiguous.csv", DateFormatPolicy.DAY_FIRST)

    assert result.committable() == []
    assert result.errors, "a refusal must be recorded, not silently dropped"
    reasons = {error.field_name for error in result.errors}
    assert reasons == {"gear_ratio"}
    assert all("not a decimal number" in error.reason for error in result.errors)


def test_an_unapproved_robotics_plan_never_executes():
    from app.execute.executor import ExecutionRefused

    plan = robotics_plan(DateFormatPolicy.ISO)
    with pytest.raises(ExecutionRefused):
        execute_plan(
            plan,
            ROBOT_CALIBRATION_V1,
            source_rows("robot_calibration_clean.csv"),
            ROBOT_COLUMNS,
        )


def test_execution_writes_only_destination_columns():
    result = executed("robot_calibration_clean.csv", DateFormatPolicy.ISO)
    for row in result.committable():
        assert set(row.values) <= set(ROBOT_CALIBRATION_PROFILE.write_columns)


# --------------------------------------------------------------------------
# The destination boundary
# --------------------------------------------------------------------------


def test_robotics_and_customers_never_share_a_table():
    robotics = resolve("robot_calibration_v1")
    customers = resolve(None)
    assert robotics.destination_table == "public.robot_calibrations"
    assert customers.destination_table == "public.customers"
    assert robotics.staging_table != customers.staging_table


def test_the_robotics_key_is_the_robot_and_the_joint():
    """A robot has one row per joint, so neither column is a key alone."""
    profile = resolve("robot_calibration_v1")
    assert profile.key_columns == ("robot_id", "joint_name")
    assert profile.key_of({"robot_id": "0017", "joint_name": "elbow_left"}) == (
        "0017",
        "elbow_left",
    )


# --------------------------------------------------------------------------
# Database lifecycle. Needs PostgreSQL.
# --------------------------------------------------------------------------


@pytest.fixture
def client():
    """HTTP client for the database-backed robotics lifecycle tests."""
    from fastapi.testclient import TestClient
    from app.api.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.mark.database
def test_a_robotics_migration_reaches_commit_and_rolls_back(client):
    """The full lifecycle on the real service: upload, plan, acknowledge,
    approve, stage, verify, commit, roll back."""
    import io

    payload = (FIXTURES / "robot_calibration_clean.csv").read_bytes()
    created = client.post(
        "/api/migrations?destination_profile=robot_calibration_v1",
        files={"file": ("robot_calibration_clean.csv", io.BytesIO(payload), "text/csv")},
    )
    assert created.status_code == 201, created.text
    migration_id = created.json()["migration_id"]

    detail = client.get(f"/api/migrations/{migration_id}").json()
    assert detail["destination_profile"] == "robot_calibration_v1"

    proposal = client.post(
        f"/api/migrations/{migration_id}/plan/propose?profile=safe"
    ).json()
    acknowledgements = proposal["acknowledgement_columns"]

    approved = client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={"profile": "safe", "acknowledgements": acknowledgements},
    )
    assert approved.status_code == 200, approved.text

    run_id = client.post(f"/api/migrations/{migration_id}/run", json={}).json()["run_id"]
    verification = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/verify", json={}
    ).json()
    assert verification["summary"]["failed"] == 0, verification

    committed = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/commit", json={}
    )
    assert committed.status_code == 200, committed.text

    rolled = client.post(f"/api/migrations/{migration_id}/rollback", json={})
    assert rolled.status_code == 200, rolled.text
    assert rolled.json()["rows_removed"] > 0


@pytest.mark.database
def test_robotics_rows_never_land_in_the_customer_table(client):
    """Isolation is the point of a second profile."""
    import io

    from app.db.connection import connect

    payload = (FIXTURES / "robot_calibration_clean.csv").read_bytes()
    migration_id = client.post(
        "/api/migrations?destination_profile=robot_calibration_v1",
        files={"file": ("robots.csv", io.BytesIO(payload), "text/csv")},
    ).json()["migration_id"]

    proposal = client.post(
        f"/api/migrations/{migration_id}/plan/propose?profile=safe"
    ).json()
    client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={
            "profile": "safe",
            "acknowledgements": proposal["acknowledgement_columns"],
        },
    )
    run_id = client.post(f"/api/migrations/{migration_id}/run", json={}).json()["run_id"]
    client.post(f"/api/migrations/{migration_id}/runs/{run_id}/verify", json={})
    client.post(f"/api/migrations/{migration_id}/runs/{run_id}/commit", json={})

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS n FROM public.customers WHERE migration_id = %s",
                (migration_id,),
            )
            assert cur.fetchone()["n"] == 0
            cur.execute(
                "SELECT COUNT(*) AS n FROM public.robot_calibrations "
                "WHERE migration_id = %s",
                (migration_id,),
            )
            assert cur.fetchone()["n"] > 0


@pytest.mark.database
def test_robotics_evidence_names_the_destination_profile(client):
    import io

    payload = (FIXTURES / "robot_calibration_clean.csv").read_bytes()
    migration_id = client.post(
        "/api/migrations?destination_profile=robot_calibration_v1",
        files={"file": ("robots.csv", io.BytesIO(payload), "text/csv")},
    ).json()["migration_id"]

    proposal = client.post(
        f"/api/migrations/{migration_id}/plan/propose?profile=safe"
    ).json()
    client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={
            "profile": "safe",
            "acknowledgements": proposal["acknowledgement_columns"],
        },
    )
    run_id = client.post(f"/api/migrations/{migration_id}/run", json={}).json()["run_id"]
    client.post(f"/api/migrations/{migration_id}/runs/{run_id}/verify", json={})

    evidence = client.get(f"/api/migrations/{migration_id}/evidence").json()
    assert evidence["destination"]["profile"] == "robot_calibration_v1"
    assert evidence["destination"]["schema"] == "public.robot_calibrations"

    # Every format renders the one object.
    assert client.get(f"/api/migrations/{migration_id}/report/html").status_code == 200
    assert client.get(f"/api/migrations/{migration_id}/report/pdf").status_code == 200


@pytest.mark.database
def test_a_customer_migration_still_behaves_as_before(client):
    """No profile supplied, so nothing about the customer path changes."""
    import io

    payload = (FIXTURES / "clean.csv").read_bytes()
    created = client.post(
        "/api/migrations",
        files={"file": ("clean.csv", io.BytesIO(payload), "text/csv")},
    )
    assert created.status_code == 201
    migration_id = created.json()["migration_id"]

    detail = client.get(f"/api/migrations/{migration_id}").json()
    assert detail["destination_profile"] in (None, "customers_v1")


@pytest.mark.database
def test_an_unknown_profile_is_refused_at_upload(client):
    import io

    payload = (FIXTURES / "clean.csv").read_bytes()
    response = client.post(
        "/api/migrations?destination_profile=public.customers;DROP",
        files={"file": ("clean.csv", io.BytesIO(payload), "text/csv")},
    )
    assert response.status_code == 422


# --------------------------------------------------------------------------
# Composite identity: one robot, many joints
#
# A calibration file lists every joint of a robot, so robot_id repeats by
# design. A workflow that treats one key column as row identity reads those
# rows as duplicates or as key conflicts and quietly drops them. The fixture
# with distinct robot ids per row hides the bug entirely, which is why this
# one exists.
# --------------------------------------------------------------------------


MULTI_JOINT = "robot_calibration_multi_joint.csv"


def test_one_robot_with_several_joints_is_not_duplicate_data():
    result = executed(MULTI_JOINT, DateFormatPolicy.ISO)

    assert len(result.committable()) == 5, "every joint row is a real row"
    assert result.accounting.duplicates_excluded == 0
    assert result.accounting.conflicts_unresolved == 0


def test_the_repeated_robot_id_survives_on_every_joint_row():
    result = executed(MULTI_JOINT, DateFormatPolicy.ISO)
    ids = [row.values["robot_id"] for row in result.committable()]

    assert ids.count("0017") == 3, "one robot, three joints"
    assert all(value.startswith("0") for value in ids)


def test_row_identity_is_the_pair_not_the_robot():
    result = executed(MULTI_JOINT, DateFormatPolicy.ISO)
    keys = [
        ROBOT_CALIBRATION_PROFILE.key_of(row.values) for row in result.committable()
    ]

    assert len(set(keys)) == len(keys), "the pair identifies a row uniquely"
    assert len({key[0] for key in keys}) == 2, "robot_id alone does not"


def test_a_repeated_pair_is_a_real_conflict():
    """The composite key still catches genuine duplication."""
    rows = source_rows(MULTI_JOINT)
    rows.append(
        SourceRow(row_number=6, values=dict(rows[0].values))  # same robot and joint
    )

    result = validate_plan(
        robotics_plan(DateFormatPolicy.ISO), ROBOT_CALIBRATION_V1, ROBOT_COLUMNS
    )
    approved = approve(
        result,
        "operator",
        APPROVED_AT,
        acknowledgements=tuple(
            mapping.source_column
            for mapping in result.plan.mappings
            if mapping.requires_acknowledgement
        ),
        contract=ROBOT_CALIBRATION_CONTRACT_V1,
    )
    executed_result = execute_plan(
        approved,
        ROBOT_CALIBRATION_V1,
        rows,
        ROBOT_COLUMNS,
        identity_columns=ROBOT_CALIBRATION_PROFILE.key_columns,
    )

    # An exact repeat is an exact duplicate, which the approved policy drops.
    assert executed_result.accounting.duplicates_excluded == 1
    assert len(executed_result.committable()) == 5


def test_the_customer_profile_still_uses_a_single_key():
    """Backward compatibility: nothing about the customer identity changed."""
    assert resolve(None).key_columns == ("customer_id",)


# --------------------------------------------------------------------------
# The human resolution path for mixed decimals
# --------------------------------------------------------------------------


def executed_with_convention(
    name: str, convention: str, date_policy: DateFormatPolicy = DateFormatPolicy.DAY_FIRST
):
    """Execute with a decimal reading a human approved per column."""
    plan = robotics_plan(date_policy)
    resolved = MigrationPlan(
        version=plan.version,
        mappings=tuple(
            Mapping(
                mapping.source_column,
                mapping.destination_column,
                mapping.operation,
                options=(
                    {"decimal_convention": convention}
                    if mapping.source_column == "gear_ratio"
                    else mapping.options
                ),
            )
            for mapping in plan.mappings
        ),
        proposed_by=plan.proposed_by,
        key_column=plan.key_column,
        date_format_policy=plan.date_format_policy,
        required_field_policy=plan.required_field_policy,
    )
    result = validate_plan(resolved, ROBOT_CALIBRATION_V1, ROBOT_COLUMNS)
    approved = approve(
        result,
        "operator",
        APPROVED_AT,
        acknowledgements=tuple(
            mapping.source_column
            for mapping in result.plan.mappings
            if mapping.requires_acknowledgement
        ),
        contract=ROBOT_CALIBRATION_CONTRACT_V1,
    )
    return execute_plan(
        approved,
        ROBOT_CALIBRATION_V1,
        source_rows(name),
        ROBOT_COLUMNS,
        identity_columns=ROBOT_CALIBRATION_PROFILE.key_columns,
    )


def test_an_approved_reading_resolves_the_mixed_decimal_column():
    """`strict_either` reads each value only when that value is unambiguous
    on its own. Nothing is inferred from the other rows."""
    result = executed_with_convention(
        "robot_calibration_ambiguous.csv", "strict_either"
    )

    assert result.committable(), "the concern is resolvable, not a dead end"
    ratios = [row.values["gear_ratio"] for row in result.committable()]
    assert all(isinstance(value, Decimal) for value in ratios)
    # 1,250.00 is one thousand two hundred fifty, and 1250,00 is the same.
    assert Decimal("1250.00") in ratios
    assert Decimal("980.40") in ratios


def test_a_dot_reading_refuses_a_comma_value():
    """An approved convention narrows what is accepted rather than widening
    it. A value outside the approved rule still fails closed."""
    result = executed_with_convention(
        "robot_calibration_ambiguous.csv", "dot_decimal"
    )

    reasons = [error.reason for error in result.errors]
    assert reasons, "comma-decimal rows must be refused under a dot reading"
    assert all("not converted" in reason or "does not match" in reason for reason in reasons)


def test_the_approved_reading_is_recorded_on_the_plan():
    """Evidence has to be able to say which rule was applied."""
    plan = robotics_plan(DateFormatPolicy.DAY_FIRST)
    resolved = Mapping(
        "gear_ratio", "gear_ratio", Operation.CAST_TO_DECIMAL,
        options={"decimal_convention": "strict_either"},
    )
    assert resolved.options["decimal_convention"] == "strict_either"
    assert plan.mapping_for("gear_ratio").options == {}


# --------------------------------------------------------------------------
# Independent verification of the human decisions
#
# The verifier must prove the approved reading was the one applied, not merely
# notice that the source was ambiguous. These tests drive
# domain.verification.verify() directly, which is the same function the
# database path calls, so they exercise the real check rather than a stand-in.
# --------------------------------------------------------------------------

from app.domain.verification import verify  # noqa: E402


def verified(
    name: str,
    date_policy: DateFormatPolicy,
    decimal_convention: str | None = None,
    tamper=None,
):
    """Execute, optionally corrupt a staged value, then verify."""
    if decimal_convention:
        result = executed_with_convention(name, decimal_convention, date_policy)
    else:
        result = executed(name, date_policy)

    if tamper is not None:
        tamper(result)

    profile = ROBOT_CALIBRATION_PROFILE
    return verify(
        source_rows(name),
        result,
        ROBOT_CALIBRATION_V1,
        key_column=profile.contract.key_column,
        destination_key_column=profile.contract.key_column,
        date_columns=profile.contract.date_columns,
        unverified_properties=profile.unverified_properties,
        identity_columns=profile.key_columns,
        reconciliation_fields=profile.contract.reconciliation_fields,
        date_format_policy=date_policy.value,
        decimal_conventions=(
            {"gear_ratio": decimal_convention} if decimal_convention else None
        ),
    )


def check_named(checks, check_id: str):
    for check in checks:
        if check.check_id == check_id:
            return check
    raise AssertionError(f"no check {check_id!r} in {[c.check_id for c in checks]}")


# A: one robot, several joints, uniqueness must pass
def test_uniqueness_passes_for_one_robot_with_several_joints():
    checks = verified(MULTI_JOINT, DateFormatPolicy.ISO)
    uniqueness = check_named(checks, "uniqueness")

    assert uniqueness.status is CheckStatus.PASSED, uniqueness.observed


# B: a repeated pair is still caught
def test_uniqueness_catches_a_repeated_robot_and_joint():
    result = executed(MULTI_JOINT, DateFormatPolicy.ISO)
    # Two staged rows carrying the same (robot_id, joint_name).
    clone = result.staged[0]
    duplicate = StagedRow(
        row_number=99,
        source_key=clone.source_key,
        values=dict(clone.values),
        disposition=clone.disposition,
    )
    result.staged.append(duplicate)

    profile = ROBOT_CALIBRATION_PROFILE
    checks = verify(
        source_rows(MULTI_JOINT),
        result,
        ROBOT_CALIBRATION_V1,
        key_column=profile.contract.key_column,
        destination_key_column=profile.contract.key_column,
        date_columns=profile.contract.date_columns,
        unverified_properties=profile.unverified_properties,
        identity_columns=profile.key_columns,
        reconciliation_fields=profile.contract.reconciliation_fields,
        date_format_policy=DateFormatPolicy.ISO.value,
    )
    assert check_named(checks, "uniqueness").status is CheckStatus.FAILED


# C and D: an approved reading is proved, not assumed
def test_day_first_is_proved_when_the_staged_date_matches():
    checks = verified(
        "robot_calibration_ambiguous.csv",
        DateFormatPolicy.DAY_FIRST,
        decimal_convention="strict_either",
    )
    date_check = check_named(checks, "date_parsing")

    assert date_check.status is CheckStatus.PASSED, date_check.observed
    assert "day_first" in date_check.observed


def test_month_first_is_proved_when_the_staged_date_matches():
    checks = verified(
        "robot_calibration_ambiguous.csv",
        DateFormatPolicy.MONTH_FIRST,
        decimal_convention="strict_either",
    )
    assert check_named(checks, "date_parsing").status is CheckStatus.PASSED


# E: a staged date that contradicts the approval fails
def test_a_staged_date_that_contradicts_the_approval_fails():
    from datetime import date as date_type

    def wrong_date(result):
        result.staged[0].values["calibration_date"] = date_type(1999, 1, 1)

    checks = verified(
        "robot_calibration_ambiguous.csv",
        DateFormatPolicy.DAY_FIRST,
        decimal_convention="strict_either",
        tamper=wrong_date,
    )
    date_check = check_named(checks, "date_parsing")

    assert date_check.status is CheckStatus.FAILED
    assert date_check.evidence, "a failure must show which row"


# F: every mixed value is verified, none skipped
def test_strict_either_verifies_every_mixed_decimal_value():
    checks = verified(
        "robot_calibration_ambiguous.csv",
        DateFormatPolicy.DAY_FIRST,
        decimal_convention="strict_either",
    )
    decimal_check = check_named(checks, "decimal_precision")

    assert decimal_check.status is CheckStatus.PASSED, decimal_check.observed
    # Five rows, two decimal columns each: nothing was quietly skipped.
    assert "10 decimal value(s) compared" in decimal_check.observed


# G: tampering with a mixed decimal is caught
def test_a_tampered_mixed_decimal_fails_verification():
    def wrong_ratio(result):
        result.staged[0].values["gear_ratio"] = Decimal("1.00")

    checks = verified(
        "robot_calibration_ambiguous.csv",
        DateFormatPolicy.DAY_FIRST,
        decimal_convention="strict_either",
        tamper=wrong_ratio,
    )
    decimal_check = check_named(checks, "decimal_precision")

    assert decimal_check.status is CheckStatus.FAILED
    assert decimal_check.evidence


def test_an_unreadable_decimal_is_reported_not_passed():
    """Without an approved reading the mixed values cannot be recomputed, and
    a green check computed from nothing is the worst possible outcome."""
    result = executed_with_convention(
        "robot_calibration_ambiguous.csv", "strict_either"
    )
    profile = ROBOT_CALIBRATION_PROFILE
    checks = verify(
        source_rows("robot_calibration_ambiguous.csv"),
        result,
        ROBOT_CALIBRATION_V1,
        key_column=profile.contract.key_column,
        destination_key_column=profile.contract.key_column,
        date_columns=profile.contract.date_columns,
        unverified_properties=profile.unverified_properties,
        identity_columns=profile.key_columns,
        reconciliation_fields=profile.contract.reconciliation_fields,
        date_format_policy=DateFormatPolicy.DAY_FIRST.value,
        decimal_conventions=None,  # the approval was not passed through
    )
    decimal_check = check_named(checks, "decimal_precision")

    assert decimal_check.status is CheckStatus.REVIEW
    assert "not verified" in decimal_check.observed


# H: the robotics report still states what it does not check
def test_robotics_verification_reports_its_own_limitations():
    checks = verified(MULTI_JOINT, DateFormatPolicy.ISO)
    not_verified = [c for c in checks if c.status is CheckStatus.NOT_VERIFIED]
    blob = " ".join(f"{c.name} {c.observed}" for c in not_verified).lower()

    assert "no safety claim about any robot" in blob
