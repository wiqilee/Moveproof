"use client";

import { useState } from "react";
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
            <div className="panel overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_1fr] gap-3 border-b border-line bg-muted/50 px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                <span>In the spreadsheet</span>
                <span aria-hidden />
                <span>In the database</span>
              </div>
              {FAILURE_MODES.map((mode) => (
                <div
                  key={mode.cause}
                  className="border-b border-line px-5 py-4 transition-colors last:border-b-0 hover:bg-muted/30"
                >
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                    {/* The value carries the point, so it is set larger than
                        the prose around it. */}
                    <span className="truncate font-mono text-[17px] font-semibold tracking-tight">
                      {mode.before}
                    </span>
                    <ArrowRight size={15} className="shrink-0 text-ink-soft/60" aria-hidden />
                    <span className="truncate font-mono text-[17px] font-semibold tracking-tight text-bad">
                      {mode.after}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-ink-soft">{mode.cause}</p>
                </div>
              ))}
              <p className="bg-muted/40 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                Successful import is not preserved meaning
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
    <section id="how-it-works" className="scroll-mt-28 border-b border-line">
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

        <ol className="mt-12 grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((stage, index) => (
            <li key={stage.title} className="group relative">
              {/* The rail runs between cards on a wide screen, so the four
                  read as one pipeline rather than four unrelated panels. The
                  segment leaving a hovered card picks up the accent, which is
                  a pointer affordance and not a progress reading. */}
              {index < STAGES.length - 1 && (
                <span
                  className="absolute right-[-1rem] top-9 hidden h-px w-4 bg-line transition-colors duration-200 group-hover:bg-brand group-focus-within:bg-brand lg:block"
                  aria-hidden
                />
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
                  "panel p-5",
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
                  <h3 className="text-[15px] font-semibold tracking-tight">{stage.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-ink-soft">{stage.body}</p>
                <p className="mt-4 border-t border-line pt-3 font-mono text-[11px] text-ink-soft">
                  {stage.detail}
                </p>
              </article>
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
    meaning: "Only deterministic, validated and approved operations execute.",
  },
  {
    clause: "Independent evidence decides",
    meaning: "Verification is separate from the planner.",
  },
  {
    clause: "Humans approve ambiguity",
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
            Each of these is a constraint in the domain layer rather than a promise in the
            interface, which is why a new screen cannot quietly break one.
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
                    className="absolute right-[-0.5rem] top-1/2 hidden h-px w-2 -translate-y-1/2 bg-line transition-colors duration-200 group-hover/clause:bg-brand lg:block"
                    aria-hidden
                  />
                )}
                <button
                  type="button"
                  aria-expanded={active}
                  onClick={() => setPrinciple(active ? null : index)}
                  onMouseEnter={() => setPrinciple(index)}
                  className={[
                    "panel-flat h-full w-full px-4 py-3 text-left",
                    "transition-[transform,border-color,background-color] duration-200",
                    active
                      ? "border-brand bg-brand-soft/60"
                      : "hover:border-brand/40 hover:bg-muted/40",
                    "motion-safe:hover:-translate-y-0.5",
                  ].join(" ")}
                >
                  <span className="flex items-baseline gap-2">
                    <span
                      className={`font-mono text-[11px] font-bold transition-colors ${
                        active ? "text-brand" : "text-ink-soft"
                      }`}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[13px] font-semibold tracking-tight">
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

        <div className="mt-10">
          <p className="eyebrow">Verification boundary</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <article className="panel overflow-hidden">
              <h3 className="border-b border-ok/20 bg-ok-soft/60 px-5 py-3 text-[13px] font-semibold text-ok">
                What MoveProof proves
              </h3>
              <p className="px-5 py-4 text-sm leading-relaxed text-ink-soft">
                A passed verification means the invariants in the approved contract
                held. For a robot calibration migration that is the recorded
                calibration values surviving the declared migration contract.
              </p>
            </article>

            <article className="panel overflow-hidden">
              <h3 className="border-b border-line bg-muted/50 px-5 py-3 text-[13px] font-semibold text-ink-soft">
                What MoveProof does not claim
              </h3>
              <ul className="space-y-2 px-5 py-4 text-sm leading-relaxed text-ink-soft">
                <li>
                  That every possible semantic error has been ruled out. The
                  evidence report says so in its own limitations section.
                </li>
                <li>Calibration correctness.</li>
                <li>Robot behaviour, or hardware safety.</li>
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

export function Technology() {
  const live = IMPLEMENTATION_STATUS.filter((item) => item.state === "live");
  const planned = IMPLEMENTATION_STATUS.filter((item) => item.state === "planned");

  return (
    <section id="technology" className="scroll-mt-28 border-b border-line">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
        {/* Four panels as direct grid children, in reading order:
            narrative, authority path, infrastructure, capabilities.
            That is the DOM order, so the keyboard and a screen reader
            follow the same sequence a reader does on a phone; nothing
            is reordered by CSS alone.
            At lg the same four fall into two columns and two rows,
            which is the approved desktop composition, and items-start
            keeps each panel at its own height. */}
        {/* Top row: open editorial narrative beside the contained technical
            panel. Bottom row: the two supporting surfaces on one row, so their
            top edges align instead of starting at staggered heights.
            DOM order is the reading order, which is also the stacking order
            below lg: narrative, authority path, infrastructure, capabilities. */}
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,43fr)_minmax(0,57fr)] lg:gap-12">
<div>
              <p className="eyebrow">Technology</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.02em] sm:text-[2.5rem]">
                AI proposes.
              <br />
                Validated code executes.
              </h2>
              <p className="mt-6 text-[15px] leading-relaxed text-ink-soft">
                The architecture treats model output as untrusted input. Destination profiles are
                resolved through a server-side registry, proposals are validated against an allowlist
                of supported operations, execution follows the exact approved contract in isolated
                staging, and an independent verifier checks the result before commit is allowed.
              </p>
              <p className="mt-5 text-[15px] leading-relaxed text-ink-soft">
    Model-assisted reasoning runs through Nebius Token Factory. Nemotron 3 Super
    handles the initial planning pass, while deterministic validation can selectively
    escalate harder cases to Nemotron 3 Ultra. Both passes use the same bounded context:
    a schema summary and a small sample of rows. Full datasets are never sent to either model.
  </p>
              <p className="mt-5 text-[15px] leading-relaxed text-ink-soft">
                The same deterministic execution and independent verification path serves
                <span className="font-mono text-[13px]"> customers_v1</span> and
                <span className="font-mono text-[13px]"> robot_calibration_v1</span>. The robotics
                contract checks migration invariants such as composite row identity, preserved IDs,
                firmware text, decimals, and approved date interpretation; it does not evaluate robot safety.
              </p>
            </div>

<div className="panel p-5 lg:self-center">
              <p className="eyebrow">The authority path</p>
              <ol className="mt-4">
                {[
                  { step: "Nebius / AI reasoning", note: "proposes, never executes" },
                  { step: "Deterministic validation", note: "allowlist, issues, acknowledgements" },
                  { step: "Human approval where required", note: "ambiguity is a decision" },
                  { step: "Deterministic execution", note: "runs only the approved version" },
                  { step: "Independent verifier", note: "shares no code with the planner" },
                  { step: "Canonical evidence", note: "one object, three renderings" },
                ].map((item, index, all) => (
                  <li key={item.step} className="group/step relative flex gap-3 pb-5 last:pb-0 sm:pb-6">
                    {/* The spine is blue for its whole length. Every stage in
                        the authority path is part of the architecture, so
                        none of them is drawn as pending: this diagram
                        describes the trusted path, not the state of any one
                        migration. */}
                    {index < all.length - 1 && (
                      <span
                        className="absolute left-[7px] top-4 h-full w-px bg-brand/45 transition-colors duration-200 group-hover/step:bg-brand"
                        aria-hidden
                      />
                    )}
                    <span
                      className="relative mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-brand/80 transition-[background-color,transform] duration-200 group-hover/step:bg-brand motion-safe:group-hover/step:scale-110"
                      aria-hidden
                    >
                      <span className="h-1 w-1 rounded-full bg-on-brand" />
                    </span>
                    <span className="min-w-0 transition-transform duration-200 motion-safe:group-hover/step:translate-x-0.5">
                      <span className="block text-[13px] font-semibold text-ink-soft transition-colors duration-200 group-hover/step:text-ink">
                        {item.step}
                      </span>
                      <span className="block text-xs text-ink-soft">{item.note}</span>
                    </span>
                  </li>
                ))}
              </ol>

              {/* Deliberately grey, deliberately horizontal, deliberately
                  below the spine's end: Tavily branches away from the
                  authority path and never joins it. */}
              <div className="mt-3 flex items-start gap-3 border-t border-line pt-5 sm:pt-6">
                <span className="mt-2 h-px w-6 shrink-0 bg-line" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-ink-soft">
                    Tavily, external evidence
                  </span>
                  <span className="block text-xs leading-relaxed text-ink-soft">
                    Advisory only. It informs a human reading a mapping and has no
                    path to verification state or commit eligibility.
                  </span>
                </span>
              </div>
            </div>
        </div>

        {/* Architecture, then infrastructure, then the running implementation.
            Infrastructure is a compact full-width rail rather than a column
            beside the much longer capability list, which is what made the two
            look unbalanced side by side. */}
        <div className="panel-flat mt-9 px-5 py-4">
            <p className="eyebrow">Infrastructure</p>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {[
                "Next.js / Vercel",
                "FastAPI",
                "Rust verifier",
                "Cloud SQL",
                "private GCS",
                "Nebius Token Factory",
                "Tavily",
              ].map((item) => (
                <li
                  key={item}
                  className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-ink-soft transition-[color,border-color,background-color,transform] duration-200 hover:border-brand/50 hover:bg-brand-soft hover:text-brand motion-safe:hover:scale-[1.02]"
                >
                  {item}
                </li>
              ))}
            </ul>
                                                          </div>

        <div className="panel-flat mt-4 px-5 py-5">
        <h3 className="text-sm font-semibold">What is running in this build</h3>
        <ul className="mt-4 grid gap-2.5 lg:grid-cols-2 lg:gap-x-10">
          {live.map((item) => (
            <li
              key={item.label}
              className="group/row -mx-2 flex items-start gap-2.5 rounded-control px-2 py-1 text-sm text-ink-soft transition-[background-color,color,transform] duration-200 hover:bg-muted/60 hover:text-ink motion-safe:hover:translate-x-0.5"
            >
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

        {/* Row two, spanning both columns. Keeping it inside the right stack
            made the grid row as tall as that stack, which left a hole under
            the shorter narrative panel. A full-width row has no such tie. */}


        {/* Row two: a matched pair, same radius, border and elevation as row
            one, aligned at the top so neither trails a gap under the other. */}
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
        <p className="eyebrow mb-4 text-on-navy/80">Evidence, not assurance</p>
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
