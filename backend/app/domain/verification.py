"""The independent verifier.

This module imports nothing from the planner and nothing from any model
client. It receives the original source rows and the staged result, and it
reports what it finds by comparing them.

It does not know what the plan intended. That is the point: a checker that
shares the planner's assumptions will share the planner's blind spots.
"""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal, InvalidOperation

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
    identity_columns: tuple[str, ...] = (),
    reconciliation_fields: tuple[str, ...] = (),
    #: Decisions a human approved, read from the approved plan rather than
    #: from anything a browser sent. The verifier needs them to recompute what
    #: the staged values must be; it never uses them to transform anything.
    date_format_policy: str | None = None,
    decimal_conventions: dict[str, str] | None = None,
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
        _uniqueness(result, destination_key_column, identity_columns),
        _decimal_precision(by_row, result, schema, decimal_conventions),
        _date_parsing(by_row, result, date_columns, date_format_policy),
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


def source_rows_by_destination(
    rows: list[SourceRow], column_sources: dict[str, str] | None
) -> list[SourceRow]:
    """Source rows readable under destination column names.

    Every check compares a staged destination column with the source value it
    came from, and looks that value up by the destination name. A file that
    names a column differently (RobotID for robot_id) would otherwise be
    compared against an empty string and reported as changed. Each renamed
    destination column is therefore read from the source column the approved
    plan actually mapped into it.

    Columns whose names already match are left exactly as they were, so a
    file that uses the destination names, which is every fixture and every
    earlier migration, is verified identically. The original values are kept
    alongside, never removed.
    """
    renamed = {
        destination: source
        for destination, source in (column_sources or {}).items()
        if destination != source
    }
    if not renamed:
        return rows
    return [
        SourceRow(
            row_number=row.row_number,
            values={
                **row.values,
                **{
                    destination: row.values.get(source, "")
                    for destination, source in renamed.items()
                },
            },
        )
        for row in rows
    ]


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


def _uniqueness(
    result: ExecutionResult,
    destination_key_column: str,
    identity_columns: tuple[str, ...] = (),
) -> Check:
    """Are the committable rows distinct in the destination?

    Distinctness is decided by the destination's own identity. A robot has one
    calibration row per joint, so (robot_id, joint_name) is what must be
    unique; checking robot_id alone would report three joints of the same
    robot as duplicates and block a correct migration.

    Falling back to the key column preserves the customer behaviour, where the
    identifier is unique on its own.
    """
    columns = identity_columns or (destination_key_column,)
    label = ", ".join(columns)
    seen: dict[str, int] = {}
    duplicates: list[Evidence] = []
    duplicate_count = 0

    for staged in result.staged:
        if not staged.is_committable:
            continue
        text = "\u001f".join(
            "" if staged.values.get(column) is None else str(staged.values.get(column))
            for column in columns
        )
        if text in seen:
            duplicate_count += 1
            if len(duplicates) < MAX_EVIDENCE_PER_CHECK:
                duplicates.append(
                    Evidence(
                        row_key=text.replace("\u001f", " + "),
                        field_name=label,
                        source_value=f"row {seen[text]}",
                        destination_value=f"row {staged.row_number}",
                    )
                )
        else:
            seen[text] = staged.row_number

    if duplicate_count:
        return Check(
            check_id="uniqueness",
            name="Unique constraint on the destination identity",
            expected=f"({label}) is unique across committable rows",
            observed=f"{duplicate_count} duplicate value(s) would violate the constraint",
            status=CheckStatus.FAILED,
            evidence=duplicates,
        )
    return Check(
        check_id="uniqueness",
        name="Unique constraint on the destination identity",
        expected=f"({label}) is unique across committable rows",
        observed=f"{len(seen)} committable rows, all distinct on ({label})",
        status=CheckStatus.PASSED,
    )


def _decimal_precision(
    by_row: dict[int, SourceRow],
    result: ExecutionResult,
    schema: DestinationSchema,
    decimal_conventions: dict[str, str] | None = None,
) -> Check:
    """Compare each staged decimal against the exact source value.

    A source column may hold values Decimal cannot read directly, such as
    1,250.00 beside 1250,00. Skipping those and reporting a pass would be the
    worst outcome available: a green check computed from nothing. The approved
    per-column convention is applied here independently, and any value that
    still has no determined reading is reported rather than dropped.
    """
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
    unreadable: list[Evidence] = []
    drift_count = 0
    unreadable_count = 0
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
            convention = (decimal_conventions or {}).get(column.name)
            expected_value = _expected_decimal(raw, convention)
            if expected_value is None:
                # Counted, never silently skipped: a value nobody could verify
                # is not a value that passed.
                unreadable_count += 1
                if len(unreadable) < MAX_EVIDENCE_PER_CHECK:
                    unreadable.append(
                        Evidence(
                            row_key=staged.source_key,
                            field_name=column.name,
                            source_value=raw,
                            destination_value=str(actual),
                        )
                    )
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
    if unreadable_count:
        return Check(
            check_id="decimal_precision",
            name="Decimal precision preservation",
            expected="Every staged decimal is independently recomputed from its source",
            observed=(
                f"{compared} value(s) compared and exact, but {unreadable_count} "
                "source value(s) have no approved reading, so they were not verified"
            ),
            status=CheckStatus.REVIEW,
            evidence=unreadable,
        )

    return Check(
        check_id="decimal_precision",
        name="Decimal precision preservation",
        expected="Every staged decimal equals its source value exactly",
        observed=f"{compared} decimal value(s) compared, all exact",
        status=CheckStatus.PASSED if compared else CheckStatus.NOT_VERIFIED,
    )


#: Verifier-side readers.
#:
#: These deliberately duplicate what the executor does rather than importing
#: it. A verifier that calls the transformer it is checking proves only that
#: the code is self-consistent. Two independent implementations disagreeing is
#: the signal worth having, so these are written from the approved policy
#: rather than shared with app.execute.
_V_DOT_DECIMAL = re.compile(r"^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d+$")
_V_COMMA_DECIMAL = re.compile(r"^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{1,2}$")
_V_PLAIN = re.compile(r"^[+-]?\d+$")
_V_SLASH_DATE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")
_V_ISO_DATE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")


def _expected_date(raw: str, policy: str | None) -> date | None:
    """The date the approved policy says this source value must become.

    Returns None when no reading is determined, which the caller treats as
    review rather than as agreement.
    """
    text = raw.strip()

    iso = _V_ISO_DATE.match(text)
    if iso:
        year, month, day = (int(part) for part in iso.groups())
        try:
            return date(year, month, day)
        except ValueError:
            return None

    slash = _V_SLASH_DATE.match(text)
    if not slash or policy is None:
        return None

    first, second, year = (int(part) for part in slash.groups())
    if policy == "day_first":
        day, month = first, second
    elif policy == "month_first":
        month, day = first, second
    else:
        return None
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _expected_decimal(raw: str, convention: str | None) -> Decimal | None:
    """The decimal the approved convention says this source value must become.

    Returns None when the value is not readable under the approved rule, which
    the caller counts as unverifiable rather than as a pass.
    """
    text = raw.strip()

    if _V_PLAIN.match(text):
        return Decimal(text)

    dot = bool(_V_DOT_DECIMAL.match(text))
    comma = bool(_V_COMMA_DECIMAL.match(text))

    if convention is None:
        # No approved reading: only a form Decimal accepts outright counts.
        try:
            return Decimal(text)
        except InvalidOperation:
            return None

    if convention == "dot_decimal" and dot:
        return Decimal(text.replace(",", ""))
    if convention == "comma_decimal" and comma:
        return Decimal(text.replace(".", "").replace(",", "."))
    if convention == "strict_either":
        if dot and not comma:
            return Decimal(text.replace(",", ""))
        if comma and not dot:
            return Decimal(text.replace(".", "").replace(",", "."))
    return None


def _date_parsing(
    by_row: dict[int, SourceRow],
    result: ExecutionResult,
    date_columns: tuple[str, ...],
    date_format_policy: str | None = None,
) -> Check:
    """Prove the approved date reading was the one applied.

    An ambiguous value such as 03/04/2026 reads two ways, and merely noticing
    that is not verification. Once a human has approved day first or month
    first, this check independently recomputes what the staged value must be
    under that approval and compares it. Disagreement is a failure.

    With no approved policy an ambiguous value has no determined reading, so
    it is reported as review required and the commit gate holds.
    """
    if not date_columns:
        return Check(
            check_id="date_parsing",
            name="Date parsing and format confirmation",
            expected="Every date parses under one approved format policy",
            observed="No date columns are covered by this contract",
            status=CheckStatus.NOT_VERIFIED,
        )

    mismatched: list[Evidence] = []
    undetermined: list[Evidence] = []
    mismatch_count = 0
    undetermined_count = 0
    compared = 0

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
            raw = source.values.get(column, "")
            expected_date = _expected_date(raw, date_format_policy)

            if expected_date is None:
                undetermined_count += 1
                if len(undetermined) < MAX_EVIDENCE_PER_CHECK:
                    undetermined.append(
                        Evidence(
                            row_key=staged.source_key,
                            field_name=column,
                            source_value=raw,
                            destination_value=str(value),
                        )
                    )
                continue

            compared += 1
            if expected_date != value:
                mismatch_count += 1
                if len(mismatched) < MAX_EVIDENCE_PER_CHECK:
                    mismatched.append(
                        Evidence(
                            row_key=staged.source_key,
                            field_name=column,
                            source_value=f"{raw} read as {date_format_policy}",
                            destination_value=str(value),
                        )
                    )

    policy_label = date_format_policy or "no approved policy"

    if mismatch_count:
        return Check(
            check_id="date_parsing",
            name="Date parsing and format confirmation",
            expected=f"Every staged date matches the approved {policy_label} reading",
            observed=(
                f"{mismatch_count} staged date(s) do not match the approved "
                f"{policy_label} reading of the source value"
            ),
            status=CheckStatus.FAILED,
            evidence=mismatched,
        )

    if undetermined_count:
        return Check(
            check_id="date_parsing",
            name="Date parsing and format confirmation",
            expected="Every date has one approved reading",
            observed=(
                f"{undetermined_count} source date(s) have no determined reading "
                f"under {policy_label}, so the staged value was not confirmed"
            ),
            status=CheckStatus.REVIEW,
            evidence=undetermined,
        )

    return Check(
        check_id="date_parsing",
        name="Date parsing and format confirmation",
        expected=f"Every staged date matches the approved {policy_label} reading",
        observed=(
            f"{compared} staged date(s) independently recomputed from the source "
            f"under {policy_label} and matched"
        ),
        status=CheckStatus.PASSED if compared else CheckStatus.NOT_VERIFIED,
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
