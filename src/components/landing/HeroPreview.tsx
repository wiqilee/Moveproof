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

/** The columns, in the order the preview lists them. Exported so the hero's
 *  annotation can point at a field by name rather than by index. */
export const PREVIEW_COLUMNS = FIELDS.map((entry) => entry.column);

export function HeroPreview({
  selected: controlled,
  onSelect,
}: {
  /** Optional controlled selection, so another block can drive this one. */
  selected?: number;
  onSelect?: (index: number) => void;
} = {}) {
  const [internal, setInternal] = useState(0);
  const selected = controlled ?? internal;
  const select = (index: number) => {
    setInternal(index);
    onSelect?.(index);
  };
  const field = FIELDS[selected];
  const style = outcomeStyles[field.outcome];

  return (
    <div className="panel overflow-hidden shadow-lift">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-muted/60 px-4 py-2.5">
        <p className="font-mono text-[11px] text-ink-soft">customers_v1 · MOV-2026-0091 · plan v1 · run 1</p>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
          Synthetic preview
        </p>
      </div>

      <div>
        <ul
          className="grid border-b border-line sm:grid-cols-2 lg:grid-cols-4"
          role="tablist"
          aria-label="Verified fields"
        >
          {FIELDS.map((entry, index) => {
            const active = index === selected;
            const entryStyle = outcomeStyles[entry.outcome];
            return (
              <li key={entry.column}>
                <button
                  role="tab"
                  aria-selected={active}
                  onClick={() => select(index)}
                  className={[
                    "flex h-full w-full items-center gap-2.5 border-b-2 px-4 py-3 text-left",
                    "transition-colors duration-150",
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

        <div className="p-4 sm:p-5 lg:px-6">
          <p className={`flex items-center gap-1.5 text-[11px] font-semibold ${style.text}`}>
            <style.Icon size={13} aria-hidden />
            {style.label}
          </p>

          {/* Four stations, so the value's journey is legible rather than a
              before and after pair. The rail between them is the same device
              the workflow pipeline uses elsewhere on the page. */}
          <ol className="mt-4 lg:grid lg:grid-cols-2 lg:gap-x-8">
            {[
              {
                label: "Source",
                value: field.source,
                body: null,
                tone: "bg-muted",
              },
              {
                label: "Approved transformation",
                value: field.transformation,
                body: null,
                tone: "bg-brand-soft/60",
                mono: false,
              },
              {
                label: "Staged",
                value: field.destination,
                body: null,
                tone:
                  field.outcome === "failed"
                    ? "bg-bad-soft"
                    : field.outcome === "review"
                      ? "bg-warn-soft"
                      : "bg-ok-soft",
              },
              {
                label: "Independent verification",
                value: style.label,
                body: field.invariant,
                tone:
                  field.outcome === "failed"
                    ? "bg-bad-soft"
                    : field.outcome === "review"
                      ? "bg-warn-soft"
                      : "bg-ok-soft",
                mono: false,
              },
            ].map((station, index, all) => (
              <li key={station.label} className="relative flex gap-3 pb-3 last:pb-0">
                {index < all.length - 1 && (
                  <span className="absolute left-[5px] top-3 h-full w-px bg-line lg:hidden" aria-hidden />
                )}
                <span
                  className={[
                    "relative mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 bg-surface",
                    index === all.length - 1 ? "border-current" : "border-line",
                    index === all.length - 1 ? style.text : "",
                  ].join(" ")}
                  aria-hidden
                />
                <span className={`min-w-0 flex-1 rounded-lg px-3 py-2 ${station.tone}`}>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                    {station.label}
                  </span>
                  <span
                    className={[
                      "mt-0.5 block break-words text-[15px] font-semibold leading-snug",
                      station.mono === false ? "" : "font-mono",
                      index === all.length - 1 ? style.text : "",
                      index === 2 && field.outcome !== "passed" ? style.text : "",
                    ].join(" ")}
                  >
                    {station.value}
                  </span>
                  {station.body && (
                    <span className="mt-1 block text-[12px] leading-relaxed text-ink-soft">
                      {station.body}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>

          <p className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-ink-soft">
            {field.note}
          </p>
        </div>
      </div>
    </div>
  );
}
