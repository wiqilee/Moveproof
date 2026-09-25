"""CSV export of the verified transformed dataset.

This file answers a different question from the evidence reports. JSON, HTML
and PDF describe what happened to the data. This describes the data itself:
the exact transformed rows that passed verification.

Two rules govern it.

**Values are rendered, never reinterpreted.** A Decimal is written with its
stored scale, a date as ISO, a None as an empty field. Nothing is parsed again
on the way out, because a second interpretation is a second chance to lose a
leading zero, and preserving `00127` is the entire point of the product.

**Only destination columns appear.** The schema decides the header and the
order. Internal identifiers, run ids and row dispositions are not part of the
dataset a user asked for.
"""

from __future__ import annotations

import csv
import io
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable, Mapping

from app.domain.types import DestinationSchema
from app.ingest.parser import neutralise_for_export


def render_value(value: Any) -> str:
    """Render one stored value as a CSV field.

    An identifier is written exactly as stored. `00127` is a string in staging
    and stays a string here; there is no numeric path it can fall down.
    """
    if value is None:
        return ""

    if isinstance(value, bool):
        return "true" if value else "false"

    if isinstance(value, Decimal):
        # format(..., "f") avoids exponent notation, which a spreadsheet would
        # reopen as a float and round. The stored scale is preserved, so
        # 1200.50 does not become 1200.5.
        return format(value, "f")

    if isinstance(value, (datetime, date)):
        return value.isoformat()

    if isinstance(value, float):
        # A float should never reach staging for an exact quantity. If one
        # does, failing loudly is better than writing a rounded figure into a
        # file the user will treat as authoritative.
        raise TypeError(
            "A float reached the CSV export. Exact quantities must be Decimal."
        )

    return str(value)


def build_csv(
    rows: Iterable[Mapping[str, Any]],
    schema: DestinationSchema,
) -> str:
    """Render the verified rows as CSV text.

    Formula-like string values are neutralised here and only here. Typed
    numeric, date and boolean values are rendered directly. The stored value
    keeps whatever the source contained, so the verifier still compares against
    the truth, while untrusted text in the exported file cannot execute a
    spreadsheet formula when opened.
    """
    columns = [column.name for column in schema.columns]

    buffer = io.StringIO()
    # QUOTE_MINIMAL with the default dialect quotes any field containing a
    # comma, a quote or a newline, and doubles embedded quotes. lineterminator
    # is set explicitly so the output does not depend on the host platform.
    writer = csv.writer(buffer, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    writer.writerow(columns)

    for row in rows:
        rendered_row: list[str] = []
        for column in columns:
            value = row.get(column)
            rendered = render_value(value)

            # Spreadsheet-formula protection applies to untrusted text only.
            # Typed Decimal/date/bool values cannot contain spreadsheet formulas,
            # so their exact rendered representation must remain unchanged.
            rendered_row.append(
                neutralise_for_export(rendered)
                if isinstance(value, str)
                else rendered
            )

        writer.writerow(rendered_row)

    return buffer.getvalue()


def export_filename(migration_id: str, source_filename: str | None = None) -> str:
    """A filename that identifies the migration it came from.

    The migration id is included rather than only the original name, because
    two runs of the same spreadsheet produce two different verified datasets
    and a user should not have to guess which file is which.
    """
    stem = "dataset"
    if source_filename:
        cleaned = source_filename.rsplit("/", 1)[-1]
        for suffix in (".csv", ".tsv", ".xlsx", ".xlsm"):
            if cleaned.lower().endswith(suffix):
                cleaned = cleaned[: -len(suffix)]
                break
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in cleaned)
        stem = safe.strip("-") or "dataset"

    return f"moveproof-{migration_id[:8]}-{stem}-verified.csv"
