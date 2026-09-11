"""PDF generation from the canonical evidence object.

The same structure the on screen report and the JSON export render. Nothing
here recomputes a status, reformats a number, or adds a sentence the evidence
does not contain, which is what keeps the three formats from disagreeing.

Layout notes: the page is A4 with generous margins, every table has a repeated
header row so a long check list stays readable across pages, and the footer
carries the migration id, the run id and a page number so a printed sheet can
always be traced back.
"""

from __future__ import annotations

import io
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

NAVY = colors.HexColor("#172554")
BRAND = colors.HexColor("#3B82F6")
INK = colors.HexColor("#111827")
INK_SOFT = colors.HexColor("#64748B")
LINE = colors.HexColor("#E5E7EB")
MUTED = colors.HexColor("#F1F5F9")
OK = colors.HexColor("#15803D")
WARN = colors.HexColor("#B45309")
BAD = colors.HexColor("#B91C1C")
NEUTRAL = colors.HexColor("#475569")

STATUS_COLOR = {
    "passed": OK,
    "failed": BAD,
    "review": WARN,
    "not_verified": NEUTRAL,
}

STATUS_LABEL = {
    "passed": "Passed",
    "failed": "Failed",
    "review": "Review required",
    "not_verified": "Not verified",
}


def _tag(color: colors.Color) -> str:
    """Render a colour for a <font color> tag.

    reportlab's hexval() returns 0xrrggbb, which the markup parser rejects.
    The tag wants #rrggbb.
    """
    return "#" + color.hexval()[2:]


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=26,
            textColor=NAVY,
            alignment=TA_LEFT,
            spaceAfter=2,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=INK_SOFT,
        ),
        "heading": ParagraphStyle(
            "heading",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=15,
            textColor=NAVY,
            spaceBefore=14,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=13,
            textColor=INK,
        ),
        "muted": ParagraphStyle(
            "muted",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=11.5,
            textColor=INK_SOFT,
        ),
        "mono": ParagraphStyle(
            "mono",
            parent=base["Normal"],
            fontName="Courier",
            fontSize=8,
            leading=11,
            textColor=INK,
        ),
        "cell": ParagraphStyle(
            "cell",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=11,
            textColor=INK,
        ),
        "cellMono": ParagraphStyle(
            "cellMono",
            parent=base["Normal"],
            fontName="Courier",
            fontSize=7.5,
            leading=10.5,
            textColor=INK,
        ),
    }


def _key_value_table(rows: list[tuple[str, str]], styles) -> Table:
    data = [
        [Paragraph(label, styles["muted"]), Paragraph(str(value), styles["cell"])]
        for label, value in rows
    ]
    table = Table(data, colWidths=[45 * mm, 120 * mm])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("LINEBELOW", (0, 0), (-1, -2), 0.25, LINE),
            ]
        )
    )
    return table


def _status_chip(status: str, styles) -> Paragraph:
    color = STATUS_COLOR.get(status, NEUTRAL)
    label = STATUS_LABEL.get(status, status)
    return Paragraph(
        f'<font color="{_tag(color)}"><b>{label}</b></font>', styles["cell"]
    )


def build_pdf(evidence: dict[str, Any]) -> bytes:
    """Render the evidence object and return the PDF bytes."""
    styles = _styles()
    buffer = io.BytesIO()

    migration_short = evidence["migration_id"][:8]
    run_short = evidence["run_id"][:8]

    def decorate(canvas, doc) -> None:
        canvas.saveState()
        # Header rule
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(20 * mm, A4[1] - 16 * mm, A4[0] - 20 * mm, A4[1] - 16 * mm)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.setFillColor(NAVY)
        canvas.drawString(20 * mm, A4[1] - 13 * mm, "MoveProof")
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(INK_SOFT)
        canvas.drawRightString(
            A4[0] - 20 * mm, A4[1] - 13 * mm, "Evidence report"
        )
        # Footer
        canvas.setFont("Courier", 7)
        canvas.drawString(
            20 * mm, 12 * mm, f"migration {migration_short} · run {run_short}"
        )
        canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, f"page {doc.page}")
        canvas.restoreState()

    document = BaseDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=22 * mm,
        bottomMargin=18 * mm,
        title=f"MoveProof evidence report {migration_short}",
        author="MoveProof",
        subject="Data migration evidence",
    )
    frame = Frame(
        document.leftMargin,
        document.bottomMargin,
        document.width,
        document.height,
        id="body",
    )
    document.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=decorate)])

    story: list[Any] = []
    summary = evidence["verification"]["summary"]
    committed = evidence.get("commit") is not None

    # --- title -----------------------------------------------------------
    story.append(Paragraph("Evidence report", styles["title"]))
    story.append(
        Paragraph(
            f"{evidence['source_file']['filename']} into "
            f"{evidence['destination']['schema']} "
            f"{evidence['destination']['schema_version']}",
            styles["subtitle"],
        )
    )
    story.append(Spacer(1, 8))

    outcome = (
        "Committed to the destination"
        if committed
        else "Staged, not committed"
    )
    outcome_color = OK if committed else WARN
    story.append(
        Paragraph(
            f'<font color="{_tag(outcome_color)}" size="11"><b>{outcome}</b></font>',
            styles["body"],
        )
    )
    story.append(Spacer(1, 10))

    # --- summary counts --------------------------------------------------
    counts = Table(
        [
            [
                Paragraph("Passed", styles["muted"]),
                Paragraph("Failed", styles["muted"]),
                Paragraph("Review required", styles["muted"]),
                Paragraph("Not verified", styles["muted"]),
            ],
            [
                Paragraph(
                    f'<font color="{_tag(OK)}" size="16"><b>{summary["passed"]}</b></font>',
                    styles["body"],
                ),
                Paragraph(
                    f'<font color="{_tag(BAD)}" size="16"><b>{summary["failed"]}</b></font>',
                    styles["body"],
                ),
                Paragraph(
                    f'<font color="{_tag(WARN)}" size="16"><b>{summary["review"]}</b></font>',
                    styles["body"],
                ),
                Paragraph(
                    f'<font color="{_tag(NEUTRAL)}" size="16"><b>{summary["not_verified"]}</b></font>',
                    styles["body"],
                ),
            ],
        ],
        colWidths=[41 * mm] * 4,
    )
    counts.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), MUTED),
                ("BOX", (0, 0), (-1, -1), 0.25, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, LINE),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(counts)

    # --- record ----------------------------------------------------------
    story.append(Paragraph("Migration record", styles["heading"]))
    story.append(
        _key_value_table(
            [
                ("Migration", evidence["migration_id"]),
                ("Execution run", evidence["run_id"]),
                ("Source file", evidence["source_file"]["filename"]),
                ("Source checksum", evidence["source_file"]["checksum"]),
                ("Source size", f"{evidence['source_file']['byte_size']} bytes"),
                ("Uploaded", str(evidence["source_file"]["uploaded_at"])),
                ("Approved plan", f"v{evidence['plan']['version']}"),
                ("Proposed by", evidence["plan"]["proposed_by"]),
                ("Approved by", evidence["plan"]["approved_by"] or "not approved"),
                ("Contract", str(evidence["contract"].get("version", "")) + " " + str(evidence["contract"]["hash"])),
                ("Staged at", str(evidence["execution"]["finished_at"] or "not staged")),
                ("Verified at", str(evidence["execution"]["verified_at"] or "not verified")),
            ],
            styles,
        )
    )

    # --- row accounting --------------------------------------------------
    story.append(Paragraph("Row accounting", styles["heading"]))
    for line in evidence["row_accounting"]["arithmetic"]:
        story.append(Paragraph(line, styles["mono"]))

    # --- approved transformations ----------------------------------------
    story.append(Paragraph("Approved transformations", styles["heading"]))
    mapping_rows = [
        [
            Paragraph("<b>Source</b>", styles["cell"]),
            Paragraph("<b>Operation</b>", styles["cell"]),
            Paragraph("<b>Destination</b>", styles["cell"]),
        ]
    ]
    for mapping in evidence["plan"]["mappings"]:
        mapping_rows.append(
            [
                Paragraph(mapping["source_column"], styles["cellMono"]),
                Paragraph(mapping["operation"], styles["cell"]),
                Paragraph(mapping["destination_column"] or "not written", styles["cellMono"]),
            ]
        )
    mapping_table = Table(mapping_rows, colWidths=[45 * mm, 70 * mm, 50 * mm], repeatRows=1)
    mapping_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), MUTED),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, -1), 0.25, LINE),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.append(mapping_table)
    if evidence["plan"]["acknowledgements"]:
        story.append(Spacer(1, 5))
        story.append(
            Paragraph(
                "Acknowledged lossy operations: "
                + ", ".join(evidence["plan"]["acknowledgements"]),
                styles["muted"],
            )
        )

    # --- verification ----------------------------------------------------
    story.append(PageBreak())
    story.append(Paragraph("Verification results", styles["heading"]))
    check_rows = [
        [
            Paragraph("<b>Check</b>", styles["cell"]),
            Paragraph("<b>Expected</b>", styles["cell"]),
            Paragraph("<b>Observed</b>", styles["cell"]),
            Paragraph("<b>Status</b>", styles["cell"]),
        ]
    ]
    for check in evidence["verification"]["checks"]:
        check_rows.append(
            [
                Paragraph(check["name"], styles["cell"]),
                Paragraph(check["expected"], styles["cell"]),
                Paragraph(check["observed"], styles["cell"]),
                _status_chip(check["status"], styles),
            ]
        )
    check_table = Table(
        check_rows, colWidths=[38 * mm, 46 * mm, 55 * mm, 26 * mm], repeatRows=1
    )
    check_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), MUTED),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, -1), 0.25, LINE),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.append(check_table)

    # --- discrepancies ---------------------------------------------------
    if evidence["discrepancies"]:
        story.append(Paragraph("Discrepancies", styles["heading"]))
        rows = [
            [
                Paragraph("<b>Row</b>", styles["cell"]),
                Paragraph("<b>Field</b>", styles["cell"]),
                Paragraph("<b>Source</b>", styles["cell"]),
                Paragraph("<b>Destination</b>", styles["cell"]),
            ]
        ]
        for entry in evidence["discrepancies"][:60]:
            rows.append(
                [
                    Paragraph(entry["row_key"], styles["cellMono"]),
                    Paragraph(entry["field"], styles["cellMono"]),
                    Paragraph(entry["source_value"], styles["cellMono"]),
                    Paragraph(entry["destination_value"], styles["cellMono"]),
                ]
            )
        table = Table(rows, colWidths=[30 * mm, 35 * mm, 50 * mm, 50 * mm], repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), MUTED),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.25, LINE),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        story.append(table)
        if len(evidence["discrepancies"]) > 60:
            story.append(Spacer(1, 4))
            story.append(
                Paragraph(
                    f"Showing 60 of {len(evidence['discrepancies'])} discrepancies. "
                    "The JSON export carries the full set.",
                    styles["muted"],
                )
            )

    # --- rejected rows ---------------------------------------------------
    errors = evidence["execution"]["transform_errors"]
    if errors:
        story.append(Paragraph("Rejected rows", styles["heading"]))
        for error in errors[:40]:
            story.append(
                Paragraph(
                    f"{error['source_key']} · {error['field']} · {error['reason']}",
                    styles["mono"],
                )
            )

    # --- approvals -------------------------------------------------------
    story.append(Paragraph("Human approvals", styles["heading"]))
    for approval in evidence["approvals"]:
        story.append(Paragraph(approval["action"], styles["body"]))
        story.append(
            Paragraph(
                f"{approval['approved_by']} · {approval['approved_at']}", styles["muted"]
            )
        )
        story.append(Spacer(1, 3))
    story.append(
        Paragraph(
            "These are audit entries, not cryptographic signatures.", styles["muted"]
        )
    )

    # --- commit ----------------------------------------------------------
    if evidence.get("commit"):
        commit = evidence["commit"]
        story.append(Paragraph("Commit", styles["heading"]))
        story.append(
            _key_value_table(
                [
                    ("Committed at", str(commit["committed_at"])),
                    ("Committed by", commit["committed_by"]),
                    ("Rows expected", str(commit["expected_rows"])),
                    ("Rows written", str(commit["written_rows"])),
                    ("Rows skipped", str(commit["skipped_rows"])),
                    ("Conflict policy", commit["conflict_policy"]),
                ],
                styles,
            )
        )

    # --- limitations -----------------------------------------------------
    limitations: list[Any] = [Paragraph("Limitations", styles["heading"])]
    for limitation in evidence["limitations"]:
        limitations.append(Paragraph(f"• {limitation}", styles["body"]))
    if evidence["not_verified"]:
        limitations.append(Spacer(1, 4))
        limitations.append(
            Paragraph(
                "Properties reported as not verified: "
                + ", ".join(evidence["not_verified"]),
                styles["body"],
            )
        )
    limitations.append(Spacer(1, 5))
    limitations.append(Paragraph(evidence["disclaimer"], styles["muted"]))
    story.append(KeepTogether(limitations))

    document.build(story)
    return buffer.getvalue()
