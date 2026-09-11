"""Canonicalisation rules, and parity between Python and Rust.

The rule tests run everywhere. The parity tests skip unless the Rust binary
has been built, and they are the reason two implementations are acceptable at
all: a hash that the two disagree about would be worse than having one.

    cd rust-verifier && cargo build --release
    cd backend && pytest tests/test_canonical.py -v
"""

from __future__ import annotations

import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.verify import rust_bridge  # noqa: E402
from app.verify.canonical import (  # noqa: E402
    canonical_row,
    canonical_value,
    dataset_hash,
    reconcile,
    row_hash,
)

rust_available = pytest.mark.skipif(
    not rust_bridge.is_available(),
    reason="the Rust verifier has not been built, run cargo build --release",
)


# --- the rules ----------------------------------------------------------


def test_leading_zeros_are_never_normalised_away():
    assert row_hash({"customer_id": "00127"}) != row_hash({"customer_id": "127"})


def test_an_integer_cast_changes_the_hash():
    assert row_hash({"customer_id": "00127"}) != row_hash({"customer_id": 127})


def test_trailing_zeros_on_a_decimal_do_not_change_the_hash():
    assert row_hash({"balance": Decimal("1200.50")}) == row_hash(
        {"balance": Decimal("1200.5")}
    )


def test_a_lost_fraction_of_a_cent_changes_the_hash():
    assert row_hash({"balance": Decimal("1200.50")}) != row_hash(
        {"balance": Decimal("1200.4999")}
    )


def test_combining_marks_normalise_to_the_precomposed_form():
    assert row_hash({"full_name": "Zoë"}) == row_hash({"full_name": "Zoe\u0308"})


def test_null_and_empty_are_different_facts():
    assert row_hash({"region": None}) != row_hash({"region": ""})


def test_field_order_does_not_affect_the_hash():
    assert row_hash({"a": "1", "b": "2"}) == row_hash({"b": "2", "a": "1"})


def test_dataset_hash_ignores_row_order():
    first, second = {"id": "1"}, {"id": "2"}
    assert dataset_hash([first, second]) == dataset_hash([second, first])


def test_a_float_is_refused_rather_than_rounded():
    with pytest.raises(TypeError):
        canonical_value(1200.5)


def test_dates_render_as_iso():
    assert canonical_value(date(2024, 4, 3)) == "2024-04-03"


def test_canonical_row_restricts_to_the_named_fields():
    row = {"a": "1", "b": "2", "c": "3"}
    rendered = canonical_row(row, ["a", "c"])
    assert "b" not in rendered
    assert rendered.startswith("a")


# --- reconciliation -----------------------------------------------------


def test_reconcile_reports_a_damaged_identifier():
    result = reconcile(
        {"1": {"customer_id": "00127"}},
        {"1": {"customer_id": 127}},
        ["customer_id"],
    )
    assert result["matched"] == 0
    assert result["differing"][0]["fields"][0]["source"] == "00127"
    assert result["differing"][0]["fields"][0]["destination"] == "127"


def test_reconcile_reports_missing_and_unexpected():
    result = reconcile({"a": {"id": "a"}}, {"b": {"id": "b"}}, ["id"])
    assert result["missing"] == ["a"]
    assert result["unexpected"] == ["b"]


def test_reconcile_matches_an_identical_dataset():
    rows = {"1": {"id": "00127", "balance": Decimal("10.00")}}
    result = reconcile(rows, dict(rows), ["id", "balance"])
    assert result["matched"] == 1
    assert result["source_dataset_hash"] == result["destination_dataset_hash"]


# --- parity with Rust ---------------------------------------------------

PARITY_ROWS = [
    {"customer_id": "00127", "full_name": "Amara Chen", "balance": Decimal("1200.50")},
    {"customer_id": "127", "full_name": "Amara Chen", "balance": Decimal("1200.5")},
    {"customer_id": "00128", "full_name": "Zoë Ödegård", "balance": Decimal("0.10")},
    {"customer_id": "00129", "full_name": "Zoe\u0308 O\u0308degård", "balance": Decimal("0")},
    {"customer_id": "00130", "full_name": "", "region": None},
    {"customer_id": "00131", "signup_date": date(2024, 4, 3), "balance": Decimal("1200.4999")},
    {"customer_id": "00132", "full_name": "A" * 300, "balance": Decimal("99999999.99")},
    {"customer_id": "00133", "full_name": "=SUM(A1:A9)", "balance": Decimal("-5.25")},
]


@rust_available
@pytest.mark.parametrize("row", PARITY_ROWS)
def test_row_hash_matches_rust(row):
    assert rust_bridge.hash_row(row)["hash"] == row_hash(row)


@rust_available
@pytest.mark.parametrize("row", PARITY_ROWS)
def test_canonical_string_matches_rust(row):
    assert rust_bridge.hash_row(row)["canonical"] == canonical_row(row)


@rust_available
def test_dataset_hash_matches_rust():
    assert rust_bridge.dataset_hash(PARITY_ROWS) == dataset_hash(PARITY_ROWS)


@rust_available
def test_reconciliation_matches_rust():
    source = {str(i): row for i, row in enumerate(PARITY_ROWS)}
    destination = dict(source)
    destination["0"] = {**PARITY_ROWS[0], "customer_id": 127}
    fields = ["customer_id", "full_name", "balance"]

    from_rust = rust_bridge.reconcile(source, destination, fields)
    from_python = reconcile(source, destination, fields)

    assert from_rust["matched"] == from_python["matched"]
    assert from_rust["missing"] == from_python["missing"]
    assert from_rust["unexpected"] == from_python["unexpected"]
    assert len(from_rust["differing"]) == len(from_python["differing"])
    assert from_rust["source_dataset_hash"] == from_python["source_dataset_hash"]


@rust_available
def test_the_two_implementations_agree_on_the_canonical_version():
    assert rust_bridge.version()["canonical_version"] == "moveproof.canonical.v1"


def test_the_bridge_reports_unavailability_rather_than_guessing():
    """A missing binary is never treated as a passing check."""
    if rust_bridge.is_available():
        pytest.skip("the binary is built, so this path cannot be exercised here")
    with pytest.raises(rust_bridge.RustVerifierUnavailable):
        rust_bridge.hash_row({"a": "1"})


# --- regression: reconciliation must compare like with like -------------


def test_reconciliation_compares_text_against_text():
    """A correct migration must reconcile.

    The verifier renders both sides as text before hashing. Comparing a typed
    staged value against the source text it was derived from reported a
    difference on a correct migration: Decimal("1200.50") canonicalises to
    "1200.5" while the source text canonicalises to "1200.50".
    """
    fields = ["customer_id", "full_name", "email"]
    source = {
        "1:00127": {
            "customer_id": "00127",
            "full_name": "Amara Chen",
            "email": "amara@example.com",
        }
    }
    staged = {"1:00127": dict(source["1:00127"])}

    result = reconcile(source, staged, fields)
    assert result["matched"] == 1
    assert result["differing"] == []


def test_reconciliation_still_catches_an_integer_cast():
    """The fix must not blunt the check it exists for."""
    fields = ["customer_id"]
    source = {"1:00127": {"customer_id": "00127"}}
    staged = {"1:00127": {"customer_id": "127"}}

    result = reconcile(source, staged, fields)
    assert result["matched"] == 0
    difference = result["differing"][0]["fields"][0]
    assert difference["source"] == "00127"
    assert difference["destination"] == "127"


def test_a_typed_decimal_against_source_text_is_the_false_failure():
    """Documents why decimal columns are not reconciliation fields.

    They are covered by decimal_precision, which compares Decimal to Decimal.
    """
    from decimal import Decimal as D

    result = reconcile(
        {"1": {"balance": "1200.50"}}, {"1": {"balance": D("1200.50")}}, ["balance"]
    )
    assert len(result["differing"]) == 1, (
        "this comparison is meaningless, which is why the contract excludes it"
    )


def test_contract_reconciliation_fields_are_identity_preserving():
    from app.domain.contract import CUSTOMERS_CONTRACT_V1
    from app.domain.schema import CUSTOMERS_V1

    for name in CUSTOMERS_CONTRACT_V1.reconciliation_fields:
        column = CUSTOMERS_V1.column(name)
        assert column is not None
        assert column.numeric_precision is None, (
            f"{name} is a numeric column and cannot be reconciled against source text"
        )
        assert column.data_type != "DATE", (
            f"{name} is a date column and cannot be reconciled against source text"
        )
