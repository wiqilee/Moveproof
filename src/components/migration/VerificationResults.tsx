"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  Sparkles,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { checkStatusPresentation } from "@/domain/status";
import type { ApiCheck, ApiEvidence, ApiVerification } from "@/lib/api-types";

type Filter = "all" | ApiCheck["status"];

const FILTER_LABELS: Record<Filter, string> = {
  all: "All checks",
  failed: "Failed",
  review: "Review required",
  passed: "Passed",
  not_verified: "Not verified",
};

export function VerificationResults({
  checks,
  summary,
  accounting,
  runLabel,
  onRepair,
  onContinue,
  busy,
}: {
  checks: ApiCheck[];
  summary: ApiVerification["summary"];
  accounting?: ApiEvidence["row_accounting"] | { arithmetic: string[] };
  runLabel: string;
  onRepair: () => void;
  onContinue: () => void;
  busy: string | null;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const visible = filter === "all" ? checks : checks.filter((c) => c.status === filter);

  // Only a mandatory check gates a commit. An advisory failure is reported
  // seriously and never hidden, but calling it a blocker would contradict the
  // contract the backend actually enforces.
  const mandatoryFailed = checks.filter(
    (check) => check.mandatory !== false && check.status === "failed"
  );
  const mandatoryReview = checks.filter(
    (check) => check.mandatory !== false && check.status === "review"
  );
  const advisoryFailed = checks.filter(
    (check) => check.mandatory === false && check.status === "failed"
  );
  const discrepancies = checks.flatMap((check) =>
    check.status === "failed" || check.status === "review"
      ? check.evidence.map((evidence) => ({ check, evidence }))
      : []
  );

  const headline =
    summary.failed > 0
      ? { text: "Verification failed", className: "bg-bad-soft text-bad", Icon: XCircle }
      : summary.review > 0
        ? {
            text: "Human review required",
            className: "bg-warn-soft text-warn",
            Icon: AlertTriangle,
          }
        : {
            text: "Verified against the approved contract",
            className: "bg-ok-soft text-ok",
            Icon: CheckCircle2,
          };

  return (
    <div>
      <div className={`mb-3 rounded-card border-none p-5 ${headline.className}`}>
        <p className="mb-4 flex items-center gap-2 text-[15px] font-bold">
          <headline.Icon size={18} aria-hidden />
          {headline.text}
        </p>
        {/* Each figure is also the filter for its own checks, so the number
            a reader lands on is one tap from the rows behind it. Not verified
            is deliberately neutral: it is not a failure, and colouring it like
            one would be its own kind of lie. */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {[
            {
              key: "passed" as Filter,
              label: "Passed",
              value: summary.passed,
              tone: "text-ok",
              Icon: CheckCircle2,
              hint: "ran and succeeded",
            },
            {
              key: "failed" as Filter,
              label: "Failed",
              value: summary.failed,
              tone: "text-bad",
              Icon: XCircle,
              hint: "an invariant was violated",
            },
            {
              key: "review" as Filter,
              label: "Review required",
              value: summary.review,
              tone: "text-warn",
              Icon: AlertTriangle,
              hint: "a decision is outstanding",
            },
            {
              key: "not_verified" as Filter,
              label: "Not verified",
              value: summary.not_verified,
              tone: "text-neutral",
              Icon: Info,
              hint: "never checked, not a pass",
            },
          ].map((stat) => {
            const active = filter === stat.key;
            return (
              <button
                key={stat.label}
                type="button"
                onClick={() => setFilter(active ? "all" : stat.key)}
                aria-pressed={active}
                className={[
                  "rounded-card border bg-surface/80 px-3.5 py-3 text-left",
                  "transition-[border-color,background-color,box-shadow] duration-200",
                  active
                    ? "border-navy bg-surface shadow-sm ring-1 ring-navy/20"
                    : "border-transparent hover:border-line hover:bg-surface",
                  stat.value === 0 ? "opacity-70" : "",
                ].join(" ")}
              >
                <span className="flex items-baseline gap-2">
                  <span className={`font-mono text-2xl font-bold tabular-nums ${stat.tone}`}>
                    {stat.value}
                  </span>
                  <stat.Icon size={14} className={`${stat.tone} shrink-0`} aria-hidden />
                </span>
                <span className="mt-1 block text-xs font-semibold text-ink">
                  {stat.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-soft">
                  {stat.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {accounting && (
        <div className="mb-4 rounded-card border border-line bg-surface p-4">
          <p className="mb-2 text-xs font-semibold text-ink-soft">Row accounting</p>
          <p className="font-mono text-sm leading-loose">
            {accounting.arithmetic.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </p>
        </div>
      )}

      <dl className="mb-4 grid gap-x-6 gap-y-1.5 text-xs leading-relaxed text-ink-soft sm:grid-cols-2">
        {[
          ["Passed", "the check ran and succeeded"],
          ["Failed", "an approved invariant was violated"],
          ["Review required", "a human decision is outstanding"],
          ["Not verified", "the property was never checked, which is not the same as passing"],
        ].map(([term, meaning]) => (
          <div key={term} className="flex gap-1.5">
            <dt className="shrink-0 font-semibold text-ink">{term}</dt>
            <dd>— {meaning}</dd>
          </div>
        ))}
      </dl>

      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter checks">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={[
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
              filter === key
                ? "bg-navy text-on-navy"
                : "border border-line bg-surface text-ink-soft hover:bg-muted",
            ].join(" ")}
          >
            {FILTER_LABELS[key]}
          </button>
        ))}
      </div>

      {/* Below sm the table becomes one card per check. Every field survives:
          a phone gets the same information stacked, not a summary. */}
      <ul className="mb-4 space-y-2.5 sm:hidden">
        {visible.map((check) => (
          <li
            key={check.check_id}
            className={[
              "overflow-hidden rounded-card border bg-surface",
              check.status === "failed"
                ? "border-bad/30"
                : check.status === "review"
                  ? "border-warn/30"
                  : "border-line",
            ].join(" ")}
          >
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-snug">{check.name}</p>
                <p className="mt-0.5 font-mono text-[10px] text-ink-soft">
                  {check.check_id}
                  {check.mandatory === false ? " · advisory" : ""}
                </p>
              </div>
              <StatusPill presentation={checkStatusPresentation[check.status]} />
            </div>
            <dl className="divide-y divide-line text-[13px]">
              <div className="px-4 py-2.5">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                  Expected
                </dt>
                <dd className="mt-0.5 leading-relaxed text-ink-soft">{check.expected}</dd>
              </div>
              <div className="px-4 py-2.5">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                  Observed
                </dt>
                <dd
                  className={`mt-0.5 font-mono text-xs leading-relaxed ${
                    check.status === "failed" ? "font-semibold text-bad" : ""
                  }`}
                >
                  {check.observed}
                </dd>
              </div>
            </dl>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="rounded-card border border-line bg-surface px-4 py-6 text-center text-sm text-ink-soft">
            No checks in this category.
          </li>
        )}
      </ul>

      <div className="mb-4 hidden overflow-hidden rounded-card border border-line bg-surface sm:block">
        <div className="table-scroll">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="bg-muted/60">
                {["Check", "Expected", "Observed", "Status"].map((header) => (
                  <th
                    key={header}
                    scope="col"
                    className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-soft"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((check) => (
                <tr
                  key={check.check_id}
                  className={[
                    "border-t border-line align-top transition-colors",
                    check.status === "failed"
                      ? "bg-bad-soft/40"
                      : check.status === "review"
                        ? "bg-warn-soft/30"
                        : "hover:bg-brand-soft/50",
                  ].join(" ")}
                >
                  <td className="px-4 py-3.5">
                    <p className="font-semibold leading-snug">{check.name}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-ink-soft">
                      {check.check_id}
                    </p>
                    {check.mandatory === false && (
                      <span className="mt-1.5 inline-flex items-center rounded-full border border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                        Advisory
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-[13px] leading-relaxed text-ink-soft">
                    {check.expected}
                  </td>
                  <td
                    className={`px-4 py-3.5 font-mono text-xs leading-relaxed ${
                      check.status === "failed" ? "font-semibold text-bad" : ""
                    }`}
                  >
                    {check.observed}
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusPill presentation={checkStatusPresentation[check.status]} />
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr className="border-t border-line">
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-ink-soft">
                    No checks in this category.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {discrepancies.length > 0 && (
        <div className="mb-4 rounded-card border border-line bg-surface p-4">
          <p className="mb-1 text-xs font-semibold text-ink-soft">Discrepancy explorer</p>
          <p className="mb-3 text-xs text-ink-soft">
            Only the fields that differ are shown. Whole rows are not repeated.
          </p>
          <div className="table-scroll">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="bg-muted/60">
                  {["Row key", "Field", "Source value", "Destination value"].map((header) => (
                    <th
                      key={header}
                      scope="col"
                      className="px-3.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-soft"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {discrepancies.map(({ check, evidence }, index) => (
                  <tr key={`${check.check_id}-${index}`} className="border-t border-line">
                    <td className="px-3.5 py-2.5 font-mono">{evidence.row_key}</td>
                    <td className="px-3.5 py-2.5 font-mono text-ink-soft">{evidence.field}</td>
                    <td className="px-3.5 py-2.5 font-mono">{evidence.source_value}</td>
                    <td
                      className={`px-3.5 py-2.5 font-mono font-semibold ${
                        check.status === "failed" ? "text-bad" : "text-warn"
                      }`}
                    >
                      {evidence.destination_value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* What this result means for committing, said once and plainly.
          Eligibility is decided by the backend gate; this only reports the
          condition these checks put it in. */}
      <div
        className={[
          "mb-4 flex flex-wrap items-start gap-3 rounded-card border px-5 py-4",
          mandatoryFailed.length > 0
            ? "border-bad/30 bg-bad-soft/50"
            : mandatoryReview.length > 0
              ? "border-warn/30 bg-warn-soft/50"
              : "border-ok/30 bg-ok-soft/50",
        ].join(" ")}
      >
        {mandatoryFailed.length > 0 ? (
          <XCircle size={18} className="mt-0.5 shrink-0 text-bad" aria-hidden />
        ) : mandatoryReview.length > 0 ? (
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        ) : (
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ok" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">
            {mandatoryFailed.length > 0
              ? "Commit is blocked by a failed mandatory check"
              : mandatoryReview.length > 0
                ? "Commit is blocked until every mandatory review item is resolved"
                : "Nothing mandatory is outstanding"}
          </p>
          <p className="mt-0.5 max-w-3xl text-[13px] leading-relaxed text-ink-soft">
            {mandatoryFailed.length > 0
              ? "A repair creates a new plan version and reruns from the original uploaded bytes. The failed result stays on the record."
              : mandatoryReview.length > 0
                ? "A review item is a human decision, not a defect. Resolve it and verify again."
                : `Commit is a separate deliberate action on the evidence report. ${summary.not_verified} propert${
                    summary.not_verified === 1 ? "y was" : "ies were"
                  } not checked, and that is reported rather than counted as a pass.`}
          </p>
          {advisoryFailed.length > 0 && (
            <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-bad">
              {advisoryFailed.length} advisory check
              {advisoryFailed.length === 1 ? "" : "s"} failed
              {mandatoryFailed.length + mandatoryReview.length === 0
                ? " — reported, but not a mandatory commit gate."
                : "."}{" "}
              <span className="text-ink-soft">
                An advisory failure is real and stays on the record. Read it
                before committing.
              </span>
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs text-ink-soft">{runLabel}</p>
        <div className="flex flex-wrap gap-2.5">
          {mandatoryFailed.length > 0 && (
            <Button variant="accent" icon={Sparkles} onClick={onRepair} disabled={busy !== null}>
              Review repair proposal
            </Button>
          )}
          <Button
            icon={ArrowRight}
            iconPosition="right"
            onClick={onContinue}
            disabled={busy !== null}
          >
            Open the evidence report
          </Button>
        </div>
      </div>
    </div>
  );
}
