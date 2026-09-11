"""HTML rendering of the canonical evidence object.

A standalone document with inline styles, so it can be saved, emailed or
printed without a stylesheet travelling alongside it.

Every value from the evidence passes through `escape`. Source data is
untrusted: a cell containing a script tag or a spreadsheet formula must appear
as text in the report, not as markup.
"""

from __future__ import annotations

from html import escape
from typing import Any

STATUS_LABEL = {
    "passed": "Passed",
    "failed": "Failed",
    "review": "Review required",
    "not_verified": "Not verified",
}

STATUS_COLOR = {
    "passed": "#15803D",
    "failed": "#B91C1C",
    "review": "#B45309",
    "not_verified": "#475569",
}

STATUS_BG = {
    "passed": "#F0FDF4",
    "failed": "#FEF2F2",
    "review": "#FFFBEB",
    "not_verified": "#F1F5F9",
}

STYLES = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 40px 24px; background: #F7F8FA; color: #111827;
  font-family: Inter, -apple-system, "Segoe UI", system-ui, sans-serif;
  font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased;
}
.sheet { max-width: 840px; margin: 0 auto; background: #FFFFFF;
  border: 1px solid #E5E7EB; border-radius: 12px; padding: 40px; }
h1 { font-size: 26px; letter-spacing: -0.02em; margin: 0 0 4px; color: #172554; }
h2 { font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase;
  color: #64748B; margin: 34px 0 12px; font-weight: 600; }
.sub { color: #64748B; margin: 0 0 24px; }
.mono, code { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
  font-variant-numeric: tabular-nums; }
.outcome { padding: 14px 18px; border-radius: 10px; font-weight: 700; margin-bottom: 24px; }
.counts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px;
  background: #E5E7EB; border: 1px solid #E5E7EB; border-radius: 10px; overflow: hidden; }
.count { background: #FFFFFF; padding: 14px 16px; }
.count .n { font-size: 26px; font-weight: 700; line-height: 1;
  font-family: "JetBrains Mono", ui-monospace, monospace; }
.count .l { font-size: 12px; color: #64748B; margin-top: 6px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; background: #F1F5F9; color: #64748B; font-size: 11px;
  text-transform: uppercase; letter-spacing: 0.04em; padding: 8px 10px; font-weight: 600; }
td { padding: 9px 10px; border-top: 1px solid #E5E7EB; vertical-align: top; }
.kv { display: grid; grid-template-columns: 200px 1fr; gap: 4px 16px; font-size: 13px; }
.kv dt { color: #64748B; }
.kv dd { margin: 0; font-weight: 500; word-break: break-all; }
.pill { display: inline-block; padding: 2px 9px; border-radius: 999px;
  font-size: 11px; font-weight: 700; white-space: nowrap; }
.acct { background: #F1F5F9; border-radius: 10px; padding: 16px 18px; line-height: 2; }
.note { color: #64748B; font-size: 12px; margin-top: 10px; }
.scroll { overflow-x: auto; }
@media (max-width: 640px) {
  body { padding: 16px 12px; }
  .sheet { padding: 22px 18px; }
  .counts { grid-template-columns: repeat(2, 1fr); }
  .kv { grid-template-columns: 1fr; gap: 0 0; }
  .kv dt { margin-top: 8px; }
}
@media print {
  body { background: #FFFFFF; padding: 0; }
  .sheet { border: none; border-radius: 0; padding: 0; max-width: none; }
  h2 { break-after: avoid; }
  tr { break-inside: avoid; }
}
"""


def _pill(status: str) -> str:
    label = escape(STATUS_LABEL.get(status, status))
    return (
        f'<span class="pill" style="color:{STATUS_COLOR.get(status, "#475569")};'
        f'background:{STATUS_BG.get(status, "#F1F5F9")}">{label}</span>'
    )


def _kv(pairs: list[tuple[str, Any]]) -> str:
    rows = "".join(
        f"<dt>{escape(str(label))}</dt><dd>{escape(str(value))}</dd>"
        for label, value in pairs
    )
    return f'<dl class="kv">{rows}</dl>'


def build_html(evidence: dict[str, Any]) -> str:
    summary = evidence["verification"]["summary"]
    committed = evidence.get("commit") is not None
    source = evidence["source_file"]
    plan = evidence["plan"]

    outcome_style = (
        "background:#F0FDF4;color:#15803D" if committed else "background:#FFFBEB;color:#B45309"
    )
    outcome_text = "Committed to the destination" if committed else "Staged, not committed"

    counts = "".join(
        f'<div class="count"><div class="n" style="color:{color}">{value}</div>'
        f'<div class="l">{escape(label)}</div></div>'
        for label, value, color in [
            ("Passed", summary["passed"], "#15803D"),
            ("Failed", summary["failed"], "#B91C1C"),
            ("Review required", summary["review"], "#B45309"),
            ("Not verified", summary["not_verified"], "#475569"),
        ]
    )

    accounting = "<br>".join(
        escape(line) for line in evidence["row_accounting"]["arithmetic"]
    )

    mapping_rows = "".join(
        f"<tr><td class='mono'>{escape(m['source_column'])}</td>"
        f"<td>{escape(m['operation'])}</td>"
        f"<td class='mono'>{escape(m['destination_column'] or 'not written')}</td></tr>"
        for m in plan["mappings"]
    )

    check_rows = "".join(
        f"<tr><td><strong>{escape(c['name'])}</strong></td>"
        f"<td>{escape(c['expected'])}</td>"
        f"<td class='mono'>{escape(c['observed'])}</td>"
        f"<td>{_pill(c['status'])}</td></tr>"
        for c in evidence["verification"]["checks"]
    )

    discrepancy_section = ""
    if evidence["discrepancies"]:
        rows = "".join(
            f"<tr><td class='mono'>{escape(d['row_key'])}</td>"
            f"<td class='mono'>{escape(d['field'])}</td>"
            f"<td class='mono'>{escape(d['source_value'])}</td>"
            f"<td class='mono'>{escape(d['destination_value'])}</td></tr>"
            for d in evidence["discrepancies"][:200]
        )
        discrepancy_section = (
            "<h2>Discrepancies</h2><div class='scroll'><table>"
            "<tr><th>Row</th><th>Field</th><th>Source</th><th>Destination</th></tr>"
            f"{rows}</table></div>"
        )

    rejected_section = ""
    errors = evidence["execution"]["transform_errors"]
    if errors:
        rows = "".join(
            f"<tr><td class='mono'>{escape(e['source_key'])}</td>"
            f"<td class='mono'>{escape(e['field'])}</td>"
            f"<td>{escape(e['reason'])}</td></tr>"
            for e in errors[:100]
        )
        rejected_section = (
            "<h2>Rejected rows</h2><div class='scroll'><table>"
            "<tr><th>Row</th><th>Field</th><th>Reason</th></tr>"
            f"{rows}</table></div>"
        )

    approvals = "".join(
        f"<tr><td>{escape(a['action'])}</td>"
        f"<td class='mono'>{escape(a['approved_by'])}</td>"
        f"<td class='mono'>{escape(str(a['approved_at']))}</td></tr>"
        for a in evidence["approvals"]
    )

    commit_section = ""
    if committed:
        commit = evidence["commit"]
        commit_section = "<h2>Commit</h2>" + _kv(
            [
                ("Committed at", commit["committed_at"]),
                ("Committed by", commit["committed_by"]),
                ("Rows expected", commit["expected_rows"]),
                ("Rows written", commit["written_rows"]),
                ("Rows skipped", commit["skipped_rows"]),
                ("Conflict policy", commit["conflict_policy"]),
            ]
        )

    limitations = "".join(
        f"<li>{escape(item)}</li>" for item in evidence["limitations"]
    )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MoveProof evidence report {escape(evidence['migration_id'][:8])}</title>
<style>{STYLES}</style>
</head>
<body>
<div class="sheet">
  <h1>Evidence report</h1>
  <p class="sub">{escape(source['filename'])} into
     {escape(evidence['destination']['schema'])}
     {escape(evidence['destination']['schema_version'])}</p>

  <div class="outcome" style="{outcome_style}">{escape(outcome_text)}</div>

  <div class="counts">{counts}</div>

  <h2>Migration record</h2>
  {_kv([
      ("Migration", evidence["migration_id"]),
      ("Execution run", evidence["run_id"]),
      ("Source file", source["filename"]),
      ("Source checksum", source["checksum"]),
      ("Source size", f"{source['byte_size']} bytes"),
      ("Uploaded", source["uploaded_at"]),
      ("Approved plan", f"v{plan['version']}"),
      ("Proposed by", plan["proposed_by"]),
      ("Approved by", plan["approved_by"] or "not approved"),
      ("Contract hash", evidence["contract"]["hash"]),
      ("Staged at", evidence["execution"]["finished_at"] or "not staged"),
      ("Verified at", evidence["execution"]["verified_at"] or "not verified"),
  ])}

  <h2>Row accounting</h2>
  <div class="acct mono">{accounting}</div>

  <h2>Approved transformations</h2>
  <div class="scroll"><table>
    <tr><th>Source</th><th>Operation</th><th>Destination</th></tr>
    {mapping_rows}
  </table></div>
  {f'<p class="note">Acknowledged lossy operations: {escape(", ".join(plan["acknowledgements"]))}</p>' if plan["acknowledgements"] else ""}

  <h2>Verification results</h2>
  <div class="scroll"><table>
    <tr><th>Check</th><th>Expected</th><th>Observed</th><th>Status</th></tr>
    {check_rows}
  </table></div>

  {discrepancy_section}
  {rejected_section}

  <h2>Human approvals</h2>
  <div class="scroll"><table>
    <tr><th>Action</th><th>By</th><th>At</th></tr>
    {approvals}
  </table></div>
  <p class="note">These are audit entries, not cryptographic signatures.</p>

  {commit_section}

  <h2>Limitations</h2>
  <ul>{limitations}</ul>
  <p class="note">{escape(evidence['disclaimer'])}</p>
</div>
</body>
</html>"""
