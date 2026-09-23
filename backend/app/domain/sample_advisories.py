"""Deterministic advisories derived from the bounded planning sample.

Plan validation checks a proposal against the allowlist and the schema. It
cannot see the data. Some ambiguity only shows up in the values themselves: a
`balance` column whose sample contains both `1,250.00` and `1250,00` is being
written with two different decimal conventions, and a decimal cast will read
at least one of them wrongly without raising anything.

This module turns that observation into a non-fatal validation issue. It is
deliberately narrow:

* It reads only the rows already sampled for planning, which
  `pipeline._sample_for_model` bounds to `MODEL_SAMPLE_ROWS`. It never loads
  rows itself and never sees the full dataset.
* It fires only for a mapping that proposes `CAST_TO_DECIMAL`, and only when
  the sample shows both a dot-decimal and a comma-decimal value. A decimal
  column written consistently is not flagged.
* It trusts nothing the model wrote. The model's free-text `risk` string plays
  no part; the operation comes from the validated plan and the values come
  from the stored source rows.
* The advisory is never fatal. It informs a human and feeds routing. It cannot
  block approval, and it changes nothing about execution or verification.

The reason text names the pattern, never the values, so a routing record or a
validation payload built from it carries no row data.
"""

from __future__ import annotations

import re
from typing import Iterable, Mapping as TypingMapping

from app.domain.plan import ValidationIssue, ValidationResult
from app.domain.types import Operation

# 1200.50, 1,250.00, 1,004.05 -> a dot is the decimal separator.
DOT_DECIMAL = re.compile(r"^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d+$")

# 1250,00, 980,40, 1.250,00 -> a comma is the decimal separator. Limited to one
# or two fractional digits, because "1,250" is just as plausibly a thousands
# separator and is therefore not evidence either way.
COMMA_DECIMAL = re.compile(r"^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{1,2}$")

MIXED_DECIMAL_REASON = (
    "The sampled values use both a dot and a comma as the decimal separator, "
    "so the decimal and thousands separator interpretation is ambiguous. A "
    "decimal cast would read at least one convention wrongly without raising "
    "an error."
)


def _separator_style(value: object) -> str | None:
    """'dot', 'comma', or None when a value is not evidence either way."""
    if value is None:
        return None
    text = str(value).strip().strip('"').strip()
    if not text:
        return None
    if DOT_DECIMAL.match(text):
        return "dot"
    if COMMA_DECIMAL.match(text):
        return "comma"
    return None


def decimal_format_advisories(
    validation: ValidationResult,
    sample_rows: Iterable[TypingMapping[str, object]],
) -> list[ValidationIssue]:
    """Non-fatal issues for decimal casts whose sample mixes conventions."""
    rows = list(sample_rows)
    issues: list[ValidationIssue] = []

    for mapping in validation.plan.mappings:
        if mapping.operation is not Operation.CAST_TO_DECIMAL:
            continue
        styles = {
            style
            for row in rows
            if (style := _separator_style(row.get(mapping.source_column))) is not None
        }
        if styles == {"dot", "comma"}:
            issues.append(
                ValidationIssue(
                    source_column=mapping.source_column,
                    reason=MIXED_DECIMAL_REASON,
                    fatal=False,
                )
            )
    return issues


def with_sample_advisories(
    validation: ValidationResult,
    sample_rows: Iterable[TypingMapping[str, object]],
) -> ValidationResult:
    """The same validation, plus any advisories the bounded sample supports.

    Returns a new result rather than mutating the one it was given, and adds
    only non-fatal issues, so `is_executable` is unchanged by construction.
    """
    advisories = decimal_format_advisories(validation, sample_rows)
    if not advisories:
        return validation
    return ValidationResult(
        plan=validation.plan,
        issues=[*validation.issues, *advisories],
    )
