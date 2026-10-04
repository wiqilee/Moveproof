"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HeroPreview } from "./HeroPreview";
import { CalibrationRig } from "./CalibrationRig";
import { routes } from "@/lib/routes";

/**
 * Each example beside the field it happens to, in the preview's own order.
 * The mapping is by index into PREVIEW_COLUMNS, so a field added there without
 * one here would fail the length check below rather than mislabel a row.
 */
const SILENT_CHANGES = [
  { label: "Leading-zero identifiers", value: "00127 → 127" },
  { label: "Date interpretation", value: "03/04/2026 → ambiguous" },
  { label: "Decimal conventions", value: "1,250.00 / 1250,00" },
  { label: "Text normalization", value: "whitespace, exact text" },
];

export function Hero() {
  // One selection shared by the annotation and the preview. Nothing here
  // touches migration data; this is the synthetic landing demonstration.
  const [field, setField] = useState(0);

  return (
    <section className="border-b border-line">
      {/* The floating nav already reserves its own space above, so the old
          pt-20 stacked a second gap on top of it and pushed the headline and
          the rig down for no reason. Breathing room stays; the dead zone
          goes. */}
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10 lg:pt-12">
        {/* items-start, not items-center. The right column is much taller
            once the rig, the stage chips and the preview are stacked, and
            centring against it pushed the headline down the page behind a
            band of empty space. Both columns now start at the same line. */}
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14">
          <div>
            <p className="inline-flex items-center rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              AI assisted data migration
            </p>

            <h1 className="mt-6 text-[2.6rem] font-semibold leading-[1.04] tracking-[-0.03em] sm:text-[3.4rem] lg:text-[3.75rem]">
              Move data.
              <br />
              <span className="text-brand">Prove</span> what changed.
            </h1>

            <p className="mt-6 max-w-md text-base leading-relaxed text-ink-soft sm:text-[17px]">
              A successful import is not the same as a correct one. MoveProof verifies approved
              destination contracts across customer data and per-joint robot calibration migrations,
              then shows you the evidence either way.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href={routes.workspace}
                className="inline-flex items-center gap-2 rounded-control bg-navy text-on-navy px-5 py-3 text-sm font-semibold shadow-sm transition-colors hover:bg-navy/90 active:translate-y-px"
              >
                Try the demo
                <ArrowRight size={15} aria-hidden />
              </Link>
              <a
                href="#how-it-works"
                className="rounded-control border border-line bg-surface px-5 py-3 text-sm font-semibold transition-colors hover:bg-muted active:translate-y-px"
              >
                See how it works
              </a>
            </div>

            <p className="mt-6 text-xs leading-relaxed text-ink-soft">
  The preview on this page is a synthetic customer migration. The same verification-first workflow also supports the robot calibration destination contract; live migrations use the deployed backend, database, verifier, and configured model routing.
</p>

            {/* A quiet annotation, not a second card. It fills the space
                opposite the lower preview and states the four kinds of damage
                the product actually checks for, each of which the preview can
                demonstrate. A hairline rule rather than a border, so it reads
                as a margin note beside the interactive panel. */}
            <div className="mt-12 border-l border-line pl-5 lg:mt-16">
              <p className="eyebrow">What can silently change</p>
              <p className="mt-2 max-w-sm text-xs leading-relaxed text-ink-soft">
                Each of these passes an ordinary import without an error.
              </p>
              <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {SILENT_CHANGES.map((item, index) => {
                  const active = field === index;
                  return (
                    <div key={item.label} className="min-w-0">
                      {/* A real button: the annotation selects the matching
                          field in the preview, so this works by tap and by
                          keyboard, not only by pointer. */}
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setField(index)}
                        onMouseEnter={() => setField(index)}
                        className={[
                          "-mx-2 block w-full rounded-control px-2 py-1.5 text-left",
                          "transition-[transform,background-color,box-shadow] duration-200",
                          active ? "bg-brand-soft/60" : "hover:bg-muted/50",
                          "motion-safe:hover:-translate-y-0.5",
                        ].join(" ")}
                      >
                        <dt
                          className={`text-[13px] font-medium transition-colors ${
                            active ? "text-brand" : ""
                          }`}
                        >
                          {item.label}
                        </dt>
                        <dd
                          className={`mt-0.5 font-mono text-[12px] transition-colors ${
                            active ? "text-brand" : "text-ink-soft"
                          }`}
                        >
                          {item.value}
                        </dd>
                      </button>
                    </div>
                  );
                })}
              </dl>
            </div>
          </div>

          <div className="space-y-6">
            {/* The rig first: it says what this product is about before any
                control has to be understood. */}
            <CalibrationRig />

            <div>
              <p className="mb-3 text-xs text-ink-soft">
                Select a field to see what the migration did to it.
              </p>
              <HeroPreview selected={field} onSelect={setField} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
