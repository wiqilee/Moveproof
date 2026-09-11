"""Plan validation.

Model output is untrusted. Every proposal passes through `validate_plan`
before a human is shown it and before the executor sees it. An operation
outside the allowlist is rejected here, not caught later at runtime.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from app.domain.contract import VerificationContract
from app.domain.types import (
    DateFormatPolicy,
    DestinationSchema,
    Mapping,
    MappingStatus,
    MigrationPlan,
    Operation,
)

# Operations that can destroy information without raising an error. A plan
# containing one of these is not rejected, but it cannot be approved without an
# explicit acknowledgement from the operator.
LOSSY_OPERATIONS = {Operation.CAST_TO_INTEGER}

# Operations that need a policy set before they are deterministic.
POLICY_DEPENDENT = {Operation.PARSE_DATE}


@dataclass
class ValidationIssue:
    source_column: str
    reason: str
    fatal: bool


@dataclass
class ValidationResult:
    plan: MigrationPlan
    issues: list[ValidationIssue]

    @property
    def fatal_issues(self) -> list[ValidationIssue]:
        return [issue for issue in self.issues if issue.fatal]

    @property
    def is_executable(self) -> bool:
        return not self.fatal_issues

    @property
    def requires_acknowledgement(self) -> bool:
        return any(m.requires_acknowledgement for m in self.plan.mappings)


def validate_plan(
    plan: MigrationPlan,
    schema: DestinationSchema,
    source_columns: tuple[str, ...],
) -> ValidationResult:
    """Check a plan against the allowlist, the schema and the source file.

    Returns a plan whose mapping statuses reflect what was found. A mapping
    that needs a human decision comes back as REVIEW, never as anything that
    could be rendered as a passing result.
    """
    issues: list[ValidationIssue] = []
    checked: list[Mapping] = []

    for mapping in plan.mappings:
        status = mapping.status
        note = mapping.note
        requires_ack = mapping.requires_acknowledgement

        # The operation must be a member of the allowlist enum. Anything else
        # cannot even be constructed, so a string that got this far is fatal.
        if not isinstance(mapping.operation, Operation):
            issues.append(
                ValidationIssue(
                    mapping.source_column,
                    f"Operation {mapping.operation!r} is not on the allowlist.",
                    fatal=True,
                )
            )
            continue

        if mapping.operation is not Operation.DEDUPLICATE:
            if mapping.source_column not in source_columns:
                issues.append(
                    ValidationIssue(
                        mapping.source_column,
                        "The source file has no such column.",
                        fatal=True,
                    )
                )
                continue

        if mapping.destination_column is not None:
            column = schema.column(mapping.destination_column)
            if column is None:
                issues.append(
                    ValidationIssue(
                        mapping.source_column,
                        f"The destination schema has no column "
                        f"{mapping.destination_column!r}.",
                        fatal=True,
                    )
                )
                continue

            if (
                mapping.operation is Operation.CAST_TO_INTEGER
                and column.name == plan.key_column
            ):
                status = MappingStatus.REVIEW
                requires_ack = True
                note = (
                    "An integer cast on the identifier column destroys leading "
                    "zeros. This can be approved, but only deliberately."
                )
            elif mapping.operation in LOSSY_OPERATIONS:
                status = MappingStatus.REVIEW
                requires_ack = True
                note = note or "This operation can lose information."

        if (
            mapping.operation in POLICY_DEPENDENT
            and plan.date_format_policy is None
        ):
            status = MappingStatus.REVIEW
            requires_ack = True
            note = note or (
                "No date format policy is set, so this transformation is not "
                "yet deterministic."
            )

        checked.append(
            Mapping(
                source_column=mapping.source_column,
                destination_column=mapping.destination_column,
                operation=mapping.operation,
                status=status,
                note=note,
                requires_acknowledgement=requires_ack,
                options=mapping.options,
            )
        )

    mapped_destinations = [
        m.destination_column for m in checked if m.destination_column is not None
    ]
    duplicated = {d for d in mapped_destinations if mapped_destinations.count(d) > 1}
    for destination in sorted(duplicated):
        issues.append(
            ValidationIssue(
                destination,
                "Two source columns map to the same destination column.",
                fatal=True,
            )
        )

    for required in schema.required_columns:
        if required not in mapped_destinations:
            issues.append(
                ValidationIssue(
                    required,
                    f"Required destination column {required!r} has no mapping.",
                    fatal=True,
                )
            )

    validated = MigrationPlan(
        version=plan.version,
        mappings=tuple(checked),
        proposed_by=plan.proposed_by,
        key_column=plan.key_column,
        date_format_policy=plan.date_format_policy,
        duplicate_policy=plan.duplicate_policy,
        required_field_policy=plan.required_field_policy,
        approved_at=plan.approved_at,
        approved_by=plan.approved_by,
    )
    return ValidationResult(plan=validated, issues=issues)


class ApprovalRefused(Exception):
    """Raised when a plan cannot be approved. Never downgraded to a warning."""


def approve(
    validation: ValidationResult,
    approved_by: str,
    at: str,
    acknowledgements: Iterable[str] = (),
    contract: VerificationContract | None = None,
) -> MigrationPlan:
    """Freeze a validated plan.

    Approval takes a ValidationResult rather than a bare plan on purpose. A
    proposal cannot become executable by calling a function on it: it has to
    have passed validation first, and the result of that validation is the only
    thing this function accepts.

    Two conditions refuse outright:

    * any fatal validation issue, because an unmapped required column or an
      operation outside the allowlist is not something an operator can wave
      through;
    * any lossy operation whose source column is not named in
      `acknowledgements`, because "I saw the warning" has to be recorded per
      column rather than inferred from a status field.
    """
    if validation.fatal_issues:
        reasons = "; ".join(
            f"{issue.source_column}: {issue.reason}" for issue in validation.fatal_issues
        )
        raise ApprovalRefused(f"The plan has fatal validation issues. {reasons}")

    plan = validation.plan
    acknowledged = set(acknowledgements)
    outstanding = [
        m.source_column
        for m in plan.mappings
        if m.requires_acknowledgement and m.source_column not in acknowledged
    ]
    if outstanding:
        raise ApprovalRefused(
            "These operations lose information and were not acknowledged: "
            + ", ".join(sorted(outstanding))
        )

    unknown = acknowledged - {m.source_column for m in plan.mappings}
    if unknown:
        raise ApprovalRefused(
            "Acknowledgement refers to columns that are not in the plan: "
            + ", ".join(sorted(unknown))
        )

    return MigrationPlan(
        version=plan.version,
        mappings=tuple(
            Mapping(
                source_column=m.source_column,
                destination_column=m.destination_column,
                operation=m.operation,
                status=MappingStatus.APPROVED,
                note=m.note,
                requires_acknowledgement=m.requires_acknowledgement,
                options=m.options,
            )
            for m in plan.mappings
        ),
        proposed_by=plan.proposed_by,
        key_column=plan.key_column,
        date_format_policy=plan.date_format_policy,
        duplicate_policy=plan.duplicate_policy,
        required_field_policy=plan.required_field_policy,
        conflict_policy=plan.conflict_policy,
        approved_at=at,
        approved_by=approved_by,
        acknowledgements=tuple(sorted(acknowledged)),
        contract_hash=contract.hash() if contract is not None else None,
    )


def validate_and_approve(
    plan: MigrationPlan,
    schema: DestinationSchema,
    source_columns: tuple[str, ...],
    approved_by: str,
    at: str,
    acknowledgements: Iterable[str] = (),
    contract: VerificationContract | None = None,
) -> MigrationPlan:
    """Validate then approve in one call, for the common path."""
    validation = validate_plan(plan, schema, source_columns)
    return approve(validation, approved_by, at, acknowledgements, contract)


def diff_plans(previous: MigrationPlan, revised: MigrationPlan) -> list[dict[str, str]]:
    """A reviewable difference between two plan versions."""
    changes: list[dict[str, str]] = []
    for mapping in revised.mappings:
        before = previous.mapping_for(mapping.source_column)
        if before is None:
            changes.append(
                {
                    "column": mapping.source_column,
                    "before": "not mapped",
                    "after": mapping.operation.value,
                }
            )
        elif before.operation is not mapping.operation:
            changes.append(
                {
                    "column": mapping.source_column,
                    "before": before.operation.value,
                    "after": mapping.operation.value,
                }
            )

    if previous.date_format_policy is not revised.date_format_policy:
        changes.append(
            {
                "column": "date_format_policy",
                "before": _policy_label(previous.date_format_policy),
                "after": _policy_label(revised.date_format_policy),
            }
        )
    return changes


def _policy_label(policy: DateFormatPolicy | None) -> str:
    return policy.value if policy is not None else "not set"
