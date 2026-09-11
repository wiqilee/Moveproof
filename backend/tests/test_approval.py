"""Negative tests for the approval gate.

Batch 3, correction 2.5. Model output must not become an executable plan just
because an approval function was called. Every test here asserts a refusal.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.domain.contract import CUSTOMERS_CONTRACT_V1, VerificationContract  # noqa: E402
from app.domain.plan import (  # noqa: E402
    ApprovalRefused,
    approve,
    validate_and_approve,
    validate_plan,
)
from app.domain.plans import legacy_integer_cast_plan, safe_plan  # noqa: E402
from app.domain.schema import CUSTOMERS_V1  # noqa: E402
from app.domain.types import (  # noqa: E402
    MappingStatus,
    Mapping,
    MigrationPlan,
    Operation,
)
from app.execute.executor import ExecutionRefused, execute_plan  # noqa: E402
from app.ingest.parser import parse_csv  # noqa: E402

AT = "2026-09-09T07:00:00Z"

CSV = b"""customer_id,full_name,email,signup_date,balance,region
00127,Amara Chen,amara.chen@example.com,2024-03-16,1200.50,APAC
"""


def parsed():
    return parse_csv(CSV, "clean.csv")


def validation_for(plan):
    return validate_plan(plan, CUSTOMERS_V1, parsed().source_file.columns)


def acknowledge_all(validation):
    return [m.source_column for m in validation.plan.mappings if m.requires_acknowledgement]


# --- fatal validation blocks approval ------------------------------------


def test_missing_required_mapping_cannot_be_approved():
    plan = safe_plan()
    stripped = MigrationPlan(
        version=plan.version,
        mappings=tuple(m for m in plan.mappings if m.destination_column != "email"),
        proposed_by=plan.proposed_by,
        key_column=plan.key_column,
        date_format_policy=plan.date_format_policy,
    )
    validation = validation_for(stripped)
    assert not validation.is_executable

    with pytest.raises(ApprovalRefused) as exc:
        approve(validation, "operator", AT)
    assert "fatal validation issues" in str(exc.value)


def test_duplicate_destination_mapping_cannot_be_approved():
    plan = safe_plan()
    doubled = plan.revise(
        plan.mappings
        + (Mapping("region", "email", Operation.RENAME_FIELD),)
    )
    validation = validation_for(doubled)
    assert not validation.is_executable

    with pytest.raises(ApprovalRefused):
        approve(validation, "operator", AT)


def test_unknown_destination_column_cannot_be_approved():
    plan = safe_plan()
    broken = plan.revise(
        tuple(
            Mapping("region", "not_a_column", Operation.NULL_HANDLING)
            if m.source_column == "region"
            else m
            for m in plan.mappings
        )
    )
    with pytest.raises(ApprovalRefused):
        approve(validation_for(broken), "operator", AT)


def test_mapping_for_a_column_the_file_does_not_have_is_fatal():
    plan = safe_plan()
    broken = plan.revise(
        plan.mappings + (Mapping("nickname", "region", Operation.RENAME_FIELD),)
    )
    validation = validation_for(broken)
    assert not validation.is_executable
    assert any("no such column" in issue.reason.lower() for issue in validation.fatal_issues)


# --- lossy operations require a recorded acknowledgement -----------------


def test_unacknowledged_lossy_cast_cannot_be_approved():
    validation = validation_for(legacy_integer_cast_plan())
    assert validation.is_executable, "the plan is structurally valid"
    assert validation.requires_acknowledgement

    with pytest.raises(ApprovalRefused) as exc:
        approve(validation, "operator", AT)
    assert "not acknowledged" in str(exc.value)
    assert "customer_id" in str(exc.value)


def test_acknowledging_the_wrong_column_does_not_help():
    validation = validation_for(legacy_integer_cast_plan())
    with pytest.raises(ApprovalRefused):
        approve(validation, "operator", AT, acknowledgements=["region"])


def test_acknowledgement_is_recorded_on_the_approved_plan():
    validation = validation_for(legacy_integer_cast_plan())
    approved = approve(
        validation,
        "operator",
        AT,
        acknowledgements=acknowledge_all(validation),
        contract=CUSTOMERS_CONTRACT_V1,
    )
    assert "customer_id" in approved.acknowledgements
    assert approved.approved_by == "operator"
    assert all(m.status is MappingStatus.APPROVED for m in approved.mappings)


# --- approval is bound to a contract -------------------------------------


def test_approval_records_the_contract_hash():
    validation = validation_for(safe_plan())
    approved = approve(
        validation, "operator", AT, contract=CUSTOMERS_CONTRACT_V1
    )
    assert approved.contract_hash == CUSTOMERS_CONTRACT_V1.hash()


def test_a_different_contract_produces_a_different_hash():
    other = VerificationContract(
        version="vc-2",
        destination_schema="public.customers",
        destination_schema_version="v1",
        key_column="customer_id",
        date_columns=(),
    )
    assert other.hash() != CUSTOMERS_CONTRACT_V1.hash()


def test_contract_hash_is_stable_across_calls():
    assert CUSTOMERS_CONTRACT_V1.hash() == CUSTOMERS_CONTRACT_V1.hash()


# --- revision never overwrites an approved version -----------------------


def test_revision_creates_a_new_unapproved_version():
    validation = validation_for(safe_plan())
    approved = approve(validation, "operator", AT, contract=CUSTOMERS_CONTRACT_V1)
    assert approved.version == 1
    assert approved.is_approved

    revised = approved.revise(approved.mappings)
    assert revised.version == 2
    assert revised.is_approved is False
    assert revised.acknowledgements == ()
    assert revised.contract_hash is None
    # The original object is untouched.
    assert approved.version == 1
    assert approved.is_approved


# --- the executor checks the plan it was handed --------------------------


def test_executor_refuses_a_hand_built_approved_looking_plan():
    """Setting a timestamp is not approval."""
    forged = MigrationPlan(
        version=1,
        mappings=safe_plan().mappings,
        proposed_by="attacker",
        key_column="customer_id",
        approved_at=AT,
        approved_by="nobody",
    )
    file = parsed()
    with pytest.raises(ExecutionRefused) as exc:
        execute_plan(forged, CUSTOMERS_V1, file.rows, file.source_file.columns)
    assert "not marked approved" in str(exc.value)


def test_executor_refuses_an_approved_plan_missing_its_acknowledgement():
    validation = validation_for(legacy_integer_cast_plan())
    approved = approve(
        validation,
        "operator",
        AT,
        acknowledgements=acknowledge_all(validation),
        contract=CUSTOMERS_CONTRACT_V1,
    )
    # Strip the recorded acknowledgement without touching anything else.
    tampered = MigrationPlan(
        version=approved.version,
        mappings=approved.mappings,
        proposed_by=approved.proposed_by,
        key_column=approved.key_column,
        date_format_policy=approved.date_format_policy,
        approved_at=approved.approved_at,
        approved_by=approved.approved_by,
        acknowledgements=(),
        contract_hash=approved.contract_hash,
    )
    file = parsed()
    with pytest.raises(ExecutionRefused) as exc:
        execute_plan(tampered, CUSTOMERS_V1, file.rows, file.source_file.columns)
    assert "no recorded acknowledgement" in str(exc.value)


# --- the convenience path applies the same rules -------------------------


def test_validate_and_approve_refuses_the_same_plans():
    file = parsed()
    with pytest.raises(ApprovalRefused):
        validate_and_approve(
            legacy_integer_cast_plan(),
            CUSTOMERS_V1,
            file.source_file.columns,
            "operator",
            AT,
        )


def test_validate_and_approve_succeeds_on_a_safe_plan():
    file = parsed()
    approved = validate_and_approve(
        safe_plan(),
        CUSTOMERS_V1,
        file.source_file.columns,
        "operator",
        AT,
        contract=CUSTOMERS_CONTRACT_V1,
    )
    assert approved.is_approved
    assert approved.contract_hash is not None


# --- the contract knows what has not run ---------------------------------


def test_contract_reports_missing_mandatory_checks():
    executed = {"row_accounting", "identifier_preservation"}
    missing = CUSTOMERS_CONTRACT_V1.missing_checks(executed)
    assert "uniqueness" in missing
    assert "row_accounting" not in missing


def test_advisory_checks_are_not_mandatory():
    assert not CUSTOMERS_CONTRACT_V1.is_mandatory("aggregate_reconciliation")
    assert CUSTOMERS_CONTRACT_V1.is_mandatory("identifier_preservation")
