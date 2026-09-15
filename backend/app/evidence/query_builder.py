"""The query boundary for External Evidence Check.

Everything that leaves MoveProof for an external search passes through here.
The boundary is deliberately narrow: a fixed set of metadata fields in, one
sanitised question out. Nothing else can reach the provider.

The reason is the same one that governs the rest of the product. Uploaded data
is a customer's data. A review screen that can reach the public internet is a
path out of this system, and a free-form search box on that path would let a
row value, an email address or a name be sent somewhere by accident. So the
builder does not accept text: it accepts schema metadata and composes the
question itself.

What is permitted is listed in `EvidenceContext`. What is refused is refused by
construction, because there is no field to put it in.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from app.config import settings

# Column and system names are identifiers, not prose. Anything outside this
# shape is either a mistake or an attempt to smuggle content through a field
# that was meant to hold a name.
IDENTIFIER = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_ .\-]{0,63}$")

# Types and operations come from our own vocabulary, so they are matched
# against a pattern rather than trusted.
TYPE_TOKEN = re.compile(r"^[A-Za-z0-9_()\, ]{1,48}$")

MAX_REASON_CHARS = 160


class UnsafeEvidenceRequest(Exception):
    """The request carries something the boundary will not send outward."""


@dataclass(frozen=True)
class EvidenceContext:
    """The only inputs a query may be built from.

    Every field is metadata about the migration's shape. None of them is a
    value from the uploaded file, and there is no field in which one could be
    placed.
    """

    source_column: str
    destination_column: str
    question: str
    source_type: str | None = None
    destination_type: str | None = None
    proposed_operation: str | None = None
    risk_category: str | None = None
    ambiguity_reason: str | None = None
    source_system: str | None = None


# The questions a reviewer can ask. Free text is not accepted: the operator
# chooses a question, and the builder writes it. This is what keeps the feature
# a contextual check rather than a search engine.
QUESTION_TEMPLATES: dict[str, str] = {
    "leading_zeros": (
        "Is the {source_column} field documented as a fixed width or zero padded "
        "identifier rather than a numeric quantity?"
    ),
    "date_format": (
        "Is the {source_column} field documented as a day first (DD/MM/YYYY) or "
        "month first (MM/DD/YYYY) date format?"
    ),
    "identifier_format": (
        "How is the {source_column} identifier format defined, and is it "
        "character based rather than numeric?"
    ),
    "enumerated_code": (
        "Is {source_column} documented as an enumerated code rather than an "
        "integer quantity?"
    ),
    "precision": (
        "What decimal precision and scale are documented for the "
        "{source_column} field?"
    ),
    "field_definition": (
        "How is the {source_column} field defined in the official documentation?"
    ),
}


def available_questions() -> list[dict[str, str]]:
    """The questions the interface may offer, with readable labels."""
    labels = {
        "leading_zeros": "Are leading zeros significant?",
        "date_format": "Is the date day first or month first?",
        "identifier_format": "How is the identifier format defined?",
        "enumerated_code": "Is this an enumerated code or a number?",
        "precision": "What decimal precision is documented?",
        "field_definition": "How is this field officially defined?",
    }
    return [{"id": key, "label": labels[key]} for key in QUESTION_TEMPLATES]


def _clean_identifier(value: str, field_name: str) -> str:
    text = unicodedata.normalize("NFC", value or "").strip()
    if not text:
        raise UnsafeEvidenceRequest(f"{field_name} is required.")
    if not IDENTIFIER.match(text):
        raise UnsafeEvidenceRequest(
            f"{field_name} does not look like a column or system name. Only "
            "schema metadata may be sent to an external provider."
        )
    return text


def _clean_optional_token(value: str | None, field_name: str) -> str | None:
    if value is None or not value.strip():
        return None
    text = unicodedata.normalize("NFC", value).strip()
    if not TYPE_TOKEN.match(text):
        raise UnsafeEvidenceRequest(
            f"{field_name} is not a recognisable type or operation name."
        )
    return text


def _clean_reason(value: str | None) -> str | None:
    """A short human note about why the field is ambiguous.

    This is the one free-ish field, so it is the one most worth constraining:
    length capped, control characters stripped, and anything that looks like a
    value rather than a reason rejected.
    """
    if value is None or not value.strip():
        return None
    text = unicodedata.normalize("NFC", value).strip()
    text = "".join(ch for ch in text if ch.isprintable())
    if len(text) > MAX_REASON_CHARS:
        raise UnsafeEvidenceRequest(
            f"The ambiguity reason is longer than {MAX_REASON_CHARS} characters. "
            "It should describe the question, not carry data."
        )
    if "@" in text:
        raise UnsafeEvidenceRequest(
            "The ambiguity reason looks like it contains an email address. "
            "Row values are never sent to an external provider."
        )
    return text


def build_query(context: EvidenceContext) -> str:
    """Compose the one string that leaves this system.

    Built from validated metadata and a chosen template. The result is capped,
    because a provider that accepts an unbounded query is not a reason to send
    one.
    """
    source_column = _clean_identifier(context.source_column, "source_column")
    destination_column = _clean_identifier(
        context.destination_column, "destination_column"
    )
    source_system = (
        _clean_identifier(context.source_system, "source_system")
        if context.source_system
        else None
    )
    source_type = _clean_optional_token(context.source_type, "source_type")
    destination_type = _clean_optional_token(
        context.destination_type, "destination_type"
    )
    operation = _clean_optional_token(context.proposed_operation, "proposed_operation")
    risk = _clean_optional_token(context.risk_category, "risk_category")
    reason = _clean_reason(context.ambiguity_reason)

    template = QUESTION_TEMPLATES.get(context.question)
    if template is None:
        raise UnsafeEvidenceRequest(
            f"Unknown question {context.question!r}. Free text questions are not "
            "accepted; choose one of: " + ", ".join(sorted(QUESTION_TEMPLATES))
        )

    parts = [template.format(source_column=source_column)]
    if source_system:
        parts.append(f"in {source_system}")
    if source_type and destination_type:
        parts.append(f"mapped from {source_type} to {destination_type}")
    if destination_column != source_column:
        parts.append(f"as destination column {destination_column}")
    if operation:
        parts.append(f"under a {operation.replace('_', ' ')} transformation")
    if risk:
        parts.append(f"flagged as {risk.replace('_', ' ')}")
    if reason:
        parts.append(f"({reason})")
    parts.append("official documentation")

    query = " ".join(parts)
    query = re.sub(r"\s+", " ", query).strip()

    limit = settings.tavily_max_query_chars
    if len(query) > limit:
        query = query[:limit].rsplit(" ", 1)[0]
    return query
