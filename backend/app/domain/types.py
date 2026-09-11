"""Typed domain model for the deterministic migration core.

These types mirror src/domain/types.ts on the frontend. Python becomes the
authority once the API is wired up: the TypeScript verification engine exists
only so the current build has something to render, and it is removed in the
batch that connects the two.

Decimal is used for every exact quantity. A float would silently lose the cent
this product exists to catch.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any


class CheckStatus(str, Enum):
    """Four outcomes that do not overlap.

    PASSED        the check ran against transformed data and succeeded
    FAILED        the check ran and an approved invariant was violated
    REVIEW        the check ran and needs a human decision to resolve
    NOT_VERIFIED  the property was not configured or not executed
    """

    PASSED = "passed"
    FAILED = "failed"
    REVIEW = "review"
    NOT_VERIFIED = "not_verified"


class MappingStatus(str, Enum):
    """Describes a plan, never a result. There is deliberately no PASSED."""

    PROPOSED = "proposed"
    REVIEW = "review"
    APPROVED = "approved"


class MigrationState(str, Enum):
    DRAFT = "draft"
    PLAN_APPROVED = "plan_approved"
    STAGING = "staging"
    VERIFICATION_FAILED = "verification_failed"
    REVIEW_REQUIRED = "review_required"
    READY_TO_COMMIT = "ready_to_commit"
    COMMITTED = "committed"
    ROLLED_BACK = "rolled_back"


class RowDisposition(str, Enum):
    """Where a source row ended up. Every row gets exactly one of these."""

    STAGED = "staged"
    DUPLICATE_EXCLUDED = "duplicate_excluded"
    CONFLICT_UNRESOLVED = "conflict_unresolved"
    QUARANTINED = "quarantined"
    POLICY_EXCLUDED = "policy_excluded"
    REJECTED = "rejected"


class Operation(str, Enum):
    """The allowlist.

    A proposal naming anything outside this enum is rejected during plan
    validation. Nothing else can ever reach the executor.
    """

    PRESERVE_IDENTIFIER_AS_STRING = "preserve_identifier_as_string"
    CAST_TO_INTEGER = "cast_to_integer"
    CAST_TO_DECIMAL = "cast_to_decimal"
    NORMALIZE_WHITESPACE = "normalize_whitespace"
    RENAME_FIELD = "rename_field"
    PARSE_DATE = "parse_date"
    NULL_HANDLING = "null_handling"
    DEDUPLICATE = "deduplicate"


class DateFormatPolicy(str, Enum):
    DAY_FIRST = "day_first"
    MONTH_FIRST = "month_first"
    ISO = "iso"


class DuplicatePolicy(str, Enum):
    """How duplicates are handled.

    KEEP_FIRST_EXACT applies only to rows identical in every field. Rows that
    share a key but differ in content are never silently collapsed; they are
    reported as conflicts and require an explicit decision.
    """

    KEEP_FIRST_EXACT = "keep_first_exact"
    REJECT_ALL = "reject_all"


class RequiredFieldPolicy(str, Enum):
    QUARANTINE = "quarantine"
    POLICY_EXCLUSION = "policy_exclusion"
    CORRECT_FROM_SOURCE = "correct_from_source"


class ConflictPolicy(str, Enum):
    """What to do when a destination row already holds the same key.

    There is no default. A commit that meets an existing key without an
    approved policy fails closed, because skipping a row while reporting
    success is the exact failure this product exists to prevent.
    """

    FAIL_CLOSED = "fail_closed"
    SKIP_EXISTING = "skip_existing"
    ABORT_ON_ANY = "abort_on_any"


@dataclass(frozen=True)
class DestinationColumn:
    name: str
    data_type: str
    required: bool
    unique: bool = False
    max_length: int | None = None
    numeric_precision: int | None = None
    numeric_scale: int | None = None
    description: str = ""


@dataclass(frozen=True)
class DestinationSchema:
    name: str
    version: str
    columns: tuple[DestinationColumn, ...]

    def column(self, name: str) -> DestinationColumn | None:
        for col in self.columns:
            if col.name == name:
                return col
        return None

    @property
    def required_columns(self) -> tuple[str, ...]:
        return tuple(c.name for c in self.columns if c.required)

    @property
    def unique_columns(self) -> tuple[str, ...]:
        return tuple(c.name for c in self.columns if c.unique)


@dataclass(frozen=True)
class SourceFile:
    filename: str
    checksum: str
    encoding: str
    delimiter: str
    byte_size: int
    row_count: int
    column_count: int
    columns: tuple[str, ...]


@dataclass
class SourceRow:
    """A row exactly as read from the file.

    Every value stays a string. Type interpretation is a decision the plan
    makes explicitly, never something the reader guesses on the way in.
    """

    row_number: int
    values: dict[str, str]

    def get(self, column: str) -> str:
        return self.values.get(column, "")

    def fingerprint(self, columns: tuple[str, ...]) -> str:
        """Exact-duplicate identity: every field, in schema order, verbatim."""
        return "\x1f".join(self.values.get(c, "") for c in columns)


@dataclass(frozen=True)
class Mapping:
    source_column: str
    destination_column: str | None
    operation: Operation
    status: MappingStatus = MappingStatus.PROPOSED
    note: str | None = None
    requires_acknowledgement: bool = False
    options: dict[str, Any] = field(default_factory=dict)


@dataclass
class MigrationPlan:
    """Immutable once approved.

    `revise` returns a new plan with an incremented version rather than
    mutating this one, so an evidence report can always answer the question
    "what exactly did the operator approve".
    """

    version: int
    mappings: tuple[Mapping, ...]
    proposed_by: str
    key_column: str
    date_format_policy: DateFormatPolicy | None = None
    duplicate_policy: DuplicatePolicy = DuplicatePolicy.KEEP_FIRST_EXACT
    required_field_policy: RequiredFieldPolicy | None = None
    conflict_policy: ConflictPolicy = ConflictPolicy.FAIL_CLOSED
    approved_at: str | None = None
    approved_by: str | None = None
    # Set only by app.domain.plan.approve, which refuses to run when a lossy
    # operation has not been acknowledged by name.
    acknowledgements: tuple[str, ...] = ()
    # The contract this approval is bound to. Committing under a different
    # contract is then detectable rather than a silent substitution.
    contract_hash: str | None = None

    @property
    def version_label(self) -> str:
        return f"v{self.version}"

    @property
    def is_approved(self) -> bool:
        return self.approved_at is not None

    def revise(self, mappings: tuple[Mapping, ...], **overrides: Any) -> "MigrationPlan":
        return MigrationPlan(
            version=self.version + 1,
            mappings=mappings,
            proposed_by=overrides.get("proposed_by", self.proposed_by),
            key_column=overrides.get("key_column", self.key_column),
            date_format_policy=overrides.get("date_format_policy", self.date_format_policy),
            duplicate_policy=overrides.get("duplicate_policy", self.duplicate_policy),
            required_field_policy=overrides.get(
                "required_field_policy", self.required_field_policy
            ),
            conflict_policy=overrides.get("conflict_policy", self.conflict_policy),
            approved_at=None,
            approved_by=None,
            acknowledgements=(),
            contract_hash=None,
        )

    def mapping_for(self, source_column: str) -> Mapping | None:
        for mapping in self.mappings:
            if mapping.source_column == source_column:
                return mapping
        return None


@dataclass
class StagedRow:
    """A row after the approved plan has been applied to it."""

    row_number: int
    source_key: str
    values: dict[str, Any]
    disposition: RowDisposition = RowDisposition.STAGED
    reason: str | None = None

    @property
    def is_committable(self) -> bool:
        return self.disposition is RowDisposition.STAGED


@dataclass
class RowAccounting:
    source_rows: int = 0
    duplicates_excluded: int = 0
    conflicts_unresolved: int = 0
    quarantined: int = 0
    policy_excluded: int = 0
    rejected: int = 0

    @property
    def staged_rows(self) -> int:
        return self.source_rows - self.duplicates_excluded - self.rejected

    @property
    def committable_rows(self) -> int:
        return (
            self.staged_rows
            - self.quarantined
            - self.policy_excluded
            - self.conflicts_unresolved
        )

    def as_arithmetic(self) -> list[str]:
        """Row accounting stated as arithmetic, so a reader can follow it."""
        lines = [f"{self.source_rows} source rows"]
        if self.duplicates_excluded:
            lines.append(f"minus {self.duplicates_excluded} approved exact duplicate")
        if self.rejected:
            lines.append(f"minus {self.rejected} rejected at transformation")
        lines.append(f"equals {self.staged_rows} staged rows")
        if self.quarantined:
            lines.append(f"minus {self.quarantined} quarantined")
        if self.policy_excluded:
            lines.append(f"minus {self.policy_excluded} excluded under policy")
        if self.conflicts_unresolved:
            lines.append(f"minus {self.conflicts_unresolved} unresolved key conflict")
        lines.append(f"equals {self.committable_rows} rows eligible to commit")
        return lines


@dataclass
class Evidence:
    row_key: str
    field_name: str
    source_value: str
    destination_value: str

    def to_dict(self) -> dict[str, str]:
        """The wire form of a piece of evidence.

        The attribute is `field_name` because `field` collides with
        dataclasses.field, but every consumer, the API, the HTML report, the
        PDF and the frontend, uses `field`. Serialising through this method
        rather than `asdict` keeps the stored shape and the rendered shape the
        same. They diverged once and the result was a KeyError that surfaced
        as a 404.
        """
        return {
            "row_key": self.row_key,
            "field": self.field_name,
            "source_value": self.source_value,
            "destination_value": self.destination_value,
        }


@dataclass
class Check:
    check_id: str
    name: str
    expected: str
    observed: str
    status: CheckStatus
    evidence: list[Evidence] = field(default_factory=list)


@dataclass
class TransformError:
    row_number: int
    source_key: str
    field_name: str
    source_value: str
    reason: str


@dataclass
class ExecutionResult:
    plan_version: str
    staged: list[StagedRow]
    accounting: RowAccounting
    errors: list[TransformError]
    applied_operations: list[str]

    def committable(self) -> list[StagedRow]:
        return [row for row in self.staged if row.is_committable]


def decimal_or_none(raw: str) -> Decimal | None:
    """Parse an exact decimal, or return None rather than guessing."""
    try:
        return Decimal(raw.strip())
    except (InvalidOperation, ValueError, AttributeError):
        return None
