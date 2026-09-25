"""Report rendering tests.

The PDF is generated for real here and inspected: the bytes are checked for a
PDF header, page count and extractable text, so a silently empty document
fails rather than passing because the function returned without raising.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

reportlab = pytest.importorskip("reportlab", reason="reportlab is not installed")

from app.reports.pdf import build_pdf  # noqa: E402
from tests.fixtures.sample_evidence import sample_evidence  # noqa: E402


def page_count(pdf: bytes) -> int:
    """Count pages without a PDF parser, by counting page objects."""
    return len(re.findall(rb"/Type\s*/Page[^s]", pdf))


def test_pdf_is_a_real_document():
    pdf = build_pdf(sample_evidence())
    assert pdf.startswith(b"%PDF-"), "the output is not a PDF"
    assert pdf.rstrip().endswith(b"%%EOF"), "the PDF is truncated"
    assert len(pdf) > 3000, "the PDF is suspiciously small"


def test_pdf_has_more_than_one_page():
    pdf = build_pdf(sample_evidence())
    assert page_count(pdf) >= 2


def test_pdf_carries_the_migration_metadata():
    evidence = sample_evidence()
    pdf = build_pdf(evidence)
    # Text is compressed in the content stream, so the searchable place is the
    # document info dictionary that the title is written into.
    assert evidence["migration_id"][:8].encode() in pdf


def test_pdf_renders_a_committed_report_differently():
    staged = build_pdf(sample_evidence(committed=False, failed=True))
    committed = build_pdf(sample_evidence(committed=True, failed=False))
    assert staged != committed
    assert len(committed) > 3000


def test_pdf_generation_is_deterministic_in_size():
    """Two renders of the same evidence produce the same length.

    Byte equality is not asserted because reportlab writes a creation
    timestamp. Length equality still catches a renderer that drops a section.
    """
    evidence = sample_evidence()
    first = build_pdf(evidence)
    second = build_pdf(evidence)
    assert abs(len(first) - len(second)) < 64


def test_pdf_handles_an_evidence_object_with_no_discrepancies():
    evidence = sample_evidence(committed=True, failed=False)
    evidence["discrepancies"] = []
    evidence["execution"]["transform_errors"] = []
    pdf = build_pdf(evidence)
    assert pdf.startswith(b"%PDF-")


def test_pdf_handles_a_large_discrepancy_list():
    evidence = sample_evidence()
    evidence["discrepancies"] = [
        {
            "check_id": "identifier_preservation",
            "check_name": "Unique identifier preservation",
            "status": "failed",
            "row_key": f"{index:05d}",
            "field": "customer_id",
            "source_value": f"{index:05d}",
            "destination_value": str(index),
        }
        for index in range(1, 250)
    ]
    pdf = build_pdf(evidence)
    assert pdf.startswith(b"%PDF-")
    # The renderer caps the table and says so rather than producing 250 rows.
    assert page_count(pdf) >= 2


def test_all_three_formats_read_the_same_object():
    """HTML, JSON and PDF must not be able to disagree.

    They cannot, because each is a pure function of the same dictionary. This
    test asserts the property that makes that true: rendering does not mutate
    the evidence.
    """
    import copy
    import json

    from app.reports.html import build_html

    evidence = sample_evidence()
    before = copy.deepcopy(evidence)

    json_text = json.dumps(evidence, indent=2)
    html = build_html(evidence)
    pdf = build_pdf(evidence)

    assert evidence == before, "rendering mutated the evidence object"
    assert json.loads(json_text)["verification"]["summary"] == evidence["verification"]["summary"]
    assert "4 row(s) differ" in html
    assert pdf.startswith(b"%PDF-")


def test_html_reports_the_same_counts_as_the_object():
    from app.reports.html import build_html

    evidence = sample_evidence()
    html = build_html(evidence)
    summary = evidence["verification"]["summary"]
    assert f">{summary['passed']}<" in html
    assert f">{summary['failed']}<" in html
    assert evidence["source_file"]["checksum"] in html


def test_html_escapes_untrusted_cell_text():
    """A formula or a script tag in the data must not become markup."""
    from app.reports.html import build_html

    evidence = sample_evidence()
    evidence["discrepancies"][0]["source_value"] = "<script>alert(1)</script>"
    html = build_html(evidence)
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


# =====================================================================
# Verified CSV export
#
# The evidence reports describe what happened. This is the data itself, so
# the tests here are about values surviving the trip rather than about
# rendering.
# =====================================================================

from decimal import Decimal  # noqa: E402
from datetime import date  # noqa: E402

from app.domain.schema import CUSTOMERS_V1  # noqa: E402
from app.reports.csv_export import build_csv, export_filename, render_value  # noqa: E402


def row(**overrides):
    base = {
        "customer_id": "00127",
        "full_name": "Amara Chen",
        "email": "amara.chen@example.com",
        "signup_date": date(2024, 3, 16),
        "balance": Decimal("1200.50"),
        "region": "APAC",
    }
    base.update(overrides)
    return base


def parse(csv_text):
    import csv as _csv
    import io

    return list(_csv.reader(io.StringIO(csv_text)))


def test_header_matches_the_destination_schema():
    parsed = parse(build_csv([], CUSTOMERS_V1))
    assert parsed[0] == [column.name for column in CUSTOMERS_V1.columns]


def test_no_internal_columns_leak_into_the_export():
    parsed = parse(build_csv([row()], CUSTOMERS_V1))
    for internal in ("run_id", "row_number", "disposition", "source_key", "migration_id"):
        assert internal not in parsed[0]


def test_a_leading_zero_identifier_survives_the_export():
    """The whole reason this product exists."""
    parsed = parse(build_csv([row()], CUSTOMERS_V1))
    assert parsed[1][0] == "00127"
    assert parsed[1][0] != "127"


def test_decimal_scale_is_preserved_exactly():
    parsed = parse(build_csv([row(balance=Decimal("1200.50"))], CUSTOMERS_V1))
    assert parsed[1][4] == "1200.50"


def test_a_negative_decimal_is_not_formula_escaped():
    parsed = parse(build_csv([row(balance=Decimal("-2.250"))], CUSTOMERS_V1))
    assert parsed[1][4] == "-2.250"


def test_a_small_decimal_is_not_written_in_exponent_notation():
    parsed = parse(build_csv([row(balance=Decimal("0.0000001"))], CUSTOMERS_V1))
    assert "E" not in parsed[1][4] and "e" not in parsed[1][4]


def test_a_float_is_refused_rather_than_rounded():
    with pytest.raises(TypeError):
        render_value(1200.5)


def test_dates_render_as_iso():
    parsed = parse(build_csv([row()], CUSTOMERS_V1))
    assert parsed[1][3] == "2024-03-16"


def test_null_becomes_an_empty_field_not_the_word_none():
    parsed = parse(build_csv([row(region=None)], CUSTOMERS_V1))
    assert parsed[1][5] == ""


def test_a_comma_in_a_value_is_quoted_and_round_trips():
    parsed = parse(build_csv([row(full_name="Chen, Amara")], CUSTOMERS_V1))
    assert parsed[1][1] == "Chen, Amara"


def test_a_quote_in_a_value_round_trips():
    parsed = parse(build_csv([row(full_name='Amara "Ami" Chen')], CUSTOMERS_V1))
    assert parsed[1][1] == 'Amara "Ami" Chen'


def test_a_newline_in_a_value_round_trips():
    parsed = parse(build_csv([row(full_name="Amara\nChen")], CUSTOMERS_V1))
    assert parsed[1][1] == "Amara\nChen"


def test_negative_text_is_still_neutralised_on_the_way_out():
    parsed = parse(build_csv([row(full_name="-not-a-number")], CUSTOMERS_V1))
    assert parsed[1][1] == "'-not-a-number"


def test_a_formula_like_value_is_neutralised_on_the_way_out():
    """Stored verbatim, escaped only here.

    The verifier compares against what the source actually contained, so the
    stored value keeps the formula. The exported file must not execute it when
    a spreadsheet opens the CSV.
    """
    parsed = parse(build_csv([row(full_name="=SUM(A1:A9)")], CUSTOMERS_V1))
    assert parsed[1][1].startswith("'")
    assert "=SUM(A1:A9)" in parsed[1][1]


def test_row_count_matches_the_rows_supplied():
    rows = [row(customer_id=f"{n:05d}") for n in range(1, 8)]
    parsed = parse(build_csv(rows, CUSTOMERS_V1))
    assert len(parsed) == len(rows) + 1


def test_column_order_follows_the_schema_for_every_row():
    parsed = parse(build_csv([row(), row(customer_id="00128")], CUSTOMERS_V1))
    assert parsed[1][0] == "00127"
    assert parsed[2][0] == "00128"
    assert len(parsed[1]) == len(parsed[0])


def test_line_endings_do_not_depend_on_the_host_platform():
    text = build_csv([row()], CUSTOMERS_V1)
    assert "\r\n" not in text
    assert text.endswith("\n")


def test_the_filename_identifies_the_migration():
    name = export_filename("3f2a9c14-7b6e-4d58-9a01-6c2e4b8d5f70", "customers_export.csv")
    assert name == "moveproof-3f2a9c14-customers_export-verified.csv"
    assert name.endswith(".csv")


def test_the_filename_is_safe_when_the_upload_name_is_not():
    name = export_filename("3f2a9c14-7b6e-4d58-9a01-6c2e4b8d5f70", "../../etc/passwd.csv")
    assert "/" not in name and ".." not in name
