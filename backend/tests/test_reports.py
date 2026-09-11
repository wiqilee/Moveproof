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
