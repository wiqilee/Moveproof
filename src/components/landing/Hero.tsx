import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HeroPreview } from "./HeroPreview";
import { CalibrationRig } from "./CalibrationRig";
import { routes } from "@/lib/routes";

export function Hero() {
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
          </div>

          <div className="space-y-6">
            {/* The rig first: it says what this product is about before any
                control has to be understood. */}
            <CalibrationRig />

            <div>
              <p className="mb-3 text-xs text-ink-soft">
                Select a field to see what the migration did to it.
              </p>
              <HeroPreview />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
