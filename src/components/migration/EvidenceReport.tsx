"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  Info,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  GitCommit,
  Hash,
  PauseCircle,
  Printer,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { checkStatusPresentation } from "@/domain/status";
import { serializeEvidence } from "@/data/api";
import { API_BASE_URL, api } from "@/lib/api-client";
import type { ApiEvidence } from "@/lib/api-types";
import type { ErrorState } from "@/lib/migration-store";
import { routes } from "@/lib/routes";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-ink-soft">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

/**
 * One group of the audit record.
 *
 * Every section carries a number and a one-line statement of what it proves,
 * so the document reads as a record rather than a page of panels. `tone`
 * changes the header only: nothing here decides a status.
 */
function Section({
  step,
  title,
  proves,
  tone = "neutral",
  children,
}: {
  step: number;
  title: string;
  proves: string;
  tone?: "neutral" | "ok" | "warn" | "bad";
  children: ReactNode;
}) {
  const header =
    tone === "ok"
      ? "border-ok/20 bg-ok-soft/60"
      : tone === "warn"
        ? "border-warn/20 bg-warn-soft/60"
        : tone === "bad"
          ? "border-bad/20 bg-bad-soft/60"
          : "border-line bg-muted/40";

  return (
    <section className="mb-4 overflow-hidden rounded-card border border-line bg-surface shadow-sm">
      <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-5 py-3 ${header}`}>
        <span className="font-mono text-[11px] font-semibold tabular-nums text-ink-soft">
          {String(step).padStart(2, "0")}
        </span>
        <h3 className="text-[13px] font-semibold tracking-[-0.01em]">{title}</h3>
        <p className="w-full text-[11px] leading-relaxed text-ink-soft sm:w-auto sm:flex-1">
          {proves}
        </p>
      </div>
      {children}
    </section>
  );
}

export function EvidenceReportView({
  evidence,
  commitAllowed,
  onCommit,
  onRefresh,
  commitError,
  /** The store's own record of a commit that returned successfully. */
  committedSignal = false,
  busy,
  pdfAvailable,
}: {
  evidence: ApiEvidence;
  commitAllowed: boolean;
  /** Resolves false when the attempt was refused, so the page can say why. */
  onCommit: () => Promise<boolean> | void;
  /** Reloads the evidence so `commit` can settle an ambiguous failure. */
  /**
   * Reloads the evidence so `commit` can settle an ambiguous outcome.
   * Resolves true when the reload succeeded and the evidence is authoritative.
   */
  onRefresh: () => Promise<boolean>;
  /**
   * The store's error after a failed attempt, carrying the backend's own
   * classification. Only `commit_gate` establishes that the destination
   * refused the write; everything else failed for some other reason and must
   * not be described as a conflict.
   */
  commitError?: ErrorState | null;
  committedSignal?: boolean;
  busy: string | null;
  /** Reported by /health. A missing renderer disables the action rather than
   *  offering a button that leads to an error. */
  pdfAvailable: boolean;
}) {
  const [showJson, setShowJson] = useState(false);
  /**
   * A commit that verification allowed but the database refused.
   *
   * Verification and commit answer different questions. Every check can pass
   * and the destination can still already hold a matching row, which the gate
   * refuses fail-closed. The page has to say that plainly rather than keep
   * showing "Ready to commit" beside a red banner.
   */
  const [commitAttemptFailed, setCommitAttemptFailed] = useState(false);
  const [failureDismissed, setFailureDismissed] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  // `evidence.commit` is the artifact record. `committedSignal` is what the
  // store knows about the request that just returned. They disagree for one
  // real case: the commit succeeded and the evidence reload afterwards failed.
  const committedInEvidence = evidence.commit !== null;
  const committed = committedInEvidence;
  const commitPendingEvidence = committedSignal && !committedInEvidence;

  // Only a mandatory check gates a commit. The summary totals count advisory
  // findings too, so deriving the section tone from them made an advisory
  // failure look like a blocker.
  const mandatoryBlockers = evidence.verification.checks.filter(
    (check) =>
      check.mandatory !== false &&
      (check.status === "failed" || check.status === "review")
  );
  const advisoryFindings = evidence.verification.checks.filter(
    (check) =>
      check.mandatory === false &&
      (check.status === "failed" || check.status === "review")
  );

  // 6. The hardware boundary belongs to the robotics destination only.
  // Lets a discrepancy say whether its check gates a commit.
  const checkById = new Map(
    evidence.verification.checks.map((check) => [check.check_id, check])
  );

  // A discrepancy inherits the standing of the check it came from. An id with
  // no matching check is unclassified, never assumed to be a blocker.
  const gateOf = (checkId: string): "mandatory" | "advisory" | "unknown" => {
    const check = checkById.get(checkId);
    if (!check) return "unknown";
    return check.mandatory === false ? "advisory" : "mandatory";
  };

  const discrepancyTone = evidence.discrepancies.some(
    (item) => gateOf(item.check_id) === "mandatory" && item.status === "failed"
  )
    ? "bad"
    : evidence.discrepancies.some(
          (item) => gateOf(item.check_id) === "mandatory" && item.status === "review"
        )
      ? "warn"
      : "neutral";

  const isRobotics = evidence.destination.profile === "robot_calibration_v1";

  const refreshStatus = async () => {
    // A refresh that succeeds settles the question either way: the reloaded
    // evidence either records a commit or does not. Leaving the uncertain
    // state standing after that would keep saying "could not be confirmed"
    // about something now confirmed. A refresh that fails changes nothing.
    setFailureDismissed(false);
    const refreshed = await onRefresh();
    if (refreshed) setCommitAttemptFailed(false);
  };

  const attemptCommit = async () => {
    setFailureDismissed(false);
    const outcome = await onCommit();
    if (outcome === false) setCommitAttemptFailed(true);
    else if (outcome === true) setCommitAttemptFailed(false);
  };

  // The gate refused the write. `commit_gate` covers every CommitRefused the
  // backend raises: already committed, rolled back, a stale approved plan, a
  // contract mismatch, missing or stale verification, outstanding mandatory
  // checks, and destination conflicts among them. The API exposes no subtype,
  // so the page reports the refusal and shows the backend's own detail rather
  // than naming a cause it cannot know.
  const gateBlocked = commitAttemptFailed && commitError?.kind === "commit_gate";
  // Anything else: network, server fault, workflow state. Real, but not a
  // conflict, and the page must not imply one.
  // Not a gate refusal, so the request failed for some other reason and the
  // destination state is unknown to this client until evidence is reloaded.
  const otherFailure = commitAttemptFailed && !gateBlocked;
  const outcomeUnconfirmed = otherFailure;
  const summary = evidence.verification.summary;
  const json = serializeEvidence(evidence);

  // Sections are numbered as they render, so a skipped group never leaves a
  // gap like 01, 02, 03, 05.
  let sectionNumber = 0;
  const nextStep = () => (sectionNumber += 1);

  const downloadJson = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${evidence.migration_id}-evidence.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadVerifiedCsv = async () => {
    setCsvBusy(true);
    setCsvError(null);

    try {
      const file = await api.exportVerifiedCsv(evidence.migration_id);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = file.filename;
      anchor.style.display = "none";

      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setCsvError(
        error instanceof Error
          ? error.message
          : "Could not download the verified CSV."
      );
    } finally {
      setCsvBusy(false);
    }
  };

  const query = `?run_id=${evidence.run_id}`;
  const pdfHref = `${API_BASE_URL}/api/migrations/${evidence.migration_id}/report/pdf${query}`;
  const htmlHref = `${API_BASE_URL}/api/migrations/${evidence.migration_id}/report/html${query}`;

  return (
    <div>
      {committed ? (
        /* The workflow is finished. Say so, and say what can be done next,
           rather than leaving a changed button as the only signal. */
        <div className="mb-4 overflow-hidden rounded-card border border-ok/30 bg-surface shadow-sm">
          <div className="flex flex-wrap items-center gap-3 bg-ok-soft px-5 py-4">
            <CheckCircle2 size={20} className="shrink-0 text-ok" aria-hidden />
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-ok">
                Migration committed successfully
              </p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">
                {evidence.commit?.written_rows} row(s) written to{" "}
                <span className="font-mono">{evidence.destination.schema}</span>,{" "}
                {evidence.commit?.skipped_rows} skipped under the{" "}
                {evidence.commit?.conflict_policy} policy.{" "}
                {advisoryFindings.length > 0
                  ? "Mandatory verification gates were satisfied. Advisory findings remain reported below."
                  : "Every mandatory gate was satisfied and no advisory finding was raised."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 px-5 py-3">
            <Link
              href={routes.migrations}
              className="inline-flex items-center gap-2 rounded-control border border-line bg-surface px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
            >
              Back to migrations
            </Link>
            <Link
              href={routes.newMigration}
              className="inline-flex items-center gap-2 rounded-control border border-line bg-surface px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
            >
              Start a new migration
            </Link>
          </div>
        </div>
      ) : commitPendingEvidence ? (
        <div className="mb-4 overflow-hidden rounded-card border border-warn/30 bg-surface shadow-sm">
          <div className="flex flex-wrap items-start gap-3 bg-warn-soft px-5 py-4">
            <RefreshCw size={20} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-warn">
                Commit succeeded — evidence refresh pending
              </p>
              <p className="mt-0.5 max-w-3xl text-sm leading-relaxed text-ink-soft">
                The destination commit returned successfully. Refresh the
                canonical evidence record before relying on the artifact
                metadata below. No row counts are shown here, because the
                evidence object does not carry them yet.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 px-5 py-3">
            <Button
              variant="secondary"
              icon={RefreshCw}
              onClick={() => void refreshStatus()}
              disabled={busy !== null}
            >
              Refresh evidence
            </Button>
          </div>
        </div>
      ) : gateBlocked && !failureDismissed ? (
        <div className="mb-4 overflow-hidden rounded-card border border-bad/30 bg-surface shadow-sm">
          <div className="flex flex-wrap items-start gap-3 bg-bad-soft px-5 py-4">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-bad" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-bad">
                Verified — commit blocked
              </p>
              <p className="mt-0.5 max-w-3xl text-sm leading-relaxed text-ink-soft">
                This migration passed verification, but the commit gate refused
                the write. The exact reason is below.
              </p>
              {commitError && (
                <p className="mt-2 max-w-3xl rounded-control bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
                  {commitError.detail}
                </p>
              )}
            </div>
          </div>
          <div className="px-5 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              What to do next
            </p>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-ink-soft">
              <li>Read the exact refusal above; it names the condition.</li>
              <li>Resolve that condition, then refresh this migration.</li>
              <li>
                Commit again once the refusal no longer applies. The gate fails
                closed, so a retry cannot write twice.
              </li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={routes.migrations}
                className="inline-flex items-center gap-2 rounded-control border border-line bg-surface px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
              >
                Back to migrations
              </Link>
              <Button variant="ghost" onClick={() => setFailureDismissed(true)}>
                Hide this message
              </Button>
            </div>
            {/* Dismissing hides text. It does not change anything. */}
            <p className="mt-2 text-xs text-ink-soft">
              Hiding this message changes nothing. The refusal stands until the
              condition it names is resolved.
            </p>
          </div>
        </div>
      ) : otherFailure && !failureDismissed ? (
        <div className="mb-4 overflow-hidden rounded-card border border-warn/30 bg-surface shadow-sm">
          <div className="flex flex-wrap items-start gap-3 bg-warn-soft px-5 py-4">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-warn">
                Commit outcome could not be confirmed
              </p>
              <p className="mt-0.5 max-w-3xl text-sm leading-relaxed text-ink-soft">
                {commitError?.title ?? "The request did not complete normally."}{" "}
                Verification remains recorded, but this client cannot determine
                from the failed response whether the destination commit
                completed. Refresh before attempting another commit.
              </p>
              {/* The shared network copy says things like "your work is
                  unchanged and you can retry". True for a read, unsafe for a
                  commit: the server may have written before the response was
                  lost. Only the title is shown here, and the reassurance is
                  left out rather than repeated. */}
              {commitError?.kind && commitError.kind !== "network" && (
                <p className="mt-2 max-w-3xl rounded-control bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
                  {commitError.detail}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-5 py-3">
            {/* Refresh first. Offering a retry before the real state is known
                is how a second write gets attempted against a destination that
                may already hold the rows. */}
            <Button
              variant="secondary"
              icon={RefreshCw}
              onClick={() => void refreshStatus()}
              disabled={busy !== null}
            >
              Refresh commit status
            </Button>
            <Link
              href={routes.migrations}
              className="inline-flex items-center gap-2 rounded-control border border-line bg-surface px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
            >
              Back to migrations
            </Link>
            <Button variant="ghost" onClick={() => setFailureDismissed(true)}>
              Hide this message
            </Button>
          </div>
          <p className="border-t border-line bg-muted/30 px-5 py-2.5 text-xs text-ink-soft">
            Hiding this message changes nothing, and it does not establish
            whether the commit completed. Refresh to find out.
          </p>
        </div>
      ) : (
        <div className="mb-4 rounded-card border-none bg-warn-soft p-5">
          <p className="flex items-center gap-2 text-[15px] font-bold text-warn">
            <PauseCircle size={17} aria-hidden />
            Staged, not yet committed
          </p>
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-soft">
            {mandatoryBlockers.length === 0
              ? `Every mandatory gate is satisfied. Commit is a separate deliberate action.${
                  advisoryFindings.length > 0
                    ? ` ${advisoryFindings.length} advisory finding${
                        advisoryFindings.length === 1 ? "" : "s"
                      } remain reported below.`
                    : ""
                }`
              : `Commit is blocked by ${mandatoryBlockers.length} mandatory check${
                  mandatoryBlockers.length === 1 ? "" : "s"
                } that failed or await a decision.`}
          </p>
        </div>
      )}

      <Section
        step={nextStep()}
        title="Migration identity, source and destination"
        proves="Which file this record is about, and which contract it was checked against."
      >
        <div className="grid gap-x-10 px-5 py-4 sm:grid-cols-2">
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
          <p className="border-t border-line bg-muted/30 px-5 py-3 text-xs leading-relaxed text-ink-soft">
            Acknowledged lossy operations:{" "}
            <span className="font-mono">{evidence.plan.acknowledgements.join(", ")}</span>
            . Each was accepted by name before the plan became executable.
          </p>
        )}
      </Section>

      <Section
        step={nextStep()}
        title="Approved plan"
        proves="The exact contract a human approved, and the transformations it authorises."
      >
        <div className="grid gap-x-10 px-5 py-4 sm:grid-cols-2">
          <Field label="Plan version" value={`v${evidence.plan.version}`} />
          <Field label="Proposed by" value={evidence.plan.proposed_by} />
          <Field label="Approved by" value={evidence.plan.approved_by ?? "not approved"} />
          <Field label="Approved at" value={evidence.plan.approved_at ?? "not approved"} />
          <Field label="Conflict policy" value={evidence.plan.conflict_policy} />
          <Field
            label="Contract hash"
            value={
              <span className="font-mono text-xs">
                {evidence.plan.contract_hash?.slice(0, 22) ?? "none"}
              </span>
            }
          />
        </div>
        <details className="group border-t border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-[13px] font-semibold text-brand transition-colors hover:bg-brand-soft/50 [&::-webkit-details-marker]:hidden">
            <span>Approved transformations ({evidence.plan.mappings.length})</span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-ink-soft">
              <span className="group-open:hidden">Show</span>
              <span className="hidden group-open:inline">Hide</span>
              <ChevronDown size={14} className="transition-transform duration-200 group-open:rotate-180" aria-hidden />
            </span>
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {evidence.plan.mappings.map((mapping) => (
              <li
                key={mapping.source_column}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-2.5 font-mono text-xs"
              >
                <span className="font-semibold">{mapping.source_column}</span>
                <span className="text-ink-soft" aria-hidden>
                  →
                </span>
                <span className="text-ink-soft">{mapping.operation}</span>
                <span className="text-ink-soft" aria-hidden>
                  →
                </span>
                <span className="font-semibold">
                  {mapping.destination_column ?? "not written"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </Section>

      <Section
        step={nextStep()}
        title="Execution and row accounting"
        proves="Every source row is accounted for as arithmetic, not as a claim."
      >
        <p className="px-5 py-4 font-mono text-[13px] leading-loose">
          {evidence.row_accounting.arithmetic.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </p>
        {evidence.execution.applied_operations.length > 0 && (
          <details className="group border-t border-line">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-[13px] font-semibold text-brand transition-colors hover:bg-brand-soft/50 [&::-webkit-details-marker]:hidden">
              <span>Applied operations ({evidence.execution.applied_operations.length})</span>
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-ink-soft">
              <span className="group-open:hidden">Show</span>
              <span className="hidden group-open:inline">Hide</span>
              <ChevronDown size={14} className="transition-transform duration-200 group-open:rotate-180" aria-hidden />
            </span>
            </summary>
            <ul className="flex flex-wrap gap-1.5 border-t border-line px-5 py-3">
              {evidence.execution.applied_operations.map((operation) => (
                <li
                  key={operation}
                  className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-ink-soft"
                >
                  {operation}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section
        step={nextStep()}
        title="Independent verification"
        proves="A verifier that shares no code with the planner read the staged rows back."
        tone={
          // Mandatory blockers alone decide this. The summary counts advisory
          // findings too, and an advisory failure must not make the whole
          // section read as a mandatory failure.
          mandatoryBlockers.some((check) => check.status === "failed")
            ? "bad"
            : mandatoryBlockers.length > 0
              ? "warn"
              : "ok"
        }
      >
        <div className="grid grid-cols-2 gap-2.5 px-5 py-4 lg:grid-cols-4">
          {[
            { label: "Passed", value: summary.passed, tone: "text-ok" },
            { label: "Failed", value: summary.failed, tone: "text-bad" },
            { label: "Review required", value: summary.review, tone: "text-warn" },
            { label: "Not verified", value: summary.not_verified, tone: "text-neutral" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-card border border-line px-3.5 py-3">
              <p className={`font-mono text-xl font-bold tabular-nums ${stat.tone}`}>
                {stat.value}
              </p>
              <p className="mt-0.5 text-[11px] font-semibold">{stat.label}</p>
            </div>
          ))}
        </div>
        <p className="border-t border-line px-5 py-2.5 text-[11px] leading-relaxed text-ink-soft">
          Not verified is not a pass: the property was never checked. An advisory
          check is reported in full and never gates a commit.
        </p>
        <ul className="divide-y divide-line border-t border-line">
          {evidence.verification.checks.map((check) => (
            <li
              key={check.check_id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-sm transition-colors hover:bg-muted/40"
            >
              <span className="min-w-0">
                {check.name}
                {check.mandatory === false && (
                  <span className="ml-2 rounded-full border border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                    Advisory
                  </span>
                )}
              </span>
              <StatusPill presentation={checkStatusPresentation[check.status]} />
            </li>
          ))}
        </ul>
        <details className="group border-t border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-[13px] font-semibold text-brand transition-colors hover:bg-brand-soft/50 [&::-webkit-details-marker]:hidden">
            <span>Expected and observed, per check</span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-ink-soft">
              <span className="group-open:hidden">Show</span>
              <span className="hidden group-open:inline">Hide</span>
              <ChevronDown size={14} className="transition-transform duration-200 group-open:rotate-180" aria-hidden />
            </span>
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {evidence.verification.checks.map((check) => (
              <li key={`detail-${check.check_id}`} className="px-5 py-3">
                <p className="text-[13px] font-semibold">
                  {check.name}
                  <span className="ml-2 font-mono text-[10px] font-normal text-ink-soft">
                    {check.mandatory === false ? "advisory" : "mandatory"}
                  </span>
                </p>
                <dl className="mt-1.5 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-ink-soft">Expected</dt>
                    <dd className="leading-relaxed">{check.expected}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-soft">Observed</dt>
                    <dd
                      className={`font-mono leading-relaxed ${
                        check.status === "failed" ? "font-semibold text-bad" : ""
                      }`}
                    >
                      {check.observed}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </details>
      </Section>

      {evidence.discrepancies.length > 0 && (
        <Section
          step={nextStep()}
          title="Discrepancies"
          proves="Individual values where the staged row differed from the source."
          tone={discrepancyTone}
        >
          <div className="table-scroll">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="bg-muted/60">
                  {[
                    "Row key",
                    "Field",
                    "Source",
                    "Destination",
                    "Check",
                    "Status",
                    "Gate",
                  ].map((header) => (
                    <th
                      key={header}
                      scope="col"
                      className="whitespace-nowrap border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-soft"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {evidence.discrepancies.slice(0, 20).map((item, index) => (
                  <tr key={index} className="border-t border-line align-top">
                    <td className="px-4 py-2.5 font-mono text-xs">{item.row_key}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{item.field}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{item.source_value}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-bad">
                      {item.destination_value}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-soft">
                      {item.check_name}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill
                        presentation={
                          checkStatusPresentation[
                            item.status as keyof typeof checkStatusPresentation
                          ] ?? checkStatusPresentation.not_verified
                        }
                      />
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {/* Resolved against the checks already in this same
                          evidence object. No new field is invented. */}
                      {(() => {
                        const gate = gateOf(item.check_id);
                        if (gate === "advisory")
                          return (
                            <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                              Advisory
                            </span>
                          );
                        if (gate === "mandatory")
                          return (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink">
                              Mandatory
                            </span>
                          );
                        return (
                          <span className="rounded-full border border-dashed border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                            Unclassified
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {evidence.discrepancies.length > 20 && (
            <p className="border-t border-line bg-muted/30 px-5 py-2.5 text-xs text-ink-soft">
              Showing the first 20 of {evidence.discrepancies.length}. The
              canonical JSON below carries the complete set.
            </p>
          )}
        </Section>
      )}

      <>
        <Section
          step={nextStep()}
          title="Rejected rows"
          proves="Rows the executor refused rather than converting under an unapproved rule."
          tone={evidence.execution.transform_errors.length > 0 ? "warn" : "neutral"}
        >
          {evidence.execution.transform_errors.length === 0 && (
            <p className="px-5 py-4 text-sm leading-relaxed text-ink-soft">
              None. Every source row was either staged or accounted for above.
            </p>
          )}
          <ul className="space-y-2 px-5 py-4 text-sm">
            {evidence.execution.transform_errors.slice(0, 10).map((error, index) => (
              <li key={index} className="leading-relaxed">
                <span className="font-mono">{error.source_key}</span> ·{" "}
                <span className="font-mono text-ink-soft">{error.field}</span> ·{" "}
                {error.reason}
              </li>
            ))}
          </ul>
          {evidence.execution.transform_errors.length > 10 && (
            <p className="border-t border-line bg-muted/30 px-5 py-2.5 text-xs text-ink-soft">
              Showing the first 10 of {evidence.execution.transform_errors.length}.
              The canonical JSON below carries every one.
            </p>
          )}
        </Section>
      </>

      <Section
        step={nextStep()}
        title="Human approvals"
        proves="Audit entries recording who accepted what, and when."
      >
        <div className="px-5 py-4">
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
        </div>
        <p className="border-t border-line bg-muted/30 px-5 py-3 text-xs leading-relaxed text-ink-soft">
          These are audit entries, not cryptographic signatures. MoveProof does
          not describe them as such.
        </p>
      </Section>

      <Section
        step={nextStep()}
        title="Limitations and unverified properties"
        proves="What this record does not establish, stated rather than omitted."
      >
        <div className="px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Limitations
          </p>
          <p className="mt-0.5 text-[11px] text-ink-soft">
            Scope boundaries declared by the contract.
          </p>
          <ul className="mt-2 space-y-2 text-sm leading-relaxed text-ink-soft">
            {evidence.limitations.length > 0 ? (
              evidence.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))
            ) : (
              <li>The contract declares no scope exclusions.</li>
            )}
          </ul>
        </div>

        <div className="border-t border-line px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral">
            Not verified
          </p>
          <p className="mt-0.5 text-[11px] text-ink-soft">
            Properties that were never checked. This is not a pass.
          </p>
          {evidence.not_verified.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {evidence.not_verified.map((property) => (
                <li
                  key={property}
                  className="flex items-start gap-2 rounded-control bg-neutral-soft px-3 py-2 text-sm leading-relaxed"
                >
                  <Info size={14} className="mt-0.5 shrink-0 text-neutral" aria-hidden />
                  <span>{property}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              No properties were reported as not verified.
            </p>
          )}
        </div>
        <p className="border-t border-line bg-muted/30 px-5 py-3 text-xs leading-relaxed text-ink-soft">
          {evidence.disclaimer}
          {isRobotics
            ? " This record is evidence about a data migration. It is not a hardware safety certification, and it makes no claim about any physical robot."
            : ""}
        </p>
      </Section>

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2.5">
          <Button
            variant="secondary"
            icon={Download}
            onClick={() => void downloadVerifiedCsv()}
            disabled={csvBusy}
          >
            {csvBusy ? "Downloading CSV" : "Download verified CSV"}
          </Button>
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
          // Once the evidence records a commit, the action is spent. Leaving
          // it live would invite a second write against a destination that
          // already holds these rows.
          // An unconfirmed outcome disables the action outright. Relabelling
          // it was not enough: with commitAllowed still true the button stayed
          // clickable, which is exactly the second write this state exists to
          // prevent. Refresh is the only way forward until evidence is
          // authoritative again.
          disabled={
            committed ||
            commitPendingEvidence ||
            !commitAllowed ||
            outcomeUnconfirmed ||
            busy !== null
          }
          onClick={() => void attemptCommit()}
        >
          {committed
            ? "Committed"
            : outcomeUnconfirmed
              ? "Refresh status first"
              : gateBlocked
                ? "Retry commit"
                : commitAllowed
                  ? "Commit migration"
                  : "Commit blocked"}
        </Button>
      </div>

      {csvError && (
        <p className="mt-3 text-sm text-bad" role="alert">
          {csvError}
        </p>
      )}

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
