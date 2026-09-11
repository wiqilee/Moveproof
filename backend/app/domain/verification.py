"""The independent verifier.

This module imports nothing from the planner and nothing from any model
client. It receives the original source rows and the staged result, and it
reports what it finds by comparing them.

It does not know what the plan intended. That is the point: a checker that
shares the planner's assumptions will share the planner's blind spots.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.domain.types import (
    Check,
    CheckStatus,
    DestinationSchema,
    Evidence,
    ExecutionResult,
    RowDisposition,
    SourceRow,
)

MAX_EVIDENCE_PER_CHECK = 25


def verify(
    source_rows: list[SourceRow],
    result: ExecutionResult,
    schema: DestinationSchema,
    key_column: str,
    destination_key_column: str,
    date_columns: tuple[str, ...] = (),
    unverified_properties: tuple[tuple[str, str, str], ...] = (),
    reconciliation_fields: tuple[str, ...] = (),
) -> list[Check]:
    """Run every check and return the results.

    `unverified_properties` carries checks the contract deliberately does not
    cover, as (id, name, reason). They are reported as NOT_VERIFIED so an
    unchecked property can never be mistaken for a passing one.
    """
    by_row = {row.row_number: row for row in source_rows}
    checks: list[Check] = [
        _row_accounting(result),
        _identifier_preservation(by_row, result, key_column, destination_key_column),
        _duplicate_accounting(result),
        _required_fields(result, schema),
        _uniqueness(result, destination_key_column),
        _decimal_precision(by_row, result, schema),
        _date_parsing(by_row, result, date_columns),
        _transform_rejections(result),
        _canonical_reconciliation(
            by_row, result, key_column, destination_key_column, reconciliation_fields
        ),
    ]

    for check_id, name, reason in unverified_properties:
        checks.append(
            Check(
                check_id=check_id,
                name=name,
                expected="Defined outside this verification contract",
                observed=reason,
                status=CheckStatus.NOT_VERIFIED,
            )
        )
    return checks


def _row_accounting(result: ExecutionResult) -> Check:
    acc = result.accounting
    disposed = len(result.staged)
    expected = (
        f"Every source row has exactly one disposition. "
        f"{acc.source_rows} rows in, {acc.source_rows} rows accounted for."
    )
    observed = "; ".join(acc.as_arithmetic())

    if disposed != acc.source_rows:
        return Check(
            check_id="row_accounting",
            name="Source and staging row accounting",
            expected=expected,
            observed=(
                f"{acc.source_rows} source rows produced {disposed} dispositions. "
                "Some rows are unaccounted for."
            ),
            status=CheckStatus.FAILED,
        )
    return Check(
        check_id="row_accounting",
        name="Source and staging row accounting",
        expected=expected,
        observed=observed,
        status=CheckStatus.PASSED,
    )


def _identifier_preservation(
    by_row: dict[int, SourceRow],
    result: ExecutionResult,
    key_column: str,
    destination_key_column: str,
) -> Check:
    """Compare the destination identifier against the source, as strings.

    String comparison is deliberate. 00127 and 127 are equal as integers and
    different as identifiers, and the identifier is what matters.
    """
    evidence: list[Evidence] = []
    # The evidence list is capped so a report stays readable. The count is not:
    # under-reporting how many rows were damaged would be the same class of
    # quiet failure this verifier exists to expose.
    mismatched = 0

    for staged in result.staged:
        if staged.disposition is RowDisposition.DUPLICATE_EXCLUDED:
            continue
        source = by_row.get(staged.row_number)
        if source is None:
            continue
        expected_value = source.get(key_column)
        actual = staged.values.get(destination_key_column)
        actual_text = "" if actual is None else str(actual)
        if actual_text != expected_value:
            mismatched += 1
            if len(evidence) < MAX_EVIDENCE_PER_CHECK:
                evidence.append(
                    Evidence(
                        row_key=expected_value,
                        field_name=destination_key_column,
                        source_value=expected_value,
                        destination_value=actual_text or "not written",
                    )
                )

    if mismatched:
        first = evidence[0]
        sampled = (
            f" Showing the first {len(evidence)}."
            if mismatched > len(evidence)
            else ""
        )
        return Check(
            check_id="identifier_preservation",
            name="Unique identifier preservation",
            expected=f"{destination_key_column} matches the source value exactly, as a string",
            observed=(
                f"{mismatched} row(s) differ. "
                f"{first.source_value} became {first.destination_value}.{sampled}"
            ),
            status=CheckStatus.FAILED,
            evidence=evidence,
        )
    return Check(
        check_id="identifier_preservation",
        name="Unique identifier preservation",
        expected=f"{destination_key_column} matches the source value exactly, as a string",
        observed="Every staged identifier matches its source value character for character",
        status=CheckStatus.PASSED,
    )


def _duplicate_accounting(result: ExecutionResult) -> Check:
    excluded = [
        row for row in result.staged if row.disposition is RowDisposition.DUPLICATE_EXCLUDED
    ]
    conflicts = [
        row for row in result.staged if row.disposition is RowDisposition.CONFLICT_UNRESOLVED
    ]

    if conflicts:
        evidence = [
            Evidence(
                row_key=row.source_key,
                field_name="(whole row)",
                source_value=f"row {row.row_number}",
                destination_value="not written, conflict",
            )
            for row in conflicts[:MAX_EVIDENCE_PER_CHECK]
        ]
        return Check(
            check_id="duplicate_detection",
            name="Duplicate and conflict handling",
            expected="Only rows identical in every field are removed by the keep first policy",
            observed=(
                f"{len(conflicts)} row(s) share an identifier but differ in content. "
                "These need an explicit decision and were not written."
            ),
            status=CheckStatus.REVIEW,
            evidence=evidence,
        )

    return Check(
        check_id="duplicate_detection",
        name="Duplicate and conflict handling",
        expected="Only rows identical in every field are removed by the keep first policy",
        observed=(
            f"{len(excluded)} exact duplicate row(s) excluded. "
            "No conflicting duplicate keys found."
        ),
        status=CheckStatus.PASSED,
    )


def _required_fields(result: ExecutionResult, schema: DestinationSchema) -> Check:
    """A NOT NULL column must hold a value in every committable row."""
    held_back = [
        row
        for row in result.staged
        if row.disposition
        in (RowDisposition.QUARANTINED, RowDisposition.POLICY_EXCLUDED)
    ]
    violations: list[Evidence] = []
    violation_count = 0

    for staged in result.staged:
        if not staged.is_committable:
            continue
        for name in schema.required_columns:
            value = staged.values.get(name)
            if value is None or (isinstance(value, str) and value.strip() == ""):
                violation_count += 1
                if len(violations) < MAX_EVIDENCE_PER_CHECK:
                    violations.append(
                        Evidence(
                            row_key=staged.source_key,
                            field_name=name,
                            source_value="(empty)",
                            destination_value="would violate NOT NULL",
                        )
                    )

    expected = "Every required column holds a value in every committable row"

    if violation_count:
        return Check(
            check_id="required_field_validation",
            name="Required field validation",
            expected=expected,
            observed=(
                f"{violation_count} committable row(s) would violate a NOT NULL "
                "constraint. These must be corrected, quarantined or excluded."
            ),
            status=CheckStatus.FAILED,
            evidence=violations,
        )

    if held_back:
        evidence = [
            Evidence(
                row_key=row.source_key,
                field_name="(row)",
                source_value="incomplete in source",
                destination_value=row.disposition.value,
            )
            for row in held_back[:MAX_EVIDENCE_PER_CHECK]
        ]
        return Check(
            check_id="required_field_validation",
            name="Required field validation",
            expected=expected,
            observed=(
                f"{len(held_back)} row(s) were held out of the commit for a missing "
                "required value. The constraint holds for every committable row."
            ),
            status=CheckStatus.REVIEW,
            evidence=evidence,
        )

    return Check(
        check_id="required_field_validation",
        name="Required field validation",
        expected=expected,
        observed="No committable row is missing a required value",
        status=CheckStatus.PASSED,
    )


def _uniqueness(result: ExecutionResult, destination_key_column: str) -> Check:
    seen: dict[str, int] = {}
    duplicates: list[Evidence] = []
    duplicate_count = 0

    for staged in result.staged:
        if not staged.is_committable:
            continue
        value = staged.values.get(destination_key_column)
        text = "" if value is None else str(value)
        if text in seen:
            duplicate_count += 1
            if len(duplicates) < MAX_EVIDENCE_PER_CHECK:
                duplicates.append(
                    Evidence(
                        row_key=text,
                        field_name=destination_key_column,
                        source_value=f"row {seen[text]}",
                        destination_value=f"row {staged.row_number}",
                    )
                )
        else:
            seen[text] = staged.row_number

    if duplicate_count:
        return Check(
            check_id="uniqueness",
            name="Unique constraint on the identifier",
            expected=f"{destination_key_column} is unique across committable rows",
            observed=f"{duplicate_count} duplicate value(s) would violate the constraint",
            status=CheckStatus.FAILED,
            evidence=duplicates,
        )
    return Check(
        check_id="uniqueness",
        name="Unique constraint on the identifier",
        expected=f"{destination_key_column} is unique across committable rows",
        observed=f"{len(seen)} committable rows, all identifiers distinct",
        status=CheckStatus.PASSED,
    )


def _decimal_precision(
    by_row: dict[int, SourceRow],
    result: ExecutionResult,
    schema: DestinationSchema,
) -> Check:
    """Compare each staged decimal against the exact source value."""
    decimal_columns = [c for c in schema.columns if c.numeric_precision is not None]
    if not decimal_columns:
        return Check(
            check_id="decimal_precision",
            name="Decimal precision preservation",
            expected="Exact decimal values are preserved",
            observed="The destination schema declares no decimal columns",
            status=CheckStatus.NOT_VERIFIED,
        )

    drifted: list[Evidence] = []
    drift_count = 0
    compared = 0

    for staged in result.staged:
        if not staged.is_committable:
            continue
        source = by_row.get(staged.row_number)
        if source is None:
            continue
        for column in decimal_columns:
            actual = staged.values.get(column.name)
            if not isinstance(actual, Decimal):
                continue
            raw = source.values.get(column.name)
            if raw is None or raw.strip() == "":
                continue
            try:
                expected_value = Decimal(raw.strip())
            except Exception:
                continue
            compared += 1
            if expected_value != actual:
                drift_count += 1
                if len(drifted) < MAX_EVIDENCE_PER_CHECK:
                    drifted.append(
                        Evidence(
                            row_key=staged.source_key,
                            field_name=column.name,
                            source_value=str(expected_value),
                            destination_value=str(actual),
                        )
                    )

    if drift_count:
        return Check(
            check_id="decimal_precision",
            name="Decimal precision preservation",
            expected="Every staged decimal equals its source value exactly",
            observed=f"{drift_count} value(s) changed during transformation",
            status=CheckStatus.FAILED,
            evidence=drifted,
        )
    return Check(
        check_id="decimal_precision",
        name="Decimal precision preservation",
        expected="Every staged decimal equals its source value exactly",
        observed=f"{compared} decimal value(s) compared, all exact",
        status=CheckStatus.PASSED,
    )


def _date_parsing(
    by_row: dict[int, SourceRow],
    result: ExecutionResult,
    date_columns: tuple[str, ...],
) -> Check:
    """Report dates that could not be parsed, and dates that are ambiguous.

    A value such as 03/04/2024 reads correctly two ways. The verifier reports
    it as review required rather than accepting whichever reading happened to
    be applied.
    """
    if not date_columns:
        return Check(
            check_id="date_parsing",
            name="Date parsing and format confirmation",
            expected="Every date parses under one approved format policy",
            observed="No date columns are covered by this contract",
            status=CheckStatus.NOT_VERIFIED,
        )

    ambiguous: list[Evidence] = []
    ambiguous_count = 0
    parsed = 0

    for staged in result.staged:
        if not staged.is_committable:
            continue
        source = by_row.get(staged.row_number)
        if source is None:
            continue
        for column in date_columns:
            value = staged.values.get(column)
            if not isinstance(value, date):
                continue
            parsed += 1
            raw = source.values.get(column, "")
            if not _is_ambiguous(raw):
                continue
            ambiguous_count += 1
            if len(ambiguous) < MAX_EVIDENCE_PER_CHECK:
                ambiguous.append(
                    Evidence(
                        row_key=staged.source_key,
                        field_name=column,
                        source_value=raw,
                        destination_value=value.isoformat(),
                    )
                )

    if ambiguous_count:
        return Check(
            check_id="date_parsing",
            name="Date parsing and format confirmation",
            expected="Every date has one unambiguous reading under the approved policy",
            observed=(
                f"{ambiguous_count} value(s) read correctly as either day first or "
                "month first. The applied policy is a choice, not a fact."
            ),
            status=CheckStatus.REVIEW,
            evidence=ambiguous,
        )
    return Check(
        check_id="date_parsing",
        name="Date parsing and format confirmation",
        expected="Every date has one unambiguous reading under the approved policy",
        observed=f"{parsed} date(s) parsed, none ambiguous",
        status=CheckStatus.PASSED,
    )


def _is_ambiguous(raw: str) -> bool:
    """True when both day first and month first give a real calendar date."""
    parts = raw.replace("-", "/").split("/")
    if len(parts) != 3 or len(parts[0]) == 4:
        return False
    try:
        first, second = int(parts[0]), int(parts[1])
    except ValueError:
        return False
    return 1 <= first <= 12 and 1 <= second <= 12 and first != second


def _transform_rejections(result: ExecutionResult) -> Check:
    if not result.errors:
        return Check(
            check_id="transform_rejections",
            name="Transformation rejections",
            expected="Every source row transforms without error, or is reported",
            observed="No row was rejected during transformation",
            status=CheckStatus.PASSED,
        )

    evidence = [
        Evidence(
            row_key=error.source_key,
            field_name=error.field_name,
            source_value=error.source_value,
            destination_value=error.reason,
        )
        for error in result.errors[:MAX_EVIDENCE_PER_CHECK]
    ]
    return Check(
        check_id="transform_rejections",
        name="Transformation rejections",
        expected="Every source row transforms without error, or is reported",
        observed=f"{len(result.errors)} row(s) could not be transformed and were rejected",
        status=CheckStatus.REVIEW,
        evidence=evidence,
    )


def _canonical_reconciliation(
    by_row: dict[int, SourceRow],
    result: ExecutionResult,
    key_column: str,
    destination_key_column: str,
    fields: tuple[str, ...],
) -> Check:
    """Whole row reconciliation by canonical hash.

    Every other check looks at one property. This one collapses each row to a
    canonical string and compares hashes, so it catches damage nobody wrote a
    rule for.

    The work is done by the Rust verifier. When that binary is not built the
    check reports NOT_VERIFIED with the reason, never PASSED: a reconciliation
    that did not run has not reconciled anything.
    """
    from app.verify import rust_bridge

    if not fields:
        return Check(
            check_id="canonical_reconciliation",
            name="Canonical row reconciliation",
            expected="Identity preserving columns hash to their source values",
            observed="No reconciliation fields are configured for this contract",
            status=CheckStatus.NOT_VERIFIED,
        )

    if not rust_bridge.is_available():
        return Check(
            check_id="canonical_reconciliation",
            name="Canonical row reconciliation",
            expected="Identity preserving columns hash to their source values",
            observed=(
                "The Rust verifier is not built, so this property was not checked. "
                "Run `cargo build --release` in rust-verifier to enable it."
            ),
            status=CheckStatus.NOT_VERIFIED,
        )

    source: dict[str, dict[str, object]] = {}
    destination: dict[str, dict[str, object]] = {}

    for staged in result.staged:
        if staged.disposition is RowDisposition.DUPLICATE_EXCLUDED:
            continue
        origin = by_row.get(staged.row_number)
        if origin is None:
            continue
        key = f"{staged.row_number}:{origin.get(key_column)}"
        # Both sides are rendered as text. The source arrives as text and the
        # staged value may be typed, so comparing them under type aware
        # canonicalisation would report a difference where none exists. An
        # integer cast still shows up, because 127 renders as "127" and the
        # source renders as "00127".
        source[key] = {name: origin.get(name) or "" for name in fields}
        destination[key] = {
            name: "" if staged.values.get(name) is None else str(staged.values.get(name))
            for name in fields
        }

    try:
        report = rust_bridge.reconcile(source, destination, list(fields))
    except (rust_bridge.RustVerifierUnavailable, rust_bridge.RustVerifierFailed) as exc:
        return Check(
            check_id="canonical_reconciliation",
            name="Canonical row reconciliation",
            expected="Identity preserving columns hash to their source values",
            observed=f"The Rust verifier could not complete: {exc}",
            status=CheckStatus.NOT_VERIFIED,
        )

    differing = report.get("differing", [])
    missing = report.get("missing", [])
    unexpected = report.get("unexpected", [])

    if differing or missing or unexpected:
        evidence: list[Evidence] = []
        for entry in differing[:MAX_EVIDENCE_PER_CHECK]:
            for field in entry.get("fields", [])[:3]:
                evidence.append(
                    Evidence(
                        row_key=entry["key"].split(":", 1)[-1],
                        field_name=field["field"],
                        source_value=field["source"],
                        destination_value=field["destination"],
                    )
                )
        return Check(
            check_id="canonical_reconciliation",
            name="Canonical row reconciliation",
            expected="Identity preserving columns hash to their source values",
            observed=(
                f"{len(differing)} row(s) differ, {len(missing)} missing, "
                f"{len(unexpected)} unexpected. Source dataset hash "
                f"{report['source_dataset_hash'][7:19]}, destination "
                f"{report['destination_dataset_hash'][7:19]}."
            ),
            status=CheckStatus.FAILED,
            evidence=evidence,
        )

    return Check(
        check_id="canonical_reconciliation",
        name="Canonical row reconciliation",
        expected="Identity preserving columns hash to their source values",
        observed=(
            f"{report['matched']} row(s) reconciled. Dataset hash "
            f"{report['source_dataset_hash'][7:19]} on both sides."
        ),
        status=CheckStatus.PASSED,
    )


def summarize(checks: list[Check]) -> dict[str, int]:
    return {
        "passed": sum(1 for c in checks if c.status is CheckStatus.PASSED),
        "failed": sum(1 for c in checks if c.status is CheckStatus.FAILED),
        "review": sum(1 for c in checks if c.status is CheckStatus.REVIEW),
        "not_verified": sum(1 for c in checks if c.status is CheckStatus.NOT_VERIFIED),
        "total": len(checks),
    }


def can_commit(checks: list[Check]) -> bool:
    """Commit is permitted only when nothing mandatory is outstanding."""
    summary = summarize(checks)
    return summary["failed"] == 0 and summary["review"] == 0
