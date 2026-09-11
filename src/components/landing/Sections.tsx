import Link from "next/link";
import { ArrowRight, Check, Minus } from "lucide-react";
import { IMPLEMENTATION_STATUS } from "@/lib/site";
import { routes } from "@/lib/routes";

/* ------------------------------------------------------------------ */
/* Problem                                                             */
/* ------------------------------------------------------------------ */

const FAILURE_MODES = [
  { before: "00127", after: "127", cause: "An integer cast strips a leading zero" },
  { before: "03/04/2024", after: "2024-03-04", cause: "A locale guess turns 3 April into 4 March" },
  { before: "1200.50", after: "1200.4999", cause: "A float conversion loses a fraction of a cent" },
  { before: "2 rows", after: "1 row", cause: "A duplicate is dropped without an agreed policy" },
];

export function ProblemSection() {
  return (
    <section id="problem" className="border-b border-line bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)] lg:gap-16">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              The problem
            </p>
            <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-[-0.02em] sm:text-[2.5rem]">
              The import succeeded.
              <br />
              That is not the same as the data surviving.
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-soft">
              None of the failures on the right raise an error. Row counts match, the log reads
              clean, and the damage surfaces months later when an invoice reaches the wrong person.
            </p>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-soft">
              The people doing this work are usually operations staff and consultants rather than
              database specialists. They can spot a misspelled name. A wrong cast applied
              consistently across ten thousand rows looks exactly like success.
            </p>
          </div>

          <div>
            <div className="overflow-hidden rounded-card border border-line">
              <div className="grid grid-cols-[1fr_auto_1fr] gap-3 border-b border-line bg-muted/60 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                <span>In the spreadsheet</span>
                <span aria-hidden />
                <span>In the database</span>
              </div>
              {FAILURE_MODES.map((mode) => (
                <div key={mode.cause} className="border-b border-line px-4 py-3.5 last:border-b-0">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                    <span className="truncate font-mono text-sm">{mode.before}</span>
                    <ArrowRight size={13} className="text-line" aria-hidden />
                    <span className="truncate font-mono text-sm text-bad">{mode.after}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-ink-soft">{mode.cause}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

const STAGES = [
  {
    title: "Inspect your data",
    body: "Upload a CSV or XLSX file and read the real rows, the inferred types and the values that will cause trouble.",
    detail: "5 rows read · 4 hazards flagged",
  },
  {
    title: "Approve the plan",
    body: "A model proposes a typed mapping and marks what it is unsure about. A risky operation cannot be approved without an explicit acknowledgement.",
    detail: "Plan v1 · 7 operations · 2 review required",
  },
  {
    title: "Verify the staged result",
    body: "A verifier that shares no code with the planner checks the staged data against the approved contract.",
    detail: "8 checks · 5 passed · 1 failed",
  },
  {
    title: "Commit with evidence",
    body: "Commit stays blocked until nothing mandatory is outstanding, and the report records what was never checked.",
    detail: "3 rows committed · 2 properties not verified",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-b border-line">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            How it works
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.02em] sm:text-[2.5rem]">
            Eight stages run end to end
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
            Inspect, plan, review, stage, verify, repair, commit, report. These four are the points
            where a decision is yours to make.
          </p>
        </div>

        <ol className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((stage, index) => (
            <li key={stage.title} className="border-t-2 border-navy pt-5">
              <p className="font-mono text-xs text-ink-soft">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-3 text-[15px] font-semibold tracking-tight">{stage.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{stage.body}</p>
              <p className="mt-4 border-t border-line pt-3 font-mono text-[11px] text-ink-soft">
                {stage.detail}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Approach                                                            */
/* ------------------------------------------------------------------ */

const PRINCIPLES = [
  {
    title: "The checker is not the author",
    body: "The model proposes transformations. A separate verifier, with its own contract and no shared code, decides whether they held. A model confirming its own output would not be verification.",
    example: "Planner and verifier are separate modules by construction.",
  },
  {
    title: "Plans are versioned and immutable",
    body: "An approved plan is never edited. A repair creates a new version with a reviewable diff, and every executed operation names the version it came from.",
    example: "Plan v1 stays on the record, including the cast that failed.",
  },
  {
    title: "Not verified is not a pass",
    body: "Results are reported in four separate counts rather than one score, so a property that was never checked cannot be mistaken for one that held.",
    example: "Passed · Failed · Review required · Not verified.",
  },
];

export function Approach() {
  return (
    <section id="approach" className="border-b border-line bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            The approach
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.02em] sm:text-[2.5rem]">
            Three rules the code enforces
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
            Each of these is a constraint in the domain layer rather than a promise in the
            interface, which is why a new screen cannot quietly break one.
          </p>
        </div>

        <div className="mt-12 divide-y divide-line border-y border-line">
          {PRINCIPLES.map((principle, index) => (
            <div key={principle.title} className="grid gap-4 py-8 lg:grid-cols-[auto_minmax(0,5fr)_minmax(0,4fr)] lg:gap-10">
              <p className="font-mono text-sm text-ink-soft lg:w-10">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h3 className="text-xl font-semibold tracking-[-0.01em]">{principle.title}</h3>
              <div>
                <p className="text-sm leading-relaxed text-ink-soft">{principle.body}</p>
                <p className="mt-3 font-mono text-[11px] text-ink-soft">{principle.example}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 max-w-2xl text-sm leading-relaxed text-ink-soft">
          A passed verification means the invariants in the approved contract held. It does not mean
          every possible semantic error has been ruled out, and the evidence report says so in its
          own limitations section.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Technology                                                          */
/* ------------------------------------------------------------------ */

export function Technology() {
  const live = IMPLEMENTATION_STATUS.filter((item) => item.state === "live");
  const planned = IMPLEMENTATION_STATUS.filter((item) => item.state === "planned");

  return (
    <section id="technology" className="border-b border-line">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)] lg:gap-16">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              Technology
            </p>
            <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-[-0.02em] sm:text-[2.5rem]">
              AI proposes.
              <br />
              Deterministic code decides.
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-soft">
              The architecture treats model output as untrusted input. Proposals are validated
              against an allowlist of supported operations, executed exactly as approved in an
              isolated staging schema, then checked by an independent verifier before anything
              counts as a result.
            </p>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-soft">
              Inference is designed to run on an NVIDIA open source model served through Nebius
              Token Factory. Full datasets are never sent, only a schema summary and a small sample.
            </p>
          </div>

          <div className="rounded-card border border-line bg-surface p-6">
            <h3 className="text-sm font-semibold">What is running in this build</h3>
            <ul className="mt-4 space-y-2.5">
              {live.map((item) => (
                <li key={item.label} className="flex items-start gap-2.5 text-sm">
                  <Check size={15} className="mt-0.5 shrink-0 text-ok" aria-hidden />
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>

            <h3 className="mt-7 text-sm font-semibold">Designed but not yet connected</h3>
            <ul className="mt-4 space-y-2.5">
              {planned.map((item) => (
                <li key={item.label} className="flex items-start gap-2.5 text-sm text-ink-soft">
                  <Minus size={15} className="mt-0.5 shrink-0 text-line" aria-hidden />
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>

            <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-ink-soft">
              Nebius and NVIDIA are named to describe the intended technology. Neither company
              endorses this project.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Closing call to action                                              */
/* ------------------------------------------------------------------ */

export function ClosingCta() {
  return (
    <section className="border-b border-line bg-navy text-on-navy">
      <div className="mx-auto max-w-4xl px-5 py-20 text-center sm:px-6">
        <h2 className="text-3xl font-semibold tracking-[-0.02em] sm:text-[2.5rem]">
          See what your migration actually changed.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-on-navy/75">
          Walk the full workflow on the synthetic dataset, from the proposed plan to the failed
          invariant to the signed off evidence report.
        </p>
        <Link
          href={routes.workspace}
          className="mt-8 inline-flex items-center gap-2 rounded-control bg-surface px-5 py-3 text-sm font-semibold text-ink transition-colors hover:bg-surface/90 active:translate-y-px"
        >
          Open the workspace
          <ArrowRight size={15} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
