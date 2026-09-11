"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Sparkles, XCircle } from "lucide-react";
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
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            { label: "Passed", value: summary.passed, tone: "text-ok" },
            { label: "Failed", value: summary.failed, tone: "text-bad" },
            { label: "Review required", value: summary.review, tone: "text-warn" },
            { label: "Not verified", value: summary.not_verified, tone: "text-neutral" },
          ].map((stat) => (
            <div key={stat.label}>
              <div className={`font-mono text-2xl font-bold ${stat.tone}`}>{stat.value}</div>
              <div className="mt-0.5 text-xs text-ink-soft">{stat.label}</div>
            </div>
          ))}
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

      <p className="mb-4 text-xs leading-relaxed text-ink-soft">
        Passed means the check ran and succeeded. Failed means an approved invariant was
        violated. Review required means a human decision is outstanding. Not verified means
        the property was never checked, which is not the same as passing.
      </p>

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

      <div className="mb-4 overflow-hidden rounded-card border border-line bg-surface">
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
                <tr key={check.check_id} className="border-t border-line align-top">
                  <td className="px-4 py-3">
                    <p className="font-semibold">{check.name}</p>
                    {check.mandatory === false && (
                      <p className="mt-0.5 text-[11px] text-ink-soft">Advisory</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{check.expected}</td>
                  <td
                    className={`px-4 py-3 font-mono text-xs ${
                      check.status === "failed" ? "text-bad" : ""
                    }`}
                  >
                    {check.observed}
                  </td>
                  <td className="px-4 py-3">
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs text-ink-soft">{runLabel}</p>
        <div className="flex flex-wrap gap-2.5">
          {summary.failed > 0 && (
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
