"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Minus } from "lucide-react";
import { IMPLEMENTATION_STATUS } from "@/lib/site";
import { routes } from "@/lib/routes";

/* ------------------------------------------------------------------ */
/* Problem                                                             */
/* ------------------------------------------------------------------ */

const FAILURE_MODES = [
  {
    field: "customer_id",
    before: "00127",
    after: "127",
    cause: "An integer cast removes the leading zeros.",
    tone: "bad",
  },
  {
    field: "signup_date",
    before: "03/04/2024",
    after: "2024-03-04",
    cause: "A date-format assumption turns April 3 into March 4.",
    tone: "warn",
  },
  {
    field: "balance",
    before: "1200.55",
    after: "1200.5499",
    cause: "A numeric conversion changes the amount by a fraction of a cent.",
    tone: "bad",
  },
  {
    field: "firmware_version",
    before: "3.10",
    after: "3.1",
    cause: "Parsing a version as a number drops its trailing zero.",
    tone: "bad",
  },
  {
    field: "rows",
    before: "2 rows",
    after: "1 row",
    cause: "A duplicate is removed without an approved policy.",
    tone: "warn",
  },
] as const;

/**
 * Full class strings per tone, so Tailwind can see every one of them.
 * Hover is decoration only: every value and cause is visible without it.
 */
const TONE = {
  bad: {
    bar: "group-hover:bg-bad",
    line: "from-brand to-bad",
    dot: "group-hover:bg-bad",
    head: "group-hover:text-bad",
    after: "text-bad group-hover:bg-bad-soft",
  },
  warn: {
    bar: "group-hover:bg-warn",
    line: "from-brand to-warn",
    dot: "group-hover:bg-warn",
    head: "group-hover:text-warn",
    after: "text-warn group-hover:bg-warn-soft",
  },
} as const;

export function ProblemSection() {
  return (
    <section id="problem" className="scroll-mt-28 border-b border-line bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)] lg:gap-16">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              The problem
            </p>
            <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-[-0.02em] sm:text-[2.5rem]">
              The import succeeded.
              <br />
              But did the data keep its meaning?
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-soft">
              An import can finish without errors even when critical values change. Row counts may
              match and logs may remain clean while customer identifiers, dates, or robot
              calibration metadata lose their intended meaning.
            </p>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-soft">
              Data migrations often involve operations teams and consultants alongside database
              specialists. A misspelled name may be easy to spot. A data-type conversion applied
              consistently across thousands of rows is far harder to detect.
            </p>
          </div>

          <div>
            <div className="panel overflow-hidden">
              <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,1fr)] gap-3 border-b border-line bg-muted/50 px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-ink-soft sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)]">
                <span>In the spreadsheet</span>
                <span aria-hidden />
                <span>In the database</span>
              </div>
              {FAILURE_MODES.map((mode) => {
                const tone = TONE[mode.tone];
                return (
                  <div
                    key={mode.cause}
                    className="group relative border-b border-line px-5 py-4 transition-colors duration-300 last:border-b-0 hover:bg-muted/40"
                  >
                    {/* Accent bar in the row's failure colour. */}
                    <span
                      aria-hidden
                      className={[
                        "absolute inset-y-3 left-0 w-0.5 rounded-full bg-transparent transition-colors duration-300",
                        tone.bar,
                      ].join(" ")}
                    />
                    <p className="mb-1 font-mono text-[10px] tracking-wide text-ink-soft/80">
                      {mode.field}
                    </p>
                    <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)]">
                      {/* The value carries the point, so it is set larger than
                          the prose around it. */}
                      <span className="truncate font-mono text-[17px] font-semibold tracking-tight transition-colors duration-300 group-hover:text-brand">
                        {mode.before}
                      </span>

                      {/* The connector: a blue source fades into the failure
                          colour as the value travels into the database. */}
                      <span aria-hidden className="relative flex h-4 items-center">
                        <span className="h-px w-full bg-line" />
                        <span
                          className={[
                            "absolute left-0 h-[2px] w-0 rounded-full bg-gradient-to-r transition-[width] duration-500 ease-out group-hover:w-[calc(100%-10px)]",
                            tone.line,
                          ].join(" ")}
                        />
                        <span
                          className={[
                            "absolute left-0 h-2 w-2 -translate-y-0 rounded-full bg-brand opacity-0 shadow-[0_0_10px_currentColor] transition-[left,opacity,background-color] duration-700 ease-out group-hover:left-[calc(100%-14px)] group-hover:opacity-100",
                            tone.dot,
                          ].join(" ")}
                        />
                        <ArrowRight
                          size={15}
                          className={[
                            "absolute -right-1 shrink-0 text-ink-soft/60 transition-[color,transform] duration-300 group-hover:translate-x-0.5",
                            tone.head,
                          ].join(" ")}
                        />
                      </span>

                      <span
                        className={[
                          "-mx-1.5 justify-self-start truncate rounded-md px-1.5 font-mono text-[17px] font-semibold tracking-tight transition-colors duration-300",
                          tone.after,
                        ].join(" ")}
                      >
                        {mode.after}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-ink-soft transition-colors duration-300 group-hover:text-ink">
                      {mode.cause}
                    </p>
                  </div>
                );
              })}
              <p className="bg-muted/40 px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                A successful import doesn&rsquo;t guarantee data integrity.
              </p>
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
    body: "NVIDIA Nemotron 3 Super proposes a typed mapping plan. When deterministic validation identifies two or more concerns, MoveProof escalates to Nemotron 3 Ultra for deeper reasoning. Tavily provides advisory context, while human reviewers resolve ambiguities and approve the plan.",
    detail: "Plan v1 · 7 operations · 2 review items",
  },
  {
    title: "Verify the staged result",
    body: "A verifier that shares no code with the planner checks the staged data against the approved contract.",
    detail: "9 checks · 7 passed · 0 failed · 2 not verified",
  },
  {
    title: "Commit with evidence",
    body: "Commit stays blocked until nothing mandatory is outstanding, and the report records what was never checked.",
    detail: "5 rows committed · 2 properties not verified",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-28 border-b border-line">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            How it works
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.02em] sm:text-[2.5rem]">
            Four milestones.
            <br />
            Eight controlled stages.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
            Customer records and robot calibration data use the same eight-stage path: inspect,
            plan, review, stage, verify, repair, commit, report. Four stages require an explicit
            decision from you.
          </p>
        </div>

        <ol className="mt-12 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((stage, index) => (
            <li key={stage.title} className="group relative">
              {/* The rail runs between cards on a wide screen, so the four
                  read as one pipeline rather than four unrelated panels. The
                  segment leaving a hovered card picks up the accent, which is
                  a pointer affordance and not a progress reading. */}
              {index < STAGES.length - 1 && (
                <span
                  className="absolute right-[-1rem] top-9 hidden h-0.5 w-4 overflow-hidden rounded-full bg-line lg:block"
                  aria-hidden
                >
                  <span className="block h-full w-0 rounded-full bg-gradient-to-r from-brand to-brand/50 shadow-[0_0_8px_rgb(var(--color-brand)/0.8)] transition-[width] duration-500 ease-out group-hover:w-full group-focus-within:w-full" />
                </span>
              )}
              {/* Scale is deliberately tiny and paired with a translate, so a
                  hovered card lifts without nudging its neighbours. Transform
                  is motion-safe only; the colour feedback always applies.
                  The focus-within rules are carried alongside hover so the
                  state exists the moment a card gains a focusable child. These
                  cards are descriptive text today, so no tab stop is added to
                  them: a focus ring on something that cannot be actioned is
                  worse for a keyboard user than no stop at all. */}
              <article
                className={[
                  "panel flex h-full flex-col p-5",
                  "transition-[transform,box-shadow,border-color] duration-200 ease-out",
                  "motion-safe:group-hover:-translate-y-1 motion-safe:group-hover:scale-[1.012]",
                  "motion-safe:group-focus-within:-translate-y-1 motion-safe:group-focus-within:scale-[1.012]",
                  "group-hover:border-brand/40 group-focus-within:border-brand/40",
                ].join(" ")}
                style={{ transformOrigin: "center" }}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={[
                      "flex h-7 w-7 items-center justify-center rounded-full",
                      "bg-navy font-mono text-[11px] font-bold text-on-navy",
                      "transition-colors duration-200",
                      "group-hover:bg-brand group-focus-within:bg-brand",
                    ].join(" ")}
                  >
                    {index + 1}
                  </span>
                  <h3 className="text-[15px] font-semibold tracking-tight transition-colors duration-300 group-hover:text-brand group-focus-within:text-brand">
                    {stage.title}
                  </h3>
                </div>
                <p className="mb-4 mt-3 text-sm leading-relaxed text-ink-soft">{stage.body}</p>
                <p className="mt-auto border-t border-line pt-3 font-mono text-[11px] text-ink-soft">
                  {stage.detail}
                </p>
              </article>
            </li>
          ))}
        </ol>
        {/* The four details describe one example run end to end, so the
            numbers agree: nothing failed, and commit was therefore allowed. */}
        <p className="mt-4 text-xs text-ink-soft">
          Illustrative figures from one example run. Every mandatory check passed, so commit was
          allowed; the two properties not verified are recorded in the evidence report.
        </p>
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
    body: "In the model-assisted profile, the model proposes transformations. A separate verifier that shares no code with the planner decides whether they held. A model confirming its own output would not count as verification.",
    example: "Planner and verifier are separate modules by construction.",
  },
  {
    title: "Plans are versioned and immutable",
    body: "An approved plan is never edited. A repair creates a new version with a reviewable diff, and every executed operation names the version it came from.",
    example: "Plan v1 stays on the record, including the cast that failed.",
  },
  {
    title: "Not verified never means passed",
    body: "Results are reported in four separate counts rather than one score, so a property that was never checked cannot be mistaken for one that held.",
    example: "Passed · Failed · Review required · Not verified.",
  },
];

/**
 * The four principles, each with the one fact it stands on.
 *
 * Every meaning here is already stated elsewhere on this page or in the
 * product; nothing new is claimed. The four are simultaneously true, which is
 * why none of them is ever drawn as pending or complete.
 */
const OPERATING_MODEL = [
  { clause: "AI proposes", meaning: "Model output is treated as untrusted input." },
  {
    clause: "Validated code executes",
    meaning: "Only deterministic, validated, and approved operations run.",
  },
  {
    clause: "Independent evidence decides",
    meaning: "Verification runs independently of the planner.",
  },
  {
    clause: "Humans resolve ambiguity",
    meaning: "Ambiguous interpretation requires explicit human choice.",
  },
];

export function Approach() {
  // Hover and tap both set this, so the supporting line is reachable without a
  // pointer. The buttons are real buttons, so keyboard activation works too.
  const [principle, setPrinciple] = useState<number | null>(null);

  return (
    <section id="approach" className="scroll-mt-28 border-b border-line bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            The approach
          </p>

          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.025em] sm:text-[2.5rem] sm:leading-[1.1]">
            Three rules the code enforces
          </h2>

          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
            Each rule is enforced in the domain layer rather than promised by the interface, so
            a new screen cannot quietly break it.
          </p>
        </div>

        {/* Four principles, all true at once. They are not stages and not the
            headings of the three rules below, so they get their own label and
            their own connected rail. */}
        <p className="eyebrow mt-10">Operating model</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {OPERATING_MODEL.map((item, index) => {
            const active = principle === index;
            return (
              <li key={item.clause} className="group/clause relative">
                {/* The rail connects the four, and strengthens beside whichever
                    one the pointer is on. It carries no state of its own. */}
                {index < OPERATING_MODEL.length - 1 && (
                  <span
                    className="absolute right-[-0.5rem] top-1/2 hidden h-0.5 w-2 -translate-y-1/2 overflow-hidden rounded-full bg-line lg:block"
                    aria-hidden
                  >
                    <span
                      className={[
                        "block h-full rounded-full bg-brand shadow-[0_0_8px_rgb(var(--color-brand)/0.8)] transition-[width] duration-500 ease-out group-hover/clause:w-full",
                        active ? "w-full" : "w-0",
                      ].join(" ")}
                    />
                  </span>
                )}
                <button
                  type="button"
                  aria-expanded={active}
                  onClick={() => setPrinciple(active ? null : index)}
                  onMouseEnter={() => setPrinciple(index)}
                  className={[
                    "panel-flat h-full w-full px-4 py-3 text-left",
                    "transition-[transform,border-color,background-color,box-shadow] duration-300 ease-out",
                    "hover:shadow-[0_10px_28px_-16px_rgb(var(--color-brand)/0.45)]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                    active
                      ? "border-brand/60 bg-brand-soft/60 shadow-[0_10px_28px_-16px_rgb(var(--color-brand)/0.45)]"
                      : "hover:border-brand/40 hover:bg-muted/40 focus-visible:border-brand/40",
                    "motion-safe:hover:-translate-y-0.5 motion-safe:focus-visible:-translate-y-0.5",
                  ].join(" ")}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={[
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-bold transition-[color,background-color,border-color,box-shadow] duration-300",
                        active
                          ? "border-brand bg-brand text-on-brand shadow-[0_0_0_4px_rgb(var(--color-brand)/0.15),0_0_14px_rgb(var(--color-brand)/0.55)]"
                          : "border-line text-ink-soft group-hover/clause:border-brand group-hover/clause:bg-brand group-hover/clause:text-on-brand group-hover/clause:shadow-[0_0_0_4px_rgb(var(--color-brand)/0.15),0_0_14px_rgb(var(--color-brand)/0.55)]",
                      ].join(" ")}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={[
                        "text-[13px] font-semibold tracking-tight transition-colors duration-300",
                        active ? "text-brand" : "group-hover/clause:text-brand",
                      ].join(" ")}
                    >
                      {item.clause}
                    </span>
                  </span>
                  <span className="mt-1.5 block text-[12px] leading-relaxed text-ink-soft">
                    {item.meaning}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="eyebrow mt-10">Enforced rules</p>
        <ol className="mt-3 space-y-2.5">
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
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line font-mono text-[12px] font-bold tabular-nums text-ink-soft transition-[color,background-color,border-color,box-shadow] duration-300 group-hover:border-brand group-hover:bg-brand group-hover:text-on-brand group-hover:shadow-[0_0_0_5px_rgb(var(--color-brand)/0.15),0_0_16px_rgb(var(--color-brand)/0.55)]"
                      aria-hidden
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>

                    <h3 className="text-xl font-semibold leading-snug tracking-[-0.015em] transition-colors duration-300 group-hover:text-brand sm:text-[1.35rem]">
                      {principle.title}
                    </h3>
                  </div>

                  <div>
                    <p className="text-[15px] leading-relaxed text-ink/75">
                      {principle.body}
                    </p>

                    <p className="mt-4 flex items-start gap-3">
                      <span
                        className="mt-[0.45rem] h-px w-4 shrink-0 bg-line"
                        aria-hidden
                      />
                      <span className="font-mono text-[11.5px] leading-relaxed tracking-tight text-ink-soft">
                        {principle.example}
                      </span>
                    </p>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ol>

        <div className="mt-10">
          <p className="eyebrow">Verification boundary</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <article className="panel overflow-hidden">
              <h3 className="border-b border-ok/20 bg-ok-soft/60 px-5 py-3 text-[13px] font-semibold text-ok">
                What MoveProof proves
              </h3>
              <p className="px-5 py-4 text-sm leading-relaxed text-ink-soft">
                A passed verification means the invariants in the approved contract
                held. For a robot calibration migration, that means the recorded
                calibration values survived the declared migration contract.
              </p>
            </article>

            <article className="panel overflow-hidden">
              <h3 className="border-b border-line bg-muted/50 px-5 py-3 text-[13px] font-semibold text-ink-soft">
                What MoveProof does not claim
              </h3>
              <ul className="space-y-2 px-5 py-4 text-sm leading-relaxed text-ink-soft">
                <li>
                  That every possible semantic error has been ruled out. The
                  evidence report states this in its limitations section.
                </li>
                <li>Calibration correctness.</li>
                <li>Robot behavior or hardware safety.</li>
              </ul>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Technology                                                          */
/* ------------------------------------------------------------------ */

/**
 * The authority path, as six steps. The diagram walks them one at a time to
 * show the order of control. Highlighting a step means "this is where the
 * eye is", never "this step succeeded": nothing here is a migration result.
 */
const AUTHORITY_STEPS = [
  {
    step: "Nebius / AI reasoning",
    note: "proposes, never executes",
    detail:
      "Nemotron 3 Super drafts a typed plan from a schema summary and up to five rows. Ultra joins only on escalation. The output is data, never SQL.",
  },
  {
    step: "Deterministic validation",
    note: "allowlist, issues, acknowledgements",
    detail:
      "Every proposed operation is checked against the allowlist. A lossy operation needs an acknowledgement by column name before it can be approved.",
  },
  {
    step: "Human approval where required",
    note: "ambiguity is a decision",
    detail:
      "Ambiguous dates and decimals need an explicit human choice. Approval binds one immutable plan version.",
  },
  {
    step: "Deterministic execution",
    note: "runs only the approved version",
    detail:
      "The executor runs exactly the approved version into isolated staging. Nothing reaches the destination yet.",
  },
  {
    step: "Independent verifier",
    note: "shares no code with the planner",
    detail:
      "Staged rows are read back and checked against the approved contract. Not verified is never reported as passed.",
  },
  {
    step: "Canonical evidence",
    note: "one object, three renderings",
    detail:
      "One canonical evidence object renders as JSON, HTML and PDF. Commit stays gated in the database until nothing mandatory is outstanding.",
  },
] as const;

/** Index of the step Tavily's advisory branch points at: the human decision. */
const TAVILY_TARGET = 2;
const STEP_MS = 2600;

/** Tavily sits outside the authority path. It informs step 3 and nothing else. */
function TavilyBranch({ lit = false }: { lit?: boolean }) {
  return (
    <div
      className={[
        "rounded-control border border-dashed p-3.5 transition-[border-color,background-color,box-shadow] duration-300",
        lit
          ? "border-brand/70 bg-brand-soft/50 shadow-[0_0_0_4px_rgb(var(--color-brand)/0.08),0_10px_28px_-16px_rgb(var(--color-brand)/0.5)]"
          : "border-ink-soft/40 bg-muted/40",
      ].join(" ")}
    >
      <p className="flex items-center gap-2 text-[13px] font-semibold">
        <span
          className={[
            "h-2 w-2 rounded-full border transition-colors duration-300",
            lit ? "border-brand bg-brand" : "border-ink-soft/60",
          ].join(" ")}
          aria-hidden
        />
        Tavily, external evidence
      </p>
      <p className="mt-1 inline-flex rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
        Advisory only
      </p>
      <p className="mt-2 text-xs leading-relaxed text-ink-soft">
        Public references that inform the human decision in step 3. Cannot affect verification
        state or commit eligibility.
      </p>
    </div>
  );
}

function AuthorityPathDiagram() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [motion, setMotion] = useState(true);

  useEffect(() => {
    setMotion(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (paused || !motion) return;
    const timer = window.setInterval(
      () => setActive((current) => (current + 1) % AUTHORITY_STEPS.length),
      STEP_MS
    );
    return () => window.clearInterval(timer);
  }, [paused, motion]);

  const current = AUTHORITY_STEPS[active];

  return (
    <div
      className="panel p-5 sm:p-6 lg:self-center"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">The authority path</p>
        <span className="font-mono text-[10px] text-ink-soft">
          {paused || !motion ? "paused · select a step" : "auto · hover to explore"}
        </span>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,13rem)] sm:items-start">
        {/* The execution authority path. */}
        <ol className="relative">
          {AUTHORITY_STEPS.map((item, index) => {
            const isActive = index === active;
            const last = index === AUTHORITY_STEPS.length - 1;
            return (
              <li key={item.step} className="relative pb-4 last:pb-0">
                {!last && (
                  <span aria-hidden className="absolute left-[11px] top-7 h-[calc(100%-1.25rem)] w-px bg-line">
                    {/* Line-draw into the next step while this one is active. */}
                    <span
                      className={[
                        "absolute inset-x-0 top-0 bg-brand transition-[height] ease-out",
                        isActive && motion && !paused ? "h-full duration-[2400ms]" : "h-0 duration-300",
                      ].join(" ")}
                    />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setActive(index)}
                  onMouseEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  aria-pressed={isActive}
                  className={[
                    "group/step relative flex w-full items-start gap-3 rounded-control px-1 py-1.5 text-left transition-colors duration-300",
                    isActive ? "bg-brand-soft/60" : "hover:bg-muted/50",
                  ].join(" ")}
                >
                  <span
                    aria-hidden
                    className={[
                      "relative mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-bold transition-all duration-300",
                      isActive
                        ? "border-brand bg-brand text-on-brand shadow-[0_0_0_5px_rgb(var(--color-brand)/0.16)]"
                        : "border-brand/40 bg-surface text-brand",
                    ].join(" ")}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={[
                        "block text-[13px] font-semibold transition-colors duration-300",
                        isActive ? "text-ink" : "text-ink-soft",
                      ].join(" ")}
                    >
                      {item.step}
                    </span>
                    <span className="block text-xs text-ink-soft">{item.note}</span>
                  </span>
                </button>
                {index === TAVILY_TARGET && (
                  // Anchored to this step, so the branch always lines up
                  // with the human decision it informs. Desktop only.
                  <div className="absolute left-[calc(100%+1.25rem)] top-0 hidden w-[13rem] sm:block">
                    <TavilyBranch lit={isActive} />
                    <span
                      aria-hidden
                      className="absolute right-full top-[17px] flex w-5 items-center"
                    >
                      <span
                        className={[
                          "h-0 w-0 border-y-[4px] border-r-[6px] border-y-transparent transition-colors duration-300",
                          isActive ? "border-r-brand" : "border-r-ink-soft/60",
                        ].join(" ")}
                      />
                      <span
                        className={[
                          "h-px flex-1 border-t border-dashed transition-colors duration-300",
                          isActive ? "border-brand" : "border-ink-soft/60",
                        ].join(" ")}
                      />
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {/* Reserves the column the advisory branch occupies on wider screens;
            on a phone the branch follows the list instead. */}
        <div aria-hidden className="hidden sm:block" />
        <div className="sm:hidden">
          <TavilyBranch lit={active === TAVILY_TARGET} />
        </div>
      </div>

      {/* What the focused step means. */}
      <div className="mt-5 border-t border-line pt-4" aria-live="polite">
        <p className="font-mono text-[10px] uppercase tracking-wider text-brand">
          Step {active + 1} of {AUTHORITY_STEPS.length}
        </p>
        <p key={active} className="mt-1 min-h-[3.75rem] text-sm leading-relaxed text-ink-soft motion-safe:animate-[mp-fade_400ms_ease-out]">
          <span className="font-semibold text-ink">{current.step}.</span> {current.detail}
        </p>
      </div>
    </div>
  );
}

/**
 * What each piece of infrastructure does inside MoveProof, shown as a small
 * terminal when its chip is hovered or focused. Snippets are illustrative
 * shapes of the real interfaces, not captured output.
 */
const INFRA = [
  {
    name: "Next.js / Vercel",
    role: "The workspace. It renders every state the API reports and never decides commit eligibility itself.",
    lines: ["GET /api/migrations/{id}", "→ render plan, checks, evidence", "commit button = server decides"],
  },
  {
    name: "FastAPI",
    role: "The workflow API: upload, propose, validate, approve, stage, verify, commit, report.",
    lines: ["POST /api/migrations", "POST /api/migrations/{id}/approve", "POST /api/migrations/{id}/commit"],
  },
  {
    name: "Rust verifier",
    role: "Canonical whole-row reconciliation, compiled into the backend container. JSON in on stdin, JSON out.",
    lines: ["$ moveproof-verifier < staged.json", "canonicalise rows · hash · compare", "00127 ≠ 127   1200.50 = 1200.5"],
  },
  {
    name: "Cloud SQL",
    role: "PostgreSQL 16: control plane, isolated staging, destination, and the database-backed commit gate.",
    lines: ["SELECT … FOR UPDATE", "assert_commit_allowed()  -- 7 conditions", "CHECK (written + skipped = expected)"],
  },
  {
    name: "private GCS",
    role: "Private object storage for the deployed backend. Nothing in it is public.",
    lines: ["bucket: private", "access: backend service account", "public URLs: none"],
  },
  {
    name: "Nebius Token Factory",
    role: "Serves NVIDIA Nemotron 3 Super by default and Nemotron 3 Ultra on escalation, from the same bounded input.",
    lines: ["model: nvidia/nemotron-3-super-120b-a12b", "escalate: nvidia/Nemotron-3-Ultra-550b-a55b", "input: schema + ≤ 5 rows"],
  },
  {
    name: "Tavily",
    role: "Metadata-only queries for advisory references. Raw cell values never leave MoveProof.",
    lines: ["query: column, type, operation", "values sent: none", "result: advisory sources"],
  },
] as const;

const INFRA_MS = 3400;

function InfrastructureExplorer() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [motion, setMotion] = useState(true);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const item = INFRA[active];

  useEffect(() => {
    setMotion(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  // Walks the components on its own; hovering or focusing any of them pins
  // the terminal to that one until the pointer leaves.
  useEffect(() => {
    if (paused || !motion) return;
    const timer = window.setInterval(
      () => setActive((current) => (current + 1) % INFRA.length),
      INFRA_MS
    );
    return () => window.clearInterval(timer);
  }, [paused, motion]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <ul className="mt-2.5 flex flex-wrap gap-1.5">
        {INFRA.map((entry, index) => {
          const isActive = index === active;
          return (
            <li key={entry.name}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onClick={() => setActive(index)}
                aria-pressed={isActive}
                className={[
                  "rounded-full border px-2 py-0.5 font-mono text-[11px] transition-[color,border-color,background-color,transform] duration-200 motion-safe:hover:scale-[1.03]",
                  isActive
                    ? "border-brand/50 bg-brand-soft text-brand"
                    : "border-line text-ink-soft hover:border-brand/50 hover:text-brand",
                ].join(" ")}
              >
                {entry.name}
              </button>
            </li>
          );
        })}
      </ul>

      {/* A small terminal with a gentle 3D tilt toward the pointer. */}
      <div className="mt-4" style={{ perspective: "900px" }}>
        <div
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setTilt({
              x: ((event.clientY - rect.top) / rect.height - 0.5) * -8,
              y: ((event.clientX - rect.left) / rect.width - 0.5) * 10,
            });
          }}
          onMouseLeave={() => setTilt({ x: 0, y: 0 })}
          className="overflow-hidden rounded-control border border-white/10 bg-gradient-to-b from-[#0b1222] to-[#070b15] shadow-lift transition-transform duration-200 ease-out dark:border-[#e2e8f0] dark:from-white dark:to-[#f1f5f9]"
          style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}
        >
          <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2 dark:border-[#e2e8f0]">
            <span className="h-2 w-2 rounded-full bg-[#ef4444]/70" />
            <span className="h-2 w-2 rounded-full bg-[#f59e0b]/70" />
            <span className="h-2 w-2 rounded-full bg-[#22c55e]/70" />
            <span className="ml-2 truncate font-mono text-[10px] text-[#8b9bb8] dark:text-[#64748b]">
              moveproof · {item.name.toLowerCase()}
            </span>
          </div>
          <div key={active} className="px-3.5 py-3">
            <p className="text-xs leading-relaxed text-[#cbd5e1] motion-safe:animate-[mp-fade_350ms_ease-out] dark:text-[#334155]">
              {item.role}
            </p>
            <div className="mt-2.5 space-y-1 font-mono text-[11px]">
              {item.lines.map((line, index) => (
                <p
                  key={line}
                  className="truncate text-[#93c5fd] motion-safe:animate-[mp-line_450ms_ease-out_both] dark:text-[#1d4ed8]"
                  style={{ animationDelay: `${150 + index * 220}ms` }}
                >
                  <span className="mr-2 text-[#475569] dark:text-[#94a3b8]">{index === 0 ? "›" : " "}</span>
                  {line}
                </p>
              ))}
              <p
                className="text-[#475569] motion-safe:animate-[mp-line_450ms_ease-out_both] dark:text-[#94a3b8]"
                style={{ animationDelay: `${150 + item.lines.length * 220}ms` }}
              >
                <span className="motion-safe:animate-pulse">▍</span>
              </p>
            </div>
          </div>
        </div>
        <p className="mt-2 text-[10px] text-ink-soft">
          {paused || !motion ? "Paused. Hover a component to see its role." : "Auto. Hover to pause."}{" "}
          Snippets are illustrative.
        </p>
      </div>
    </div>
  );
}

export function Technology() {
  const live = IMPLEMENTATION_STATUS.filter((item) => item.state === "live");
  const planned = IMPLEMENTATION_STATUS.filter((item) => item.state === "planned");

  return (
    <section id="technology" className="scroll-mt-28 border-b border-line">
      {/* Two small keyframes shared by the diagram and the terminal. */}
      <style>{`
        @keyframes mp-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        @keyframes mp-line { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
      `}</style>

      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,43fr)_minmax(0,57fr)] lg:gap-12">
          <div>
            <p className="eyebrow">Technology</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.02em] sm:text-[2.5rem]">
              AI proposes.
              <br />
              Validated code executes.
            </h2>
            <p className="mt-6 text-[15px] leading-relaxed text-ink-soft">
              MoveProof treats AI-generated mappings as proposals, never as executable
              instructions. Every proposed plan must pass deterministic validation and receive
              human approval before execution.
            </p>
            <p className="mt-5 text-[15px] leading-relaxed text-ink-soft">
              NVIDIA Nemotron 3 Super, served through Nebius Token Factory, drafts a typed mapping
              plan from a schema summary and up to five sample rows. When deterministic validation
              identifies two or more concerns, MoveProof escalates to Nemotron 3 Ultra for deeper
              reasoning.{" "}
              <span className="font-semibold text-ink">More reasoning. No extra authority.</span>
            </p>
            <p className="mt-5 text-[15px] leading-relaxed text-ink-soft">
              An independent verifier checks staged data against the approved contract before
              commit. The same safeguards apply to customer records and robot calibration data.
              Tavily provides advisory context for human review but cannot change verification
              results or commit eligibility.
            </p>
          </div>

          <AuthorityPathDiagram />
        </div>

        {/* One implementation surface: infrastructure beside the running build. */}
        <div className="panel-flat mt-8 overflow-hidden">
          <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="border-b border-line px-5 py-5 lg:border-b-0 lg:border-r">
              <p className="eyebrow text-ink">Infrastructure</p>
              <InfrastructureExplorer />
            </div>
            <div className="px-5 py-5">
              <h3 className="text-sm font-semibold">What is running in this build</h3>
              <ul className="mt-3 grid gap-2.5 xl:grid-cols-2 xl:gap-x-8">
                {live.map((item) => (
                  <li
                    key={item.label}
                    className="group/row -mx-2 flex items-start gap-2.5 rounded-control px-2 py-1 text-sm text-ink-soft transition-[background-color,color,transform] duration-200 hover:bg-muted/60 hover:text-ink motion-safe:hover:translate-x-0.5"
                  >
                    {/* Same colour as the text at rest; verified green on hover. */}
                    <span
                      aria-hidden
                      className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-line text-ink-soft transition-[color,background-color,border-color,box-shadow] duration-300 group-hover/row:border-ok group-hover/row:bg-ok group-hover/row:text-white group-hover/row:shadow-[0_0_0_4px_rgb(var(--color-ok)/0.15),0_0_12px_rgb(var(--color-ok)/0.5)]"
                    >
                      <Check size={11} strokeWidth={3} />
                    </span>
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
            </div>
          </div>
          <p className="border-t border-line px-5 py-3.5 text-xs leading-relaxed text-ink-soft">
            Nebius and NVIDIA are named to describe technologies used by MoveProof. Neither company
            endorses this project.
          </p>
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
    <section className="relative overflow-hidden border-b border-line bg-navy text-on-navy">
      {/* The same measurement grid as the rig, so the page closes in the
          language it opened with. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgb(255 255 255 / 0.12) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.12) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse at 50% 0%, black, transparent 72%)",
          WebkitMaskImage: "radial-gradient(ellipse at 50% 0%, black, transparent 72%)",
        }}
      />
      <div className="relative mx-auto max-w-4xl px-5 py-24 text-center sm:px-6">
        {/* on-navy at 60% sat below the contrast floor on the dark canvas.
            80% stays clearly subordinate to the heading while remaining
            readable in both themes. */}
        {/* The .eyebrow class is declared after @tailwind utilities in
            globals.css, so at equal specificity its own colour wins and a
            text-* utility beside it is ignored. That is why the earlier
            contrast change here had no visible effect. The type is spelled
            out instead, which puts the colour under this element's control
            without touching the shared class. */}
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-on-navy/90">
        Verification evidence
        </p>
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
