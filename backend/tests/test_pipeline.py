"""End to end tests for the deterministic core.

Each test names the scenario from the product brief that it covers. Nothing
here reads an expected outcome from a manifest: the pipeline computes its own
result and the assertions check that result.
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest

from app.domain.contract import CUSTOMERS_CONTRACT_V1
from app.domain.plan import ApprovalRefused, approve, validate_plan
from app.domain.plans import legacy_integer_cast_plan, safe_plan
from app.domain.schema import CUSTOMERS_V1, UNVERIFIED_PROPERTIES
from app.domain.types import (
    CheckStatus,
    DateFormatPolicy,
    Mapping,
    Operation,
    RequiredFieldPolicy,
    RowDisposition,
)
from app.domain.verification import can_commit, summarize, verify
from app.execute.executor import ExecutionRefused, execute_plan
from app.ingest.parser import ParseError, parse_upload

FIXTURES = Path(__file__).parent / "fixtures"
APPROVED_AT = "2026-09-09T04:00:00Z"


def load(name: str):
    raw = (FIXTURES / name).read_bytes()
    return parse_upload(raw, name)


def acknowledge_all(validation):
    """Every column the validator flagged as lossy, acknowledged by name."""
    return [m.source_column for m in validation.plan.mappings if m.requires_acknowledgement]


def run(fixture: str, plan, date_columns=("signup_date",)):
    parsed = load(fixture)
    validation = validate_plan(plan, CUSTOMERS_V1, parsed.source_file.columns)
    assert validation.is_executable, validation.fatal_issues
    approved = approve(
        validation,
        "test-operator",
        APPROVED_AT,
        acknowledgements=acknowledge_all(validation),
        contract=CUSTOMERS_CONTRACT_V1,
    )
    result = execute_plan(approved, CUSTOMERS_V1, parsed.rows, parsed.source_file.columns)
    checks = verify(
        parsed.rows,
        result,
        CUSTOMERS_V1,
        key_column="customer_id",
        destination_key_column="customer_id",
        date_columns=date_columns,
        unverified_properties=UNVERIFIED_PROPERTIES,
        reconciliation_fields=CUSTOMERS_CONTRACT_V1.reconciliation_fields,
    )
    return parsed, result, checks


def check_by_id(checks, check_id):
    for check in checks:
        if check.check_id == check_id:
            return check
    raise AssertionError(f"no check {check_id}")


# --- Scenario A: clean migration ----------------------------------------


def test_clean_migration_passes_and_allows_commit():
    _, result, checks = run("clean.csv", safe_plan())

    assert result.accounting.source_rows == 4
    assert result.accounting.committable_rows == 4
    assert check_by_id(checks, "identifier_preservation").status is CheckStatus.PASSED
    assert check_by_id(checks, "decimal_precision").status is CheckStatus.PASSED
    assert can_commit(checks) is True

    summary = summarize(checks)
    assert summary["failed"] == 0
    assert summary["review"] == 0

    # Properties outside the contract are reported as not verified, never
    # folded into the passed count. Aggregate reconciliation and referential
    # integrity are always here. Canonical reconciliation joins them whenever
    # the Rust binary has not been built, which is the honest answer: a check
    # that did not run has not passed.
    from app.verify import rust_bridge

    expected_unverified = 2 if rust_bridge.is_available() else 3
    assert summary["not_verified"] == expected_unverified

    reconciliation = check_by_id(checks, "canonical_reconciliation")
    if rust_bridge.is_available():
        assert reconciliation.status is CheckStatus.PASSED
    else:
        assert reconciliation.status is CheckStatus.NOT_VERIFIED
        assert "not built" in reconciliation.observed


# --- Scenario B: leading zero corruption --------------------------------


def test_integer_cast_destroys_leading_zero_and_verifier_catches_it():
    _, result, checks = run("clean.csv", legacy_integer_cast_plan())

    staged = result.staged[0]
    assert staged.values["customer_id"] == 127, "the approved cast really ran"

    identifier = check_by_id(checks, "identifier_preservation")
    assert identifier.status is CheckStatus.FAILED
    assert identifier.evidence[0].source_value == "00127"
    assert identifier.evidence[0].destination_value == "127"
    assert can_commit(checks) is False


def test_unsafe_cast_is_flagged_before_approval():
    parsed = load("clean.csv")
    validation = validate_plan(
        legacy_integer_cast_plan(), CUSTOMERS_V1, parsed.source_file.columns
    )
    mapping = validation.plan.mapping_for("customer_id")
    assert mapping is not None
    assert mapping.requires_acknowledgement is True
    assert validation.requires_acknowledgement is True


def test_repair_rereads_the_original_source():
    """The repair must go back to the file, not to the corrupted value."""
    parsed = load("clean.csv")
    broken_validation = validate_plan(
        legacy_integer_cast_plan(), CUSTOMERS_V1, parsed.source_file.columns
    )
    broken = approve(
        broken_validation, "op", APPROVED_AT,
        acknowledgements=acknowledge_all(broken_validation),
        contract=CUSTOMERS_CONTRACT_V1,
    )
    broken_result = execute_plan(
        broken, CUSTOMERS_V1, parsed.rows, parsed.source_file.columns
    )
    assert broken_result.staged[0].values["customer_id"] == 127

    revised = broken.revise(
        tuple(
            Mapping("customer_id", "customer_id", Operation.PRESERVE_IDENTIFIER_AS_STRING)
            if m.source_column == "customer_id"
            else m
            for m in broken.mappings
        )
    )
    assert revised.version == 2
    assert broken.version == 1, "the approved plan is never edited in place"

    revised_validation = validate_plan(revised, CUSTOMERS_V1, parsed.source_file.columns)
    repaired = approve(
        revised_validation, "op", APPROVED_AT,
        acknowledgements=acknowledge_all(revised_validation),
        contract=CUSTOMERS_CONTRACT_V1,
    )
    # The same original rows are passed in again. Nothing reads the staged 127.
    repaired_result = execute_plan(
        repaired, CUSTOMERS_V1, parsed.rows, parsed.source_file.columns
    )
    assert repaired_result.staged[0].values["customer_id"] == "00127"

    checks = verify(
        parsed.rows,
        repaired_result,
        CUSTOMERS_V1,
        key_column="customer_id",
        destination_key_column="customer_id",
        date_columns=("signup_date",),
    )
    assert check_by_id(checks, "identifier_preservation").status is CheckStatus.PASSED


# --- Scenario C: exact duplicate ----------------------------------------


def test_exact_duplicate_excluded_and_accounted_for():
    _, result, checks = run("exact_duplicate.csv", safe_plan())

    assert result.accounting.source_rows == 3
    assert result.accounting.duplicates_excluded == 1
    assert result.accounting.staged_rows == 2
    assert check_by_id(checks, "duplicate_detection").status is CheckStatus.PASSED
    assert check_by_id(checks, "row_accounting").status is CheckStatus.PASSED

    excluded = [
        r for r in result.staged if r.disposition is RowDisposition.DUPLICATE_EXCLUDED
    ]
    assert len(excluded) == 1


# --- Scenario D: conflicting duplicate key ------------------------------


def test_conflicting_key_is_never_silently_resolved():
    _, result, checks = run("conflicting_key.csv", safe_plan())

    conflicts = [
        r for r in result.staged if r.disposition is RowDisposition.CONFLICT_UNRESOLVED
    ]
    assert len(conflicts) == 2, "both conflicting rows are held back, not one"
    assert result.accounting.duplicates_excluded == 0
    assert check_by_id(checks, "duplicate_detection").status is CheckStatus.REVIEW
    assert can_commit(checks) is False


# --- Scenario E: ambiguous date -----------------------------------------


def test_ambiguous_date_requires_review_even_after_parsing():
    _, _, checks = run("ambiguous_date.csv", safe_plan(DateFormatPolicy.DAY_FIRST))
    date_check = check_by_id(checks, "date_parsing")
    assert date_check.status is CheckStatus.REVIEW
    assert date_check.evidence[0].source_value == "03/04/2024"


def test_date_without_policy_is_rejected_not_guessed():
    parsed = load("ambiguous_date.csv")
    plan = safe_plan(date_policy=None)
    validation = validate_plan(plan, CUSTOMERS_V1, parsed.source_file.columns)
    mapping = validation.plan.mapping_for("signup_date")
    assert mapping is not None
    assert mapping.requires_acknowledgement is True

    approved = approve(
        validation, "op", APPROVED_AT,
        acknowledgements=acknowledge_all(validation),
        contract=CUSTOMERS_CONTRACT_V1,
    )
    result = execute_plan(approved, CUSTOMERS_V1, parsed.rows, parsed.source_file.columns)
    assert result.accounting.rejected == 1
    assert "policy" in result.errors[0].reason


# --- Scenario F: missing required field ---------------------------------


def test_missing_required_field_blocks_commit():
    _, result, checks = run("missing_required.csv", safe_plan())

    assert result.accounting.quarantined == 1
    assert result.accounting.committable_rows == 1
    required = check_by_id(checks, "required_field_validation")
    assert required.status is CheckStatus.REVIEW
    assert can_commit(checks) is False


def test_policy_exclusion_resolves_the_required_field():
    parsed = load("missing_required.csv")
    plan = safe_plan(required_field_policy=RequiredFieldPolicy.POLICY_EXCLUSION)
    exclusion_validation = validate_plan(plan, CUSTOMERS_V1, parsed.source_file.columns)
    approved = approve(
        exclusion_validation, "op", APPROVED_AT,
        acknowledgements=acknowledge_all(exclusion_validation),
        contract=CUSTOMERS_CONTRACT_V1,
    )
    result = execute_plan(approved, CUSTOMERS_V1, parsed.rows, parsed.source_file.columns)
    assert result.accounting.policy_excluded == 1
    assert result.accounting.committable_rows == 1


# --- Scenario G: decimal precision --------------------------------------


def test_exact_decimals_survive_and_overscale_is_rejected():
    _, result, checks = run("decimal_precision.csv", safe_plan())

    values = {r.source_key: r.values.get("balance") for r in result.staged}
    assert values["00201"] == Decimal("0.10")
    assert values["00202"] == Decimal("0.20")

    # 1200.4999 has four decimal places against a scale of two. No rounding was
    # approved, so the row is rejected rather than quietly truncated.
    assert result.accounting.rejected == 1
    assert any("rounding policy" in e.reason for e in result.errors)
    assert check_by_id(checks, "transform_rejections").status is CheckStatus.REVIEW


# --- Scenario H: numeric overflow ---------------------------------------


def test_numeric_overflow_is_quarantined_with_evidence():
    _, result, _ = run("numeric_overflow.csv", safe_plan())
    row = result.staged[0]
    assert row.disposition is RowDisposition.QUARANTINED
    assert row.reason is not None and "exceeds the range" in row.reason


# --- Scenario I: invalid date -------------------------------------------


def test_impossible_date_is_rejected_and_no_replacement_invented():
    _, result, _ = run("invalid_date.csv", safe_plan())
    assert result.accounting.rejected == 1
    assert "not a real calendar date" in result.errors[0].reason
    assert result.staged[0].values.get("signup_date") is None


# --- Scenario K: retry and idempotency ----------------------------------


def test_running_the_same_plan_twice_gives_the_same_result():
    parsed = load("clean.csv")
    idem_validation = validate_plan(safe_plan(), CUSTOMERS_V1, parsed.source_file.columns)
    approved = approve(
        idem_validation, "op", APPROVED_AT,
        acknowledgements=acknowledge_all(idem_validation),
        contract=CUSTOMERS_CONTRACT_V1,
    )

    first = execute_plan(approved, CUSTOMERS_V1, parsed.rows, parsed.source_file.columns)
    second = execute_plan(approved, CUSTOMERS_V1, parsed.rows, parsed.source_file.columns)

    assert [r.values for r in first.staged] == [r.values for r in second.staged]
    assert first.accounting.committable_rows == second.accounting.committable_rows


# --- Scenario M: unauthorised or unsafe operation -----------------------


def test_executor_refuses_an_unapproved_plan():
    parsed = load("clean.csv")
    with pytest.raises(ExecutionRefused):
        execute_plan(safe_plan(), CUSTOMERS_V1, parsed.rows, parsed.source_file.columns)


def test_plan_targeting_an_unknown_destination_column_is_fatal():
    parsed = load("clean.csv")
    plan = safe_plan()
    broken = MigrationPlanWithBadTarget(plan)
    validation = validate_plan(broken, CUSTOMERS_V1, parsed.source_file.columns)
    assert not validation.is_executable
    assert any("no column" in issue.reason for issue in validation.fatal_issues)


def MigrationPlanWithBadTarget(plan):
    """Swap one mapping for a destination the schema does not declare."""
    mappings = tuple(
        Mapping("region", "not_a_real_column", Operation.NULL_HANDLING)
        if m.source_column == "region"
        else m
        for m in plan.mappings
    )
    return plan.revise(mappings)


# --- Parser and untrusted input -----------------------------------------


def test_malformed_row_is_reported_not_truncated():
    with pytest.raises(ParseError) as exc:
        load("malformed.csv")
    assert "malformed" in str(exc.value)


def test_formula_and_injection_text_are_stored_verbatim():
    parsed = load("untrusted_cells.csv")
    names = [row.get("full_name") for row in parsed.rows]
    assert names[0] == "=SUM(A1:A9)", "the formula is never evaluated"
    assert "Ignore previous instructions" in names[1]


def test_checksum_is_stable_and_recorded():
    first = load("clean.csv")
    second = load("clean.csv")
    assert first.source_file.checksum == second.source_file.checksum
    assert first.source_file.checksum.startswith("sha256:")


def test_unsupported_file_type_is_refused():
    with pytest.raises(ParseError):
        parse_upload(b"anything", "notes.txt")
