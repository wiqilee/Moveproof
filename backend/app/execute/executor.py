"""Plan execution.

The executor applies exactly the operations named in an approved plan. It has
no fallback behaviour, no repair logic and no opinion about whether a plan is
wise. If an approved plan says cast the identifier to an integer, it casts the
identifier to an integer and the verifier reports the consequence.

That is what makes the leading-zero demonstration honest: the failure is
produced by a real transformation the operator approved, not by a hardcoded
result.
"""

from __future__ import annotations

import re

from datetime import date
from decimal import Decimal, InvalidOperation

from app.domain.types import (
    DateFormatPolicy,
    MappingStatus,
    DestinationSchema,
    DuplicatePolicy,
    ExecutionResult,
    Mapping,
    MigrationPlan,
    Operation,
    RequiredFieldPolicy,
    RowAccounting,
    RowDisposition,
    SourceRow,
    StagedRow,
    TransformError,
)


class ExecutionRefused(Exception):
    """Raised when execution is asked to run something it must not run."""


def execute_plan(
    plan: MigrationPlan,
    schema: DestinationSchema,
    rows: list[SourceRow],
    source_columns: tuple[str, ...],
    identity_columns: tuple[str, ...] = (),
) -> ExecutionResult:
    if not plan.is_approved:
        raise ExecutionRefused(
            "The plan has not been approved. The executor never runs an "
            "unapproved plan version."
        )

    # A plan can only carry APPROVED mappings if it came through
    # app.domain.plan.approve, which refuses fatal issues and unacknowledged
    # lossy operations. Checking here closes the path where a caller builds an
    # approved-looking plan by hand.
    unapproved = [
        m.source_column for m in plan.mappings if m.status is not MappingStatus.APPROVED
    ]
    if unapproved:
        raise ExecutionRefused(
            "These mappings are not marked approved: " + ", ".join(sorted(unapproved))
        )

    unacknowledged = [
        m.source_column
        for m in plan.mappings
        if m.requires_acknowledgement and m.source_column not in plan.acknowledgements
    ]
    if unacknowledged:
        raise ExecutionRefused(
            "These lossy operations carry no recorded acknowledgement: "
            + ", ".join(sorted(unacknowledged))
        )

    accounting = RowAccounting(source_rows=len(rows))
    errors: list[TransformError] = []
    applied: list[str] = []
    staged: list[StagedRow] = []

    # What makes a row distinct in the destination. For customers that is the
    # identifier alone; for robotics it is (robot_id, joint_name), because one
    # robot has a calibration per joint. Grouping by the identifier alone would
    # report those joints as conflicting rows.
    identity = identity_columns or (plan.key_column,)

    def row_identity(source_row: SourceRow) -> str:
        return "\u001f".join(source_row.get(column) for column in identity)

    key_mapping = plan.mapping_for(plan.key_column)
    if key_mapping is None:
        raise ExecutionRefused(
            f"The approved plan has no mapping for the key column {plan.key_column!r}."
        )

    # --- duplicate handling -------------------------------------------------
    # Exact duplicates and conflicting keys are different problems. An exact
    # duplicate can be dropped under an approved policy. Two rows sharing a key
    # but disagreeing on content are never collapsed, because choosing one
    # would discard data nobody agreed to discard.
    seen_fingerprints: dict[str, int] = {}
    key_to_fingerprints: dict[str, set[str]] = {}
    excluded_rows: set[int] = set()
    conflict_rows: set[int] = set()

    for row in rows:
        fingerprint = row.fingerprint(source_columns)
        key_to_fingerprints.setdefault(row_identity(row), set()).add(fingerprint)

        if fingerprint in seen_fingerprints:
            if plan.duplicate_policy is DuplicatePolicy.KEEP_FIRST_EXACT:
                excluded_rows.add(row.row_number)
                accounting.duplicates_excluded += 1
            else:
                conflict_rows.add(row.row_number)
        else:
            seen_fingerprints[fingerprint] = row.row_number

    conflicting_keys = {
        key for key, prints in key_to_fingerprints.items() if len(prints) > 1
    }
    applied.append(
        f"deduplicate: policy={plan.duplicate_policy.value}, "
        f"{accounting.duplicates_excluded} exact duplicate row(s) excluded"
    )

    # --- per row transformation --------------------------------------------
    for row in rows:
        if row.row_number in excluded_rows:
            staged.append(
                StagedRow(
                    row_number=row.row_number,
                    source_key=row.get(plan.key_column),
                    values={},
                    disposition=RowDisposition.DUPLICATE_EXCLUDED,
                    reason="Exact duplicate excluded under the approved policy.",
                )
            )
            continue

        raw_key = row.get(plan.key_column)
        values: dict[str, object] = {}
        row_errors: list[TransformError] = []

        for mapping in plan.mappings:
            if mapping.operation is Operation.DEDUPLICATE:
                continue
            if mapping.destination_column is None:
                continue

            raw = row.get(mapping.source_column)
            try:
                values[mapping.destination_column] = _apply(mapping, raw, plan, schema)
            except _TransformFailure as failure:
                row_errors.append(
                    TransformError(
                        row_number=row.row_number,
                        source_key=raw_key,
                        field_name=mapping.source_column,
                        source_value=raw,
                        reason=str(failure),
                    )
                )

        disposition = RowDisposition.STAGED
        reason: str | None = None

        if row_errors:
            errors.extend(row_errors)
            accounting.rejected += 1
            disposition = RowDisposition.REJECTED
            reason = row_errors[0].reason
        elif row_identity(row) in conflicting_keys:
            conflict_rows.add(row.row_number)
            accounting.conflicts_unresolved += 1
            disposition = RowDisposition.CONFLICT_UNRESOLVED
            reason = (
                f"Key {raw_key!r} appears more than once with different content. "
                "This needs an explicit decision before it can be committed."
            )
        else:
            missing = _missing_required(values, schema)
            if missing:
                disposition, reason = _apply_required_field_policy(plan, missing)
                if disposition is RowDisposition.QUARANTINED:
                    accounting.quarantined += 1
                elif disposition is RowDisposition.POLICY_EXCLUDED:
                    accounting.policy_excluded += 1

            overflow = _numeric_overflow(values, schema)
            if overflow and disposition is RowDisposition.STAGED:
                accounting.quarantined += 1
                disposition = RowDisposition.QUARANTINED
                reason = overflow

        staged.append(
            StagedRow(
                row_number=row.row_number,
                source_key=raw_key,
                values=values,
                disposition=disposition,
                reason=reason,
            )
        )

    for mapping in plan.mappings:
        if mapping.operation is not Operation.DEDUPLICATE:
            applied.append(
                f"{mapping.source_column} -> {mapping.destination_column}: "
                f"{mapping.operation.value}"
            )

    return ExecutionResult(
        plan_version=plan.version_label,
        staged=staged,
        accounting=accounting,
        errors=errors,
        applied_operations=applied,
    )


class _TransformFailure(Exception):
    """A value the approved operation cannot produce. Never guessed around."""


#: Values whose decimal separator is unambiguous on their own.
_DOT_DECIMAL = re.compile(r"^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d+$")
_COMMA_DECIMAL = re.compile(r"^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{1,2}$")
_PLAIN = re.compile(r"^[+-]?\d+$")


def _decimal_under(text: str, convention: str | None) -> Decimal:
    """Read a decimal under the convention a human approved.

    With no convention the value must already be in a form Decimal accepts,
    which is the behaviour every existing plan has. `1,250.00` and `1250,00`
    are refused there, and correctly so: guessing between them is exactly the
    silent damage this product exists to prevent.

    An approved convention narrows what is accepted rather than widening it:

        dot_decimal    1,250.00 and 1200.50, comma is a thousands separator
        comma_decimal  1250,00 and 1.250,00, dot is a thousands separator
        strict_either  either of the two forms above, but only when the value
                       matches one of them exactly and unambiguously

    Anything outside the chosen pattern still fails closed. A bare integer is
    accepted under every convention because it reads the same way in all of
    them.
    """
    if convention is None:
        return Decimal(text)

    if _PLAIN.match(text):
        return Decimal(text)

    dot = bool(_DOT_DECIMAL.match(text))
    comma = bool(_COMMA_DECIMAL.match(text))

    if convention == "dot_decimal" and dot:
        return Decimal(text.replace(",", ""))
    if convention == "comma_decimal" and comma:
        return Decimal(text.replace(".", "").replace(",", "."))
    if convention == "strict_either":
        # Each form is individually unambiguous; only a value matching exactly
        # one of them is read, so nothing is inferred from context.
        if dot and not comma:
            return Decimal(text.replace(",", ""))
        if comma and not dot:
            return Decimal(text.replace(".", "").replace(",", "."))

    raise _TransformFailure(
        f"{text!r} does not match the approved {convention} reading, so it was "
        "not converted. Nothing is guessed."
    )


def _apply(
    mapping: Mapping, raw: str, plan: MigrationPlan, schema: DestinationSchema
) -> object:
    operation = mapping.operation

    if operation in (
        Operation.RENAME_FIELD,
        Operation.PRESERVE_IDENTIFIER_AS_STRING,
    ):
        return raw

    if operation is Operation.NORMALIZE_WHITESPACE:
        return " ".join(raw.split())

    if operation is Operation.NULL_HANDLING:
        return None if raw.strip() == "" else raw

    if operation is Operation.CAST_TO_INTEGER:
        # Faithfully lossy. This is the point: the plan asked for it, so the
        # executor does it, and the verifier reports what it cost.
        if raw.strip() == "":
            return None
        try:
            return int(raw.strip())
        except ValueError:
            raise _TransformFailure(
                f"{raw!r} is not an integer, so the approved cast cannot be applied."
            ) from None

    if operation is Operation.CAST_TO_DECIMAL:
        if raw.strip() == "":
            return None
        convention = mapping.options.get("decimal_convention")
        try:
            value = _decimal_under(raw.strip(), convention)
        except InvalidOperation:
            raise _TransformFailure(
                f"{raw!r} is not a decimal number."
            ) from None
        # The destination column decides the scale, not a constant. A customer
        # balance is NUMERIC(12,2) and a robot gear ratio NUMERIC(12,4); the
        # same cast must respect whichever it is writing into. An explicit
        # option on the mapping still wins, because an approved plan may
        # deliberately narrow it.
        destination = (
            schema.column(mapping.destination_column)
            if mapping.destination_column is not None
            else None
        )
        default_scale = (
            destination.numeric_scale
            if destination is not None and destination.numeric_scale is not None
            else 2
        )
        scale = int(mapping.options.get("scale", default_scale))
        if -value.as_tuple().exponent > scale:  # type: ignore[operator]
            allow = bool(mapping.options.get("allow_rounding", False))
            if not allow:
                raise _TransformFailure(
                    f"{raw} has more than {scale} decimal places and no rounding "
                    "policy was approved."
                )
            value = value.quantize(Decimal(1).scaleb(-scale))
        return value

    if operation is Operation.PARSE_DATE:
        return _parse_date(raw, plan.date_format_policy)

    raise _TransformFailure(f"Operation {operation} is not implemented.")


def _parse_date(raw: str, policy: DateFormatPolicy | None) -> date | None:
    value = raw.strip()
    if value == "":
        return None
    if policy is None:
        raise _TransformFailure(
            "No date format policy was approved, so this value is not parsed."
        )

    parts = value.replace("-", "/").split("/")
    if len(parts) != 3:
        raise _TransformFailure(f"{raw!r} is not a recognisable date.")

    try:
        if len(parts[0]) == 4:
            year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
        elif policy is DateFormatPolicy.DAY_FIRST:
            day, month, year = int(parts[0]), int(parts[1]), int(parts[2])
        else:
            month, day, year = int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        raise _TransformFailure(f"{raw!r} contains a non numeric date part.") from None

    try:
        return date(year, month, day)
    except ValueError:
        # 2024-02-30 lands here. No replacement date is invented.
        raise _TransformFailure(
            f"{raw!r} is not a real calendar date under the approved policy."
        ) from None


def _missing_required(values: dict[str, object], schema: DestinationSchema) -> list[str]:
    missing: list[str] = []
    for name in schema.required_columns:
        value = values.get(name)
        if value is None or (isinstance(value, str) and value.strip() == ""):
            missing.append(name)
    return missing


def _apply_required_field_policy(
    plan: MigrationPlan, missing: list[str]
) -> tuple[RowDisposition, str]:
    joined = ", ".join(missing)
    policy = plan.required_field_policy

    if policy is RequiredFieldPolicy.POLICY_EXCLUSION:
        return (
            RowDisposition.POLICY_EXCLUDED,
            f"Excluded under an approved policy: {joined} is required and empty.",
        )
    # Quarantine is the default. A row that cannot satisfy a NOT NULL column is
    # never written, and confirming the value is blank is not a resolution.
    return (
        RowDisposition.QUARANTINED,
        f"Quarantined: {joined} is required by the destination and is empty.",
    )


def _numeric_overflow(values: dict[str, object], schema: DestinationSchema) -> str | None:
    for column in schema.columns:
        if column.numeric_precision is None:
            continue
        value = values.get(column.name)
        if not isinstance(value, Decimal):
            continue
        digits = len(value.as_tuple().digits)
        exponent = value.as_tuple().exponent
        scale = -exponent if isinstance(exponent, int) and exponent < 0 else 0
        integer_digits = digits - scale
        max_integer_digits = column.numeric_precision - (column.numeric_scale or 0)
        if integer_digits > max_integer_digits:
            return (
                f"{value} exceeds the range of "
                f"NUMERIC({column.numeric_precision},{column.numeric_scale}) "
                f"on {column.name}."
            )
    return None
