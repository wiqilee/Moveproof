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
  { before: "firmware 3.08", after: "3.8", cause: "A numeric coercion changes a robot firmware identifier" },
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
              None of the failures on the right have to raise an error. Row counts can match and
              logs can stay clean while a customer identifier, a date, or robot calibration metadata
              silently changes meaning.
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
    body: "Choose the customer or robot calibration destination contract, upload a CSV or XLSX file, and inspect the real rows, inferred types, and values that may cause trouble.",
    detail: "5 rows read · 4 hazards flagged",
  },
  {
    title: "Approve the plan",
    body: "In the model-assisted profile, Nemotron 3 Super proposes the mapping, and deterministic validation can selectively escalate harder cases to Nemotron 3 Ultra using the same bounded context. Tavily can provide metadata-only references for ambiguous fields, but those sources remain advisory and never affect verification or commit eligibility.",
    detail: "Plan v1 · 7 operations · 2 review items",
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
            Customer records and robot calibration data use the same eight-stage path: inspect,
            plan, review, stage, verify, repair, commit, report. Four stages require an explicit
            decision from you.
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
    body: "In the model-assisted profile, the model proposes transformations. A separate verifier, with its own contract and no shared code, decides whether they held. A model confirming its own output would not be verification.",
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
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            The approach
          </p>

          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.025em] sm:text-[2.5rem] sm:leading-[1.1]">
            Three rules the code enforces
          </h2>

          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
            Each of these is a constraint in the domain layer rather than a promise in the
            interface, which is why a new screen cannot quietly break one.
          </p>
        </div>

        <ol className="mt-8 space-y-2.5">
          {PRINCIPLES.map((principle, index) => (
            <li key={principle.title}>
              <article className="group relative rounded-card border border-line bg-canvas/40 transition-colors duration-200 hover:bg-muted/40">
                <span
                  className="absolute inset-y-4 left-0 w-px bg-line transition-all duration-200 group-hover:inset-y-3 group-hover:w-0.5 group-hover:bg-brand"
                  aria-hidden
                />

                <div className="grid gap-x-10 gap-y-3 px-6 py-5 sm:px-7 sm:py-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
                  <div className="flex items-start gap-4 lg:gap-5">
                    <span
                      className="mt-0.5 shrink-0 font-mono text-[13px] tabular-nums text-ink-soft/70 transition-colors duration-200 group-hover:text-brand"
                      aria-hidden
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>

                    <h3 className="text-xl font-semibold leading-snug tracking-[-0.015em] sm:text-[1.35rem]">
                      {principle.title}
                    </h3>
                  </div>

                  <div>
                    <p className="text-[15px] leading-relaxed text-ink-soft">
                      {principle.body}
                    </p>

                    <p className="mt-4 flex items-start gap-3">
                      <span
                        className="mt-[0.45rem] h-px w-4 shrink-0 bg-line"
                        aria-hidden
                      />
                      <span className="font-mono text-[11.5px] leading-relaxed tracking-tight text-ink-soft/80">
                        {principle.example}
                      </span>
                    </p>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ol>

        <div className="mt-8 grid gap-4 border-t border-line pt-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Verification boundary
          </p>

          <p className="text-sm leading-relaxed text-ink-soft">
            A passed verification means the invariants in the approved contract held. It does not
            mean every possible semantic error has been ruled out, and the evidence report says so
            in its own limitations section. For robot calibration migrations, this verifies the data
            migration contract; it does not certify calibration correctness or hardware safety.
          </p>
        </div>
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
              Validated code executes.
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-soft">
              The architecture treats model output as untrusted input. Destination profiles are
              resolved through a server-side registry, proposals are validated against an allowlist
              of supported operations, execution follows the exact approved contract in isolated
              staging, and an independent verifier checks the result before commit is allowed.
            </p>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-soft">
  Model-assisted reasoning runs through Nebius Token Factory. Nemotron 3 Super
  handles the initial planning pass, while deterministic validation can selectively
  escalate harder cases to Nemotron 3 Ultra. Both passes use the same bounded context:
  a schema summary and a small sample of rows. Full datasets are never sent to either model.
</p>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-soft">
              The same deterministic execution and independent verification path serves
              <span className="font-mono text-[13px]"> customers_v1</span> and
              <span className="font-mono text-[13px]"> robot_calibration_v1</span>. The robotics
              contract checks migration invariants such as composite row identity, preserved IDs,
              firmware text, decimals, and approved date interpretation; it does not evaluate robot safety.
            </p>
          </div>

          <div className="self-start rounded-card border border-line bg-surface p-6">
            <h3 className="text-sm font-semibold">What is running in this build</h3>
            <ul className="mt-4 space-y-2.5">
              {live.map((item) => (
                <li key={item.label} className="flex items-start gap-2.5 text-sm">
                  <Check size={15} className="mt-0.5 shrink-0 text-ok" aria-hidden />
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>

            {planned.length > 0 && (
            <>
            <h3 className="mt-7 text-sm font-semibold">Designed but not yet connected</h3>
            <ul className="mt-4 space-y-2.5">
            {planned.map((item) => (
            <li key={item.label} className="flex items-start gap-2.5 text-sm text-ink-soft">
              <Minus size={15} className="mt-0.5 shrink-0 text-line" aria-hidden />
            <span>{item.label}</span>
          </li>
        ))}
    </ul>
  </>
)}

            <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-ink-soft">
              Nebius and NVIDIA are named to describe technologies used by MoveProof. Neither company
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
          Walk the verification-first workflow with synthetic customer or robotics fixtures,
          from the proposed plan through human review, verification, commit, and final evidence.
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
