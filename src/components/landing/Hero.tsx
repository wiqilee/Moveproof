import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HeroPreview } from "./HeroPreview";
import { routes } from "@/lib/routes";

export function Hero() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14">
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
              A successful import is not the same as a correct one. MoveProof checks the
              transformation against an approved contract and shows you the evidence either way.
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
            The preview on this page is synthetic. Live migrations in the workspace use the deployed backend, database, verifier, and configured AI model.
            </p>
          </div>

          <div>
            <p className="mb-3 text-xs text-ink-soft">
              Select a field to see what the migration did to it.
            </p>
            <HeroPreview />
          </div>
        </div>
      </div>
    </section>
  );
}
