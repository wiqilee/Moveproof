"""Canonical row serialization and stable hashing.

This is the reference implementation. The Rust crate in `rust-verifier/`
mirrors it byte for byte, and `tests/test_parity.py` fails if the two ever
disagree.

Why canonicalize at all: comparing a source row against a staged row field by
field works, but it says nothing about whether the row as a whole survived. A
canonical form collapses a row to one string under fixed rules, so two rows
hash the same only when they are the same row under those rules. That gives a
single reconciliation check across the whole dataset rather than one comparison
per field.

The rules are deliberately strict about the things that go wrong quietly:

* Field order never matters. Fields are sorted by name.
* Text is normalised to NFC, so a name written with a combining accent hashes
  the same as the precomposed form. Two spellings of the same name are the same
  customer.
* A decimal is normalised numerically, so 1200.50 and 1200.5 hash the same
  while 1200.50 and 1200.4999 do not.
* An identifier is never normalised numerically. 00127 and 127 are different
  strings and must stay different hashes, which is the entire point.
* Null is a distinct token, not an empty string. A missing value and a blank
  value are not the same fact.
"""

from __future__ import annotations

import hashlib
import unicodedata
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable, Mapping

FIELD_SEPARATOR = "\x1f"
PAIR_SEPARATOR = "\x1e"
NULL_TOKEN = "\x00NULL"
EMPTY_TOKEN = "\x00EMPTY"

CANONICAL_VERSION = "moveproof.canonical.v1"


def canonical_value(value: Any) -> str:
    """Render one value in canonical form."""
    if value is None:
        return NULL_TOKEN

    if isinstance(value, bool):
        return "true" if value else "false"

    if isinstance(value, Decimal):
        # normalize() strips trailing zeros so 1200.50 and 1200.5 agree.
        # Exponent notation is avoided because it would make the canonical form
        # depend on magnitude.
        normalized = value.normalize()
        if normalized == normalized.to_integral_value():
            normalized = normalized.quantize(Decimal(1))
        return format(normalized, "f")

    if isinstance(value, int):
        return str(value)

    if isinstance(value, float):
        # A float has already lost precision by the time it reaches here, so
        # rendering it as a decimal would imply an exactness that is not there.
        raise TypeError(
            "Floats are not canonicalisable. Use Decimal for exact quantities."
        )

    if isinstance(value, datetime):
        return value.isoformat()

    if isinstance(value, date):
        return value.isoformat()

    text = str(value)
    if text == "":
        return EMPTY_TOKEN
    return unicodedata.normalize("NFC", text)


def canonical_row(values: Mapping[str, Any], fields: Iterable[str] | None = None) -> str:
    """Render a whole row in canonical form.

    `fields` restricts and orders the comparison. When omitted every key in the
    mapping is used, sorted by name.
    """
    names = sorted(fields) if fields is not None else sorted(values.keys())
    parts = [f"{name}{PAIR_SEPARATOR}{canonical_value(values.get(name))}" for name in names]
    return FIELD_SEPARATOR.join(parts)


def row_hash(values: Mapping[str, Any], fields: Iterable[str] | None = None) -> str:
    digest = hashlib.sha256(canonical_row(values, fields).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def dataset_hash(rows: Iterable[Mapping[str, Any]], fields: Iterable[str] | None = None) -> str:
    """A hash of a whole dataset that does not depend on row order.

    Row hashes are sorted before being folded together, so two runs that
    produce the same rows in a different order reconcile. Order is checked
    separately by row accounting, and conflating the two would hide a real
    reordering bug behind a passing hash.
    """
    field_list = list(fields) if fields is not None else None
    digests = sorted(row_hash(row, field_list) for row in rows)
    combined = hashlib.sha256()
    combined.update(CANONICAL_VERSION.encode("utf-8"))
    for digest in digests:
        combined.update(digest.encode("utf-8"))
    return f"sha256:{combined.hexdigest()}"


def reconcile(
    source_rows: Mapping[str, Mapping[str, Any]],
    destination_rows: Mapping[str, Mapping[str, Any]],
    fields: Iterable[str],
) -> dict[str, Any]:
    """Compare two keyed sets of rows by canonical hash.

    Returns the keys that are missing, unexpected, or present on both sides
    with different content. Field level evidence is produced only for the rows
    that actually differ, so a large dataset does not produce a large report.
    """
    field_list = list(fields)
    source_hashes = {key: row_hash(row, field_list) for key, row in source_rows.items()}
    destination_hashes = {
        key: row_hash(row, field_list) for key, row in destination_rows.items()
    }

    missing = sorted(set(source_hashes) - set(destination_hashes))
    unexpected = sorted(set(destination_hashes) - set(source_hashes))

    differing: list[dict[str, Any]] = []
    for key in sorted(set(source_hashes) & set(destination_hashes)):
        if source_hashes[key] == destination_hashes[key]:
            continue
        changed = [
            {
                "field": name,
                "source": canonical_value(source_rows[key].get(name)),
                "destination": canonical_value(destination_rows[key].get(name)),
            }
            for name in field_list
            if canonical_value(source_rows[key].get(name))
            != canonical_value(destination_rows[key].get(name))
        ]
        differing.append({"key": key, "fields": changed})

    return {
        "canonical_version": CANONICAL_VERSION,
        "source_row_count": len(source_rows),
        "destination_row_count": len(destination_rows),
        "matched": len(source_hashes) - len(missing) - len(differing),
        "missing": missing,
        "unexpected": unexpected,
        "differing": differing,
        "source_dataset_hash": dataset_hash(source_rows.values(), field_list),
        "destination_dataset_hash": dataset_hash(destination_rows.values(), field_list),
    }
