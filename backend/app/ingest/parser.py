"""File ingestion.

Uploaded spreadsheets are untrusted input. This module reads them without
interpreting them: every cell arrives as a string, nothing is coerced to a
number or a date, and no formula is ever evaluated.

Type interpretation belongs to the approved plan. A parser that guesses is a
parser that can lose a leading zero before anybody has approved anything.
"""

from __future__ import annotations

import csv
import hashlib
import io
from dataclasses import dataclass
from datetime import date, datetime, time

from app.domain.types import SourceFile, SourceRow

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_ROWS = 200_000
MAX_COLUMNS = 256
MAX_CELL_CHARS = 32_768

SUPPORTED_ENCODINGS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")

# Cells starting with these characters are executed as formulas by Excel and
# Google Sheets when a CSV is opened. They are preserved verbatim on the way in
# and neutralised only on export, so the stored value stays faithful to source.
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


class ParseError(Exception):
    """Raised when a file cannot be read safely. Never swallowed silently."""


@dataclass
class ParsedFile:
    source_file: SourceFile
    rows: list[SourceRow]


def checksum_bytes(raw: bytes) -> str:
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def detect_encoding(raw: bytes) -> str:
    """Return the first encoding that decodes the whole file cleanly.

    Deliberately conservative and ordered. A mis-detected encoding corrupts
    names, which is the kind of silent damage this product is about.
    """
    for encoding in SUPPORTED_ENCODINGS:
        try:
            raw.decode(encoding)
            return encoding
        except UnicodeDecodeError:
            continue
    raise ParseError(
        "The file could not be decoded as UTF-8, CP1252 or Latin-1. "
        "Re-export it as UTF-8 and try again."
    )


def detect_delimiter(sample: str) -> str:
    """Sniff the delimiter, falling back to a comma rather than failing."""
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        return dialect.delimiter
    except csv.Error:
        return ","


def is_formula_like(value: str) -> bool:
    return bool(value) and value[0] in FORMULA_PREFIXES


def neutralise_for_export(value: str) -> str:
    """Prefix a formula-like value so a spreadsheet treats it as text.

    Used only when writing a file out. The stored value is never modified,
    because altering source data to make an export safe would be the same class
    of silent change the verifier is built to detect.
    """
    if is_formula_like(value):
        return "'" + value
    return value


def _validate_size(raw: bytes) -> None:
    if not raw:
        raise ParseError("The file is empty.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ParseError(
            f"The file is {len(raw)} bytes, above the {MAX_UPLOAD_BYTES} byte limit."
        )


def _validate_header(header: list[str]) -> tuple[str, ...]:
    cleaned = [h.strip() for h in header]
    if not cleaned or all(h == "" for h in cleaned):
        raise ParseError("The first row is empty, so no column names could be read.")
    if len(cleaned) > MAX_COLUMNS:
        raise ParseError(f"The file has {len(cleaned)} columns, above the {MAX_COLUMNS} limit.")

    seen: dict[str, int] = {}
    result: list[str] = []
    for index, name in enumerate(cleaned):
        base = name or f"column_{index + 1}"
        if base in seen:
            seen[base] += 1
            base = f"{base}_{seen[base]}"
        else:
            seen[base] = 0
        result.append(base)
    return tuple(result)


def _truncate(value: str) -> str:
    if len(value) > MAX_CELL_CHARS:
        raise ParseError(
            f"A cell holds {len(value)} characters, above the {MAX_CELL_CHARS} limit."
        )
    return value


def parse_csv(raw: bytes, filename: str) -> ParsedFile:
    _validate_size(raw)
    encoding = detect_encoding(raw)
    text = raw.decode(encoding)
    delimiter = detect_delimiter(text[:8192])

    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    try:
        header_row = next(reader)
    except StopIteration:
        raise ParseError("The file has no rows.") from None

    columns = _validate_header(header_row)
    rows: list[SourceRow] = []

    for index, raw_row in enumerate(reader, start=1):
        if index > MAX_ROWS:
            raise ParseError(f"The file has more than {MAX_ROWS} rows.")
        # A short row is padded and a long row is reported rather than silently
        # truncated, because losing a trailing column without saying so is
        # exactly the failure mode this product exists to surface.
        if len(raw_row) > len(columns):
            raise ParseError(
                f"Row {index} has {len(raw_row)} fields but the header declares "
                f"{len(columns)}. The file is malformed."
            )
        padded = list(raw_row) + [""] * (len(columns) - len(raw_row))
        values = {col: _truncate(padded[i].strip()) for i, col in enumerate(columns)}
        rows.append(SourceRow(row_number=index, values=values))

    source_file = SourceFile(
        filename=filename,
        checksum=checksum_bytes(raw),
        encoding=encoding,
        delimiter=delimiter,
        byte_size=len(raw),
        row_count=len(rows),
        column_count=len(columns),
        columns=columns,
    )
    return ParsedFile(source_file=source_file, rows=rows)


def _cell_text(cell: object) -> str:
    """One worksheet cell as text, without interpreting it.

    A date cell in a workbook is already a date: the spreadsheet stored a day,
    not a string that could be read two ways. openpyxl hands it back as a
    datetime at midnight, and str() of that is "2026-04-03 00:00:00", which no
    date policy accepts, so every row would be rejected. It is written here
    as the ISO date it already is. A cell that carries a time of day keeps it,
    and every other cell is passed through str() exactly as before.
    """
    if cell is None:
        return ""
    if isinstance(cell, datetime):
        if cell.time() == time(0, 0) and cell.tzinfo is None:
            return cell.date().isoformat()
        return str(cell)
    if isinstance(cell, date):
        return cell.isoformat()
    return str(cell)


def parse_xlsx(raw: bytes, filename: str) -> ParsedFile:
    """Read the first worksheet of an XLSX file.

    openpyxl is opened in read-only data mode with formulas left unevaluated.
    A cell holding a formula yields its stored string, never a computed result.
    """
    _validate_size(raw)
    try:
        from openpyxl import load_workbook
    except ImportError as exc:  # pragma: no cover
        raise ParseError("openpyxl is required to read XLSX files.") from exc

    try:
        workbook = load_workbook(
            io.BytesIO(raw), read_only=True, data_only=False, keep_links=False
        )
    except Exception as exc:
        raise ParseError(f"The XLSX file could not be opened: {exc}") from exc

    sheet = workbook.worksheets[0]
    iterator = sheet.iter_rows(values_only=True)

    try:
        header_row = next(iterator)
    except StopIteration:
        raise ParseError("The worksheet has no rows.") from None

    columns = _validate_header(["" if c is None else str(c) for c in header_row])
    rows: list[SourceRow] = []

    for index, raw_row in enumerate(iterator, start=1):
        if index > MAX_ROWS:
            raise ParseError(f"The worksheet has more than {MAX_ROWS} rows.")
        cells = [_cell_text(c) for c in raw_row]
        if len(cells) > len(columns):
            cells = cells[: len(columns)]
        padded = cells + [""] * (len(columns) - len(cells))
        if all(v.strip() == "" for v in padded):
            continue
        values = {col: _truncate(padded[i].strip()) for i, col in enumerate(columns)}
        rows.append(SourceRow(row_number=index, values=values))

    workbook.close()

    source_file = SourceFile(
        filename=filename,
        checksum=checksum_bytes(raw),
        encoding="xlsx",
        delimiter="n/a",
        byte_size=len(raw),
        row_count=len(rows),
        column_count=len(columns),
        columns=columns,
    )
    return ParsedFile(source_file=source_file, rows=rows)


def parse_upload(raw: bytes, filename: str) -> ParsedFile:
    lowered = filename.lower()
    if lowered.endswith(".csv") or lowered.endswith(".tsv"):
        return parse_csv(raw, filename)
    if lowered.endswith(".xlsx") or lowered.endswith(".xlsm"):
        return parse_xlsx(raw, filename)
    raise ParseError(
        f"Unsupported file type for {filename}. Upload a CSV, TSV, XLSX or XLSM file."
    )
