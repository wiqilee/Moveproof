"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  GitCommit,
  Hash,
  PauseCircle,
  Printer,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { checkStatusPresentation } from "@/domain/status";
import { serializeEvidence } from "@/data/api";
import { API_BASE_URL } from "@/lib/api-client";
import type { ApiEvidence } from "@/lib/api-types";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-ink-soft">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function EvidenceReportView({
  evidence,
  commitAllowed,
  onCommit,
  busy,
  pdfAvailable,
}: {
  evidence: ApiEvidence;
  commitAllowed: boolean;
  onCommit: () => void;
  busy: string | null;
  /** Reported by /health. A missing renderer disables the action rather than
   *  offering a button that leads to an error. */
  pdfAvailable: boolean;
}) {
  const [showJson, setShowJson] = useState(false);
  const committed = evidence.commit !== null;
  const summary = evidence.verification.summary;
  const json = serializeEvidence(evidence);

  const downloadJson = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${evidence.migration_id}-evidence.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const query = `?run_id=${evidence.run_id}`;
  const pdfHref = `${API_BASE_URL}/api/migrations/${evidence.migration_id}/report/pdf${query}`;
  const htmlHref = `${API_BASE_URL}/api/migrations/${evidence.migration_id}/report/html${query}`;

  return (
    <div>
      <div
        className={`mb-4 rounded-card border-none p-5 ${committed ? "bg-ok-soft" : "bg-warn-soft"}`}
      >
        <p
          className={`flex items-center gap-2 text-[15px] font-bold ${
            committed ? "text-ok" : "text-warn"
          }`}
        >
          {committed ? <CheckCircle2 size={17} aria-hidden /> : <PauseCircle size={17} aria-hidden />}
          {committed ? "Committed to the destination" : "Staged, not yet committed"}
        </p>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-soft">
          {committed
            ? `${evidence.commit?.written_rows} row(s) written, ${evidence.commit?.skipped_rows} skipped under the ${evidence.commit?.conflict_policy} policy.`
            : commitAllowed
              ? "Every mandatory check is satisfied. Commit is a separate deliberate action."
              : "Commit is blocked. At least one mandatory check has failed or awaits a decision."}
        </p>
      </div>

      <div className="mb-4 rounded-card border border-line bg-surface p-5">
        <p className="mb-2 text-xs font-semibold text-ink-soft">Migration record</p>
        <div className="grid gap-x-10 sm:grid-cols-2">
          <Field
            label="Migration"
            value={<span className="font-mono">{evidence.migration_id.slice(0, 8)}</span>}
          />
          <Field
            label="Run"
            value={<span className="font-mono">{evidence.run_id.slice(0, 8)}</span>}
          />
          <Field label="Source file" value={evidence.source_file.filename} />
          <Field
            label="Checksum"
            value={
              <span className="inline-flex items-center gap-1 font-mono text-xs">
                <Hash size={11} aria-hidden />
                {evidence.source_file.checksum.slice(7, 21)}
              </span>
            }
          />
          <Field
            label="Destination"
            value={`${evidence.destination.schema} ${evidence.destination.schema_version}`}
          />
          <Field label="Approved plan" value={`v${evidence.plan.version}`} />
          <Field label="Proposed by" value={evidence.plan.proposed_by} />
          <Field label="Staged at" value={evidence.execution.finished_at ?? "not staged"} />
          <Field label="Verified at" value={evidence.execution.verified_at ?? "not verified"} />
          <Field
            label="Committed at"
            value={evidence.commit?.committed_at ?? "not committed"}
          />
        </div>
        {evidence.plan.acknowledgements.length > 0 && (
          <p className="mt-3 border-t border-line pt-3 text-xs text-ink-soft">
            Acknowledged lossy operations:{" "}
            <span className="font-mono">{evidence.plan.acknowledgements.join(", ")}</span>
          </p>
        )}
      </div>

      <div className="mb-4 rounded-card border border-line bg-surface p-5">
        <p className="mb-2 text-xs font-semibold text-ink-soft">Row accounting</p>
        <p className="font-mono text-sm leading-loose">
          {evidence.row_accounting.arithmetic.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </p>
      </div>

      <div className="mb-4 overflow-hidden rounded-card border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-muted/60 px-4 py-2.5 text-xs">
          <span className="font-semibold text-ink-soft">Verification summary</span>
          <span className="text-ink-soft">
            {summary.passed} passed, {summary.failed} failed, {summary.review} review
            required, {summary.not_verified} not verified
          </span>
        </div>
        {evidence.verification.checks.map((check) => (
          <div
            key={check.check_id}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-sm"
          >
            <span>{check.name}</span>
            <StatusPill presentation={checkStatusPresentation[check.status]} />
          </div>
        ))}
      </div>

      {evidence.execution.transform_errors.length > 0 && (
        <div className="mb-4 rounded-card border border-line bg-surface p-5">
          <p className="mb-3 text-xs font-semibold text-ink-soft">Rejected rows</p>
          <ul className="space-y-2 text-sm">
            {evidence.execution.transform_errors.slice(0, 10).map((error, index) => (
              <li key={index} className="leading-relaxed">
                <span className="font-mono">{error.source_key}</span> ·{" "}
                <span className="font-mono text-ink-soft">{error.field}</span> ·{" "}
                {error.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-4 rounded-card border border-line bg-surface p-5">
        <p className="mb-3 text-xs font-semibold text-ink-soft">Human approvals</p>
        <ul className="space-y-2.5">
          {evidence.approvals.map((approval, index) => (
            <li key={index} className="text-sm">
              <p>{approval.action}</p>
              <p className="mt-0.5 font-mono text-xs text-ink-soft">
                {approval.approved_by} · {approval.approved_at}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-soft">
          These are audit entries, not cryptographic signatures.
        </p>
      </div>

      <div className="mb-5 rounded-card border border-line bg-surface p-5">
        <p className="mb-3 text-xs font-semibold text-ink-soft">
          Limitations and unverified properties
        </p>
        <ul className="space-y-2 text-sm leading-relaxed text-ink-soft">
          {evidence.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-ink-soft">{evidence.disclaimer}</p>
      </div>

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2.5">
          <Button variant="secondary" icon={Download} onClick={downloadJson}>
            Download JSON
          </Button>
          {pdfAvailable ? (
            <a
              href={pdfHref}
              className="inline-flex items-center gap-2 rounded-control border border-line bg-surface px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
            >
              <FileText size={15} aria-hidden />
              Download PDF
            </a>
          ) : (
            <span
              title="The backend reports that PDF generation is unavailable. Install reportlab and restart it."
              className="inline-flex cursor-not-allowed items-center gap-2 rounded-control border border-line bg-surface px-4 py-2.5 text-sm font-semibold opacity-45"
              aria-disabled="true"
            >
              <FileText size={15} aria-hidden />
              PDF unavailable
            </span>
          )}
          <a
            href={htmlHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-control border border-line bg-surface px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
          >
            <ExternalLink size={15} aria-hidden />
            Open HTML
          </a>
          <Button variant="ghost" icon={Printer} onClick={() => window.print()}>
            Print
          </Button>
          <Button variant="ghost" onClick={() => setShowJson((open) => !open)}>
            {showJson ? "Hide" : "Show"} canonical object
          </Button>
        </div>
        <Button
          icon={GitCommit}
          disabled={!commitAllowed || busy !== null}
          onClick={onCommit}
        >
          {committed ? "Committed" : commitAllowed ? "Commit migration" : "Commit blocked"}
        </Button>
      </div>

      {showJson && (
        <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface">
          <div className="bg-muted/60 px-4 py-2.5 text-xs font-semibold text-ink-soft">
            The single object behind this page, the JSON export and the PDF
          </div>
          <pre className="table-scroll max-h-96 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed">
            {json}
          </pre>
        </div>
      )}
    </div>
  );
}
