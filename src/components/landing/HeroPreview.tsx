"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

/**
 * The signature interaction.
 *
 * Four fields from the synthetic migration. Selecting one reveals the source
 * value, the value the approved plan produced, the invariant that was checked
 * and the outcome. It communicates the whole product in one panel: source
 * data, proposed transformation, a detected discrepancy and the evidence
 * behind the verdict.
 *
 * These are the real values from the bundled demo dataset, not invented ones.
 */

type Outcome = "failed" | "review" | "passed";

interface Field {
  column: string;
  transformation: string;
  source: string;
  destination: string;
  invariant: string;
  outcome: Outcome;
  note: string;
}

const FIELDS: Field[] = [
  {
    column: "customer_id",
    transformation: "Cast to INTEGER",
    source: "00127",
    destination: "127",
    invariant: "Identifier matches the source exactly, as a string",
    outcome: "failed",
    note: "The integer cast stripped the leading zero. The row imported without error.",
  },
  {
    column: "signup_date",
    transformation: "Parse date, no policy set",
    source: "03/04/2024",
    destination: "Not written",
    invariant: "Every date parses under one approved format policy",
    outcome: "review",
    note: "Reads as 3 April or 4 March. Both are valid, so the plan asks instead of guessing.",
  },
  {
    column: "balance",
    transformation: "Cast to NUMERIC(12,2)",
    source: "1200.50",
    destination: "1200.50",
    invariant: "Two decimal places preserved, no floating point rounding",
    outcome: "passed",
    note: "Exact to the cent across every staged row.",
  },
  {
    column: "full_name",
    transformation: "Normalize whitespace",
    source: "(empty)",
    destination: "Not written",
    invariant: "full_name is not null for every committed row",
    outcome: "review",
    note: "The destination column is NOT NULL, so this needs a human decision.",
  },
];

const outcomeStyles: Record<Outcome, { dot: string; label: string; text: string; Icon: typeof CheckCircle2 }> = {
  failed: { dot: "bg-bad", label: "Failed", text: "text-bad", Icon: XCircle },
  review: { dot: "bg-warn", label: "Review required", text: "text-warn", Icon: AlertTriangle },
  passed: { dot: "bg-ok", label: "Passed", text: "text-ok", Icon: CheckCircle2 },
};

export function HeroPreview() {
  const [selected, setSelected] = useState(0);
  const field = FIELDS[selected];
  const style = outcomeStyles[field.outcome];

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-lift">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-muted/60 px-4 py-2.5">
        <p className="font-mono text-[11px] text-ink-soft">customers_v1 · MOV-2026-0091 · plan v1 · run 1</p>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
          Synthetic preview
        </p>
      </div>

      <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <ul className="border-b border-line sm:border-b-0 sm:border-r" role="tablist" aria-label="Verified fields">
          {FIELDS.map((entry, index) => {
            const active = index === selected;
            const entryStyle = outcomeStyles[entry.outcome];
            return (
              <li key={entry.column}>
                <button
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelected(index)}
                  className={[
                    "flex w-full items-center gap-2.5 border-l-2 px-4 py-3 text-left transition-colors duration-150",
                    active ? "border-brand bg-brand-soft/50" : "border-transparent hover:bg-muted/60",
                  ].join(" ")}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${entryStyle.dot}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[13px] font-medium">{entry.column}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-soft">
                      {entry.transformation}
                    </span>
                  </span>
                  <span className="sr-only">{entryStyle.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="p-4 sm:p-5">
          <p className={`flex items-center gap-1.5 text-[11px] font-semibold ${style.text}`}>
            <style.Icon size={13} aria-hidden />
            {style.label}
          </p>

          <div className="mt-3 grid grid-cols-2 items-start gap-3">
            <div className="min-w-0 rounded-lg bg-muted px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-soft">Source</p>
              <p className="mt-1 break-words font-mono text-base font-semibold leading-snug">
                {field.source}
              </p>
            </div>
            <div
              className={[
                "min-w-0 rounded-lg px-3 py-2.5",
                field.outcome === "failed" ? "bg-bad-soft" : field.outcome === "review" ? "bg-warn-soft" : "bg-ok-soft",
              ].join(" ")}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-soft">Destination</p>
              <p
                className={`mt-1 break-words font-mono text-base font-semibold leading-snug ${
                  field.outcome === "passed" ? "" : style.text
                }`}
              >
                {field.destination}
              </p>
            </div>
          </div>

          <dl className="mt-4 space-y-2 border-t border-line pt-3.5">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-soft">Invariant checked</dt>
              <dd className="mt-0.5 text-[13px] leading-relaxed">{field.invariant}</dd>
            </div>
            <div>
              <dt className="sr-only">Explanation</dt>
              <dd className="text-[12px] leading-relaxed text-ink-soft">{field.note}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
