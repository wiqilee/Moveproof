"""Selective reasoning escalation.

Two things under test, weighted differently.

The routing itself is ordinary: routine plans stay on Super, interacting
ambiguities justify a second pass on Ultra, and a missing escalation model
leaves behaviour exactly as it was.

The safety boundary is the part that matters. Escalation changes which model
drafts a proposal and nothing else. A deeper model does not skip validation,
does not skip acknowledgement, does not widen the data boundary, and cannot
reach the executor by any path the first proposal could not use. Model
capability may increase; model authority does not.

All inference is mocked. A test suite that spends Nebius credits is a test
suite people stop running.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.domain.plan import ValidationIssue, ValidationResult, validate_plan  # noqa: E402
from app.domain.plans import legacy_integer_cast_plan, safe_plan  # noqa: E402
from app.domain.schema import CUSTOMERS_V1  # noqa: E402
from app.domain.types import DateFormatPolicy  # noqa: E402
from app.services.routing import (  # noqa: E402
    INTERACTION_THRESHOLD,
    RoutingDecision,
    evaluate,
)


def concerning(acknowledged: int, advisories: int) -> ValidationResult:
    """A validated plan carrying a given number of interpretation concerns.

    Built from the legacy profile so the acknowledgement flags are the domain's
    own, not invented for the test.
    """
    plan = legacy_integer_cast_plan(date_policy=DateFormatPolicy.ISO)
    result = validate_plan(plan, CUSTOMERS_V1, COLUMNS)
    marked = [m for m in result.plan.mappings if m.requires_acknowledgement]
    assert marked, "the legacy profile must flag at least one lossy mapping"

    return ValidationResult(
        plan=result.plan,
        issues=[
            ValidationIssue(f"column_{i}", "legal but questionable", False)
            for i in range(advisories)
        ],
    )

SUPER = "nvidia/nemotron-3-super-120b-a12b"
ULTRA = "nvidia/Nemotron-3-Ultra-550b-a55b"

COLUMNS = ("customer_id", "full_name", "email", "signup_date", "balance", "region")


def validated(plan) -> ValidationResult:
    return validate_plan(plan, CUSTOMERS_V1, COLUMNS)


# --------------------------------------------------------------------------
# Routing
# --------------------------------------------------------------------------


def test_a_routine_plan_stays_on_the_default_model():
    """The safe profile preserves identifiers and needs no deeper reading."""
    decision = evaluate(validated(safe_plan(date_policy=DateFormatPolicy.ISO)), SUPER, ULTRA)

    assert decision.escalate is False
    assert decision.selected_model == SUPER
    assert decision.reasons == ()


def test_the_leading_zero_demo_alone_does_not_escalate():
    """One acknowledged cast is an ordinary migration.

    The legacy profile is the leading-zero demonstration: a single known risk,
    correctly handled by the acknowledgement gate. Escalating it would mean
    escalating nearly everything.
    """
    decision = evaluate(
        validated(legacy_integer_cast_plan(date_policy=DateFormatPolicy.ISO)),
        SUPER,
        ULTRA,
    )
    assert decision.escalate is False
    assert decision.selected_model == SUPER


def test_interacting_concerns_justify_a_deeper_pass():
    """One lossy mapping plus a validation concern is two concerns."""
    decision = evaluate(concerning(acknowledged=1, advisories=1), SUPER, ULTRA)

    assert decision.escalate is True
    assert decision.selected_model == ULTRA
    assert decision.reasons, "an escalation must always say why"
    assert any("constrain" in reason for reason in decision.reasons)


def test_one_concern_alone_is_not_enough():
    decision = evaluate(concerning(acknowledged=1, advisories=0), SUPER, ULTRA)
    assert decision.escalate is False
    assert decision.selected_model == SUPER


def test_dataset_size_is_never_a_signal():
    """Routing reads the plan, not the file.

    A million clean rows are easy; fifty messy ones are hard. The decision
    function has no access to a row count, which is the strongest possible
    guarantee that it cannot route on one.
    """
    import inspect

    source = inspect.getsource(evaluate)
    for forbidden in ("row_count", "len(rows)", "source_rows", "load_source_rows"):
        assert forbidden not in source


def test_verifier_signals_are_never_consulted_at_planning_time():
    """Verification happens long after planning.

    Routing on a check result would mean routing on information that does not
    exist yet.
    """
    import inspect

    source = inspect.getsource(evaluate)
    for forbidden in ("CheckStatus", "verification", "verify", "checks"):
        assert forbidden not in source


# --------------------------------------------------------------------------
# Fallback
# --------------------------------------------------------------------------


def test_no_escalation_model_configured_keeps_the_first_proposal():
    """Today's behaviour, unchanged, when nothing is configured."""
    decision = evaluate(
        concerning(acknowledged=1, advisories=1), SUPER, None
    )

    assert decision.escalate is False
    assert decision.selected_model == SUPER
    # The signals still fired, and the record says so rather than pretending
    # nothing was noticed.
    assert any("no escalation model is configured" in r for r in decision.reasons)


def test_an_empty_escalation_model_is_treated_as_unconfigured():
    decision = evaluate(
        concerning(acknowledged=1, advisories=1), SUPER, ""
    )
    assert decision.escalate is False
    assert decision.selected_model == SUPER


# --------------------------------------------------------------------------
# Audit metadata
# --------------------------------------------------------------------------


def test_the_decision_records_both_model_ids_and_the_reason():
    decision = evaluate(concerning(acknowledged=1, advisories=1), SUPER, ULTRA)
    metadata = decision.as_metadata()

    assert metadata["default_model"] == SUPER
    assert metadata["selected_model"] == ULTRA
    assert metadata["escalated"] is True
    assert metadata["reasons"]


def test_no_credential_can_reach_the_routing_metadata():
    """The decision carries model ids and reasons. There is no field for a key."""
    decision = RoutingDecision(
        escalate=True, default_model=SUPER, selected_model=ULTRA, reasons=("why",)
    )
    assert set(decision.as_metadata()) == {
        "default_model",
        "selected_model",
        "escalated",
        "reasons",
    }


def test_routing_metadata_carries_no_row_values():
    decision = evaluate(concerning(acknowledged=1, advisories=1), SUPER, ULTRA)
    recorded = str(decision.as_metadata())
    for forbidden in ("00127", "amara.chen@example.com", "Amara Chen", "1200.50"):
        assert forbidden not in recorded


# --------------------------------------------------------------------------
# The safety boundary
# --------------------------------------------------------------------------


def test_escalation_cannot_change_what_validation_accepts():
    """Both proposals go through the same validator.

    Asserted by construction: `evaluate` returns a decision and nothing else.
    It has no access to a plan it could mark executable.
    """
    decision = evaluate(concerning(acknowledged=1, advisories=1), SUPER, ULTRA)
    assert not hasattr(decision, "plan")
    assert not hasattr(decision, "approved")
    assert not hasattr(decision, "is_executable")


def test_routing_cannot_reach_any_mutating_code_path():
    """The module imports nothing that writes."""
    source = Path("app/services/routing.py").read_text()
    for forbidden in (
        "repository.",
        "execute_plan",
        "approve(",
        "commit",
        "psycopg",
        "INSERT",
        "UPDATE",
        "DELETE",
    ):
        assert forbidden not in source, f"routing must not reference {forbidden}"


def test_an_escalated_plan_still_requires_acknowledgement():
    """A deeper model does not get to waive a human decision.

    The lossy mappings that triggered escalation are exactly the ones that
    still need naming by a person afterwards.
    """
    validation = concerning(acknowledged=1, advisories=1)
    decision = evaluate(validation, SUPER, ULTRA)

    assert decision.escalate is True
    assert validation.requires_acknowledgement is True


def test_both_models_share_one_bounded_input():
    """Escalation buys deeper reasoning, never a wider view of the data."""
    source = Path("app/services/pipeline.py").read_text()
    orchestrator = source[
        source.index("def _propose_with_routing") : source.index("def _log_routing")
    ]
    # The sample is taken inside _propose_via_model, which both passes call,
    # and the orchestrator never loads rows itself.
    assert "load_source_rows" not in orchestrator
    assert "_sample_for_model" not in orchestrator


def test_the_sample_row_limit_is_enforced_in_one_place():
    source = Path("app/services/pipeline.py").read_text()
    assert source.count("rows[: settings.model_sample_rows]") == 1, (
        "the row limit must stay enforced at a single boundary"
    )


def test_the_threshold_is_interaction_not_presence():
    assert INTERACTION_THRESHOLD >= 2


def test_several_validation_concerns_escalate_on_their_own():
    """Two questionable mappings interact even without an acknowledged cast."""
    assert evaluate(concerning(acknowledged=0, advisories=2), SUPER, ULTRA).escalate


# --------------------------------------------------------------------------
# Deterministic sample advisories: the second concern
# --------------------------------------------------------------------------

import csv  # noqa: E402

from app.config import settings  # noqa: E402
from app.domain.sample_advisories import (  # noqa: E402
    MIXED_DECIMAL_REASON,
    decimal_format_advisories,
    with_sample_advisories,
)
from app.domain.types import Mapping, MigrationPlan, Operation  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def model_shaped_plan() -> MigrationPlan:
    """The plan shape Super proposes for a customers file.

    Built by hand so the test does not depend on a live model. The model path
    always leaves `date_format_policy` unset, which is why PARSE_DATE arrives
    needing acknowledgement.
    """
    return MigrationPlan(
        version=1,
        mappings=(
            Mapping("customer_id", "customer_id", Operation.PRESERVE_IDENTIFIER_AS_STRING),
            Mapping("full_name", "full_name", Operation.NORMALIZE_WHITESPACE),
            Mapping("email", "email", Operation.RENAME_FIELD),
            Mapping("signup_date", "signup_date", Operation.PARSE_DATE),
            Mapping("balance", "balance", Operation.CAST_TO_DECIMAL),
            Mapping("region", "region", Operation.NULL_HANDLING),
        ),
        proposed_by="nebius:test",
        key_column="customer_id",
        date_format_policy=None,
    )


def bounded_sample(name: str) -> list[dict]:
    """The fixture's rows, cut to the same bound the pipeline uses."""
    with open(FIXTURES / name, newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    return rows[: settings.model_sample_rows]


def routed(name: str) -> tuple[ValidationResult, RoutingDecision]:
    validation = with_sample_advisories(
        validate_plan(model_shaped_plan(), CUSTOMERS_V1, COLUMNS), bounded_sample(name)
    )
    return validation, evaluate(validation, SUPER, ULTRA)


def test_mixed_decimal_format_becomes_a_non_fatal_advisory():
    validation = validate_plan(model_shaped_plan(), CUSTOMERS_V1, COLUMNS)
    sample = [{"balance": "1,250.00"}, {"balance": "1250,00"}, {"balance": "980,40"}]
    issues = decimal_format_advisories(validation, sample)

    assert len(issues) == 1
    assert issues[0].source_column == "balance"
    assert issues[0].fatal is False


def test_consistent_decimal_format_is_not_flagged():
    validation = validate_plan(model_shaped_plan(), CUSTOMERS_V1, COLUMNS)
    for sample in (
        [{"balance": "1200.50"}, {"balance": "1,004.05"}, {"balance": "980.40"}],
        [{"balance": "1250,00"}, {"balance": "980,40"}],
        [{"balance": "1250"}, {"balance": "1,250"}, {"balance": ""}],
    ):
        assert decimal_format_advisories(validation, sample) == []


def test_only_decimal_casts_are_inspected():
    """A mixed-looking value under another operation is not this rule's business."""
    validation = validate_plan(model_shaped_plan(), CUSTOMERS_V1, COLUMNS)
    sample = [{"region": "1,250.00"}, {"region": "1250,00"}]
    assert decimal_format_advisories(validation, sample) == []


def test_the_advisory_never_makes_a_plan_fatal():
    validation = validate_plan(model_shaped_plan(), CUSTOMERS_V1, COLUMNS)
    enriched = with_sample_advisories(
        validation, [{"balance": "1,250.00"}, {"balance": "1250,00"}]
    )
    assert enriched.is_executable == validation.is_executable
    assert len(enriched.fatal_issues) == len(validation.fatal_issues)


def test_the_advisory_reason_carries_no_row_values():
    validation = validate_plan(model_shaped_plan(), CUSTOMERS_V1, COLUMNS)
    issues = decimal_format_advisories(
        validation, [{"balance": "1,250.00"}, {"balance": "1250,00"}]
    )
    assert issues[0].reason == MIXED_DECIMAL_REASON
    for value in ("1,250.00", "1250,00"):
        assert value not in issues[0].reason


def test_the_clean_fixture_stays_on_super():
    """One concern at most: the unset date policy. Balances are consistent."""
    validation, decision = routed("routine_migration.csv")
    assert not [i for i in validation.issues if not i.fatal]
    assert decision.escalate is False
    assert decision.selected_model == SUPER


def test_the_ambiguous_fixture_reaches_two_deterministic_concerns():
    validation, decision = routed("ambiguous_migration.csv")

    assert validation.is_executable, "the fixture must not produce fatal issues"
    acknowledged = [m.source_column for m in validation.plan.mappings if m.requires_acknowledgement]
    advisories = [i.source_column for i in validation.issues if not i.fatal]
    assert "signup_date" in acknowledged
    assert advisories == ["balance"]
    assert len(acknowledged) + len(advisories) >= 2


def test_two_concerns_select_ultra():
    _, decision = routed("ambiguous_migration.csv")
    assert decision.escalate is True
    assert decision.selected_model == ULTRA


def test_fatal_issues_still_do_not_count_toward_escalation():
    plan = model_shaped_plan()
    validation = ValidationResult(
        plan=validate_plan(plan, CUSTOMERS_V1, COLUMNS).plan,
        issues=[
            ValidationIssue("x", "fatal one", True),
            ValidationIssue("y", "fatal two", True),
            ValidationIssue("z", "fatal three", True),
        ],
    )
    # One acknowledged mapping (signup_date) plus three fatal issues is still
    # one concern.
    assert evaluate(validation, SUPER, ULTRA).escalate is False


def test_the_ambiguous_fixture_mixes_formats_inside_the_bound():
    """The mixed formats must be visible within MODEL_SAMPLE_ROWS, or the rule
    could only fire by reading more data than the bound allows."""
    balances = [row["balance"] for row in bounded_sample("ambiguous_migration.csv")]
    assert any("." in b for b in balances) and any(b.count(",") == 1 and "." not in b for b in balances)


def test_both_passes_receive_the_identical_sample():
    source = Path("app/services/pipeline.py").read_text()
    orchestrator = source[
        source.index("def _propose_with_routing") : source.index("def _log_routing")
    ]
    assert "sample=sample" in orchestrator, "the escalation pass must reuse the first sample"
    assert "_sample_for_model" not in orchestrator


def test_sample_advisories_load_nothing_themselves():
    """Checked on imports and calls, not prose: the docstring may name the
    sampler to explain where the bound lives, but the code must not reach it."""
    import ast

    tree = ast.parse(Path("app/domain/sample_advisories.py").read_text())
    imported = {
        node.module or ""
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
    } | {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    called = {
        node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
    }
    assert not any(m.startswith(("app.db", "app.nebius", "app.services", "psycopg")) for m in imported)
    assert not called & {"load_source_rows", "_sample_for_model", "complete_json"}


def test_routing_metadata_from_the_ambiguous_fixture_is_clean():
    _, decision = routed("ambiguous_migration.csv")
    recorded = str(decision.as_metadata())
    for row in bounded_sample("ambiguous_migration.csv"):
        for value in row.values():
            assert value not in recorded, f"row value {value!r} leaked into routing metadata"
    assert "api_key" not in recorded.lower() and "bearer" not in recorded.lower()
