"""Tests over generated datasets.

The manifest records what the generator planted. These tests assert that the
pipeline found the same things by executing real checks. The application code
never sees the manifest: it is loaded here, in the test, purely to know what
the correct answer is.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.domain.contract import CUSTOMERS_CONTRACT_V1  # noqa: E402
from app.domain.plan import approve, validate_plan  # noqa: E402
from app.domain.plans import legacy_integer_cast_plan, safe_plan  # noqa: E402
from app.domain.schema import CUSTOMERS_V1, UNVERIFIED_PROPERTIES  # noqa: E402
from app.domain.types import CheckStatus, DateFormatPolicy, RowDisposition  # noqa: E402
from app.domain.verification import can_commit, summarize, verify  # noqa: E402
from app.ingest.parser import parse_csv  # noqa: E402
from scripts.generate_fixtures import (  # noqa: E402
    HAZARD_AMBIGUOUS_DATE,
    HAZARD_CONFLICTING_KEY,
    HAZARD_EXACT_DUPLICATE,
    HAZARD_FORMULA,
    HAZARD_INJECTION,
    HAZARD_INVALID_DATE,
    HAZARD_LEADING_ZERO,
    HAZARD_MISSING_REQUIRED,
    HAZARD_OVERFLOW,
    HAZARD_OVERSCALE,
    generate,
)

SEED = 20261030


def build(rows: int, inject: bool = True):
    """Generate in memory and return parsed rows plus the manifest."""
    import csv
    import io

    records, manifest = generate(
        rows=rows, seed=SEED + rows, filename=f"customers_{rows}.csv", inject=inject
    )
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=manifest.columns)
    writer.writeheader()
    writer.writerows(records)
    parsed = parse_csv(buffer.getvalue().encode("utf-8"), manifest.filename)
    return parsed, manifest


def run_pipeline(parsed, plan, date_policy=DateFormatPolicy.ISO):
    validation = validate_plan(plan, CUSTOMERS_V1, parsed.source_file.columns)
    assert validation.is_executable, validation.fatal_issues
    approved = approve(
        validation,
        "test-operator",
        "2026-09-09T05:00:00Z",
        acknowledgements=[
            m.source_column for m in validation.plan.mappings if m.requires_acknowledgement
        ],
        contract=CUSTOMERS_CONTRACT_V1,
    )
    from app.execute.executor import execute_plan

    result = execute_plan(
        approved, CUSTOMERS_V1, parsed.rows, parsed.source_file.columns
    )
    checks = verify(
        parsed.rows,
        result,
        CUSTOMERS_V1,
        key_column="customer_id",
        destination_key_column="customer_id",
        date_columns=("signup_date",),
        unverified_properties=UNVERIFIED_PROPERTIES,
        reconciliation_fields=CUSTOMERS_CONTRACT_V1.reconciliation_fields,
    )
    return result, checks


def check_by_id(checks, check_id):
    for check in checks:
        if check.check_id == check_id:
            return check
    raise AssertionError(f"no check {check_id}")


def test_generator_is_deterministic():
    first, _ = generate(rows=200, seed=SEED, filename="a.csv")
    second, _ = generate(rows=200, seed=SEED, filename="a.csv")
    assert first == second


def test_generator_plants_every_hazard_kind():
    _, manifest = build(500)
    kinds = {hazard.hazard for hazard in manifest.hazards}
    expected = {
        HAZARD_LEADING_ZERO,
        HAZARD_EXACT_DUPLICATE,
        HAZARD_CONFLICTING_KEY,
        HAZARD_MISSING_REQUIRED,
        HAZARD_AMBIGUOUS_DATE,
        HAZARD_INVALID_DATE,
        HAZARD_OVERSCALE,
        HAZARD_OVERFLOW,
        HAZARD_FORMULA,
        HAZARD_INJECTION,
    }
    assert expected.issubset(kinds)


def test_integer_cast_corrupts_every_zero_padded_identifier():
    """The correction that matters.

    An earlier frontend mock claimed a single row was damaged by the integer
    cast. Executing the transformation shows that every identifier beginning
    with a zero is destroyed, which on this dataset is all of them.
    """
    parsed, manifest = build(200, inject=False)
    planted = set(manifest.rows_for(HAZARD_LEADING_ZERO))
    assert len(planted) == 200, "every generated identifier is zero padded"

    result, checks = run_pipeline(parsed, legacy_integer_cast_plan())
    identifier = check_by_id(checks, "identifier_preservation")

    assert identifier.status is CheckStatus.FAILED
    # The check reports the true count rather than a single example.
    assert f"{len(planted)} row(s) differ" in identifier.observed
    assert can_commit(checks) is False

    damaged = [
        row
        for row in result.staged
        if row.is_committable and str(row.values.get("customer_id")) != row.source_key
    ]
    assert len(damaged) == len(planted)


def test_safe_plan_preserves_every_identifier():
    parsed, _ = build(200, inject=False)
    _, checks = run_pipeline(parsed, safe_plan())
    assert check_by_id(checks, "identifier_preservation").status is CheckStatus.PASSED
    assert can_commit(checks) is True


def test_verifier_finds_the_planted_duplicates():
    parsed, manifest = build(300)
    exact = manifest.rows_for(HAZARD_EXACT_DUPLICATE)
    conflicts = manifest.rows_for(HAZARD_CONFLICTING_KEY)

    result, checks = run_pipeline(parsed, safe_plan())

    excluded = [
        row for row in result.staged if row.disposition is RowDisposition.DUPLICATE_EXCLUDED
    ]
    assert len(excluded) == len(exact)

    if conflicts:
        # Both sides of a conflict are held back, never one silently kept.
        held = [
            row
            for row in result.staged
            if row.disposition is RowDisposition.CONFLICT_UNRESOLVED
        ]
        assert len(held) >= len(conflicts) * 2
        assert check_by_id(checks, "duplicate_detection").status is CheckStatus.REVIEW


def test_verifier_finds_the_planted_missing_required_fields():
    parsed, manifest = build(300)
    planted = manifest.rows_for(HAZARD_MISSING_REQUIRED)
    result, checks = run_pipeline(parsed, safe_plan())

    quarantined = [
        row for row in result.staged if row.disposition is RowDisposition.QUARANTINED
    ]
    quarantined_rows = {row.row_number for row in quarantined}
    for row_number in planted:
        assert row_number in quarantined_rows

    assert check_by_id(checks, "required_field_validation").status is CheckStatus.REVIEW


def test_verifier_reports_ambiguous_dates_it_was_not_told_about():
    parsed, manifest = build(300)
    planted = manifest.rows_for(HAZARD_AMBIGUOUS_DATE)
    _, checks = run_pipeline(parsed, safe_plan(DateFormatPolicy.DAY_FIRST))

    date_check = check_by_id(checks, "date_parsing")
    if planted:
        assert date_check.status is CheckStatus.REVIEW
        reported = {evidence.row_key for evidence in date_check.evidence}
        planted_ids = {
            hazard.customer_id
            for hazard in manifest.hazards
            if hazard.hazard == HAZARD_AMBIGUOUS_DATE
        }
        assert reported & planted_ids


def test_invalid_dates_and_overscale_values_are_rejected():
    parsed, manifest = build(300)
    invalid = manifest.rows_for(HAZARD_INVALID_DATE)
    overscale = manifest.rows_for(HAZARD_OVERSCALE)
    result, _ = run_pipeline(parsed, safe_plan())

    rejected_rows = {
        row.row_number for row in result.staged if row.disposition is RowDisposition.REJECTED
    }
    for row_number in invalid + overscale:
        assert row_number in rejected_rows


def test_row_accounting_always_balances():
    parsed, _ = build(1000)
    result, checks = run_pipeline(parsed, safe_plan())

    assert len(result.staged) == result.accounting.source_rows
    assert check_by_id(checks, "row_accounting").status is CheckStatus.PASSED

    dispositions = [row.disposition for row in result.staged]
    assert len(dispositions) == parsed.source_file.row_count


def test_untrusted_cell_text_never_changes_a_verdict():
    """Injection text sits in the data and has no effect on the outcome.

    Nothing in the deterministic core reads a cell as an instruction. This test
    exists so that stays true when the model client is added.
    """
    parsed, manifest = build(300)
    injected = [h for h in manifest.hazards if h.hazard == HAZARD_INJECTION]
    assert injected, "the generator planted injection text"

    _, checks = run_pipeline(parsed, safe_plan())
    summary = summarize(checks)
    # The presence of text asking for everything to pass does not make it pass.
    assert summary["review"] > 0 or summary["failed"] > 0


@pytest.mark.parametrize("size", [100, 1000])
def test_pipeline_handles_larger_datasets(size):
    parsed, _ = build(size)
    result, checks = run_pipeline(parsed, safe_plan())
    assert result.accounting.source_rows == parsed.source_file.row_count
    assert summarize(checks)["total"] == len(checks)
