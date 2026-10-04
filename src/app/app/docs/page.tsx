"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Bot,
  Cpu,
  Database,
  FileCheck2,
  FileSpreadsheet,
  GitCommit,
  Info,
  Search,
  Shield,
  ShieldCheck,
  Upload,
  Workflow,
} from "lucide-react";
import { TopBar } from "@/components/workspace/TopBar";
import { PageHeading } from "@/components/workspace/PageHeading";
import { LINKS } from "@/lib/site";
import { routes } from "@/lib/routes";

/**
 * One documentation section.
 *
 * A rule and an icon rather than a card. Twenty identical bordered boxes would
 * read as a dashboard; this page is meant to read as documentation, so the
 * hierarchy comes from whitespace, a hairline and a single scanning aid.
 *
 * The icon is decorative: the heading already carries the meaning, so it is
 * hidden from assistive technology and never becomes a tab stop.
 */
function Section({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-28 border-t border-line py-9 first:border-t-0 first:pt-0"
    >
      <h2 className="mb-3 flex items-center gap-2.5 text-[15px] font-semibold">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-ink-soft"
          aria-hidden
        >
          <Icon size={15} />
        </span>
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}

/**
 * A boundary worth stopping at.
 *
 * Reserved for the handful of statements a reader must not skim: what a pass
 * does not mean, what external evidence cannot do, what robotics verification
 * does not certify. Ordinary prose stays prose.
 */
function Callout({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "warn";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={[
        "rounded-card border px-4 py-3.5",
        tone === "warn" ? "border-warn/30 bg-warn-soft/50" : "border-line bg-muted/40",
      ].join(" ")}
    >
      <p
        className={`flex items-center gap-2 text-[13px] font-semibold ${
          tone === "warn" ? "text-warn" : "text-ink"
        }`}
      >
        <Info size={14} className="shrink-0" aria-hidden />
        {title}
      </p>
      <div className="mt-1.5 space-y-2 text-[13px] leading-relaxed text-ink-soft">
        {children}
      </div>
    </div>
  );
}


/** The page's own sections, in order. One list, so the nav cannot drift. */
const SECTIONS = [
  { id: "purpose", title: "What this product is for" },
  { id: "workflow", title: "The workflow" },
  { id: "demo", title: "Demo data" },
  { id: "one-file", title: "One source file per migration" },
  { id: "destinations", title: "Destination contracts" },
  { id: "production", title: "Production verification status" },
  { id: "files", title: "Supported files" },
  { id: "verification", title: "What verification means" },
  { id: "limits", title: "Limits of a passed verification" },
  { id: "commit", title: "Review, repair and commit" },
  { id: "export", title: "Verified data export" },
  { id: "model", title: "Model reasoning and data boundaries" },
  { id: "routing", title: "Selective reasoning escalation" },
  { id: "evidence", title: "External Evidence Check" },
  { id: "data", title: "Data handling" },
  { id: "more", title: "More" },
];

/** Derived once, so the observer's dependency never changes identity. */
const SECTION_IDS = SECTIONS.map((section) => section.id);

/**
 * Which section the reader is currently in.
 *
 * The scroll container is the window. The workspace layout uses `min-h-screen`
 * with no overflow container, so the document itself scrolls and the TopBar is
 * sticky inside it.
 *
 * The previous version used IntersectionObserver and took the topmost section
 * still inside a band. That is what caused the stuck highlight: a long section
 * such as External Evidence Check stays inside the band while several short
 * ones below it come and go, so the long one kept winning and the final
 * sections never activated.
 *
 * The rule here is positional and deterministic instead: the active section is
 * the last heading whose top has crossed an activation line just under the
 * sticky chrome. Scrolling past a heading always advances the highlight, long
 * section or short, and it cannot oscillate because only one heading can be
 * the last to have crossed.
 *
 * One exception, at the end of the page: the final sections may be too short
 * to ever reach the activation line, so when the container is scrolled to the
 * bottom the last section wins outright.
 */
const ACTIVATION_OFFSET = 136; // sticky chrome plus a little reading room

function useActiveSection(ids: string[]): [string, (id: string) => void] {
  const [active, setActive] = useState(ids[0] ?? "");

  useEffect(() => {
    if (ids.length === 0) return;

    let frame = 0;

    // Arriving with a hash is its own case. On a direct load of
    // /app/docs#demo the browser performs its jump after React mounts, and
    // measuring before that jump reads the top of the page. Honouring the
    // hash immediately means the right entry is lit from the first paint,
    // whatever the scroll position happens to be at that instant.
    const fromHash = window.location.hash.slice(1);
    if (fromHash && ids.includes(fromHash)) setActive(fromHash);

    const measure = () => {
      frame = 0;

      // The reading line.
      //
      // A fixed line near the top works for every section that still has a
      // screenful of content beneath it, and fails for the ones that do not.
      // Data handling and More sit at the end of the document, so no amount of
      // scrolling can ever lift their headings to a line 136px from the top:
      // the page simply runs out. That is the root cause, and no bottom
      // special case for the final section fixes the one before it.
      //
      // So the line relaxes over the final screenful. While there is more than
      // a viewport left to scroll it stays where it is. Inside the last
      // viewport it slides down in proportion to how much scrolling remains,
      // reaching the bottom of the viewport exactly when the document does.
      //
      // Every tail section therefore gets its turn, in order, and the rule is
      // still "the last heading above the line" throughout. Scrolling back up
      // reverses it continuously, so nothing sticks.
      const maxScroll =
        document.documentElement.scrollHeight - window.innerHeight;
      const remaining = Math.max(0, maxScroll - window.scrollY);
      const inFinalScreen = remaining < window.innerHeight;
      const progress = inFinalScreen
        ? 1 - remaining / Math.max(1, window.innerHeight)
        : 0;
      const line =
        ACTIVATION_OFFSET + progress * (window.innerHeight - ACTIVATION_OFFSET);

      // Sections are in document order, so the first heading still below the
      // line ends the search.
      let current = ids[0];
      for (const id of ids) {
        const element = document.getElementById(id);
        if (!element) continue;
        if (element.getBoundingClientRect().top <= line) current = id;
        else break;
      }

      setActive(current);
    };

    // Measurement is cheap but reading layout on every scroll event is not, so
    // it is coalesced into one frame.
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };

    // The browser's own hash jump, any late layout from fonts or the sticky
    // chrome, and image or panel reflow all land after mount. Measuring once
    // on the next frame, and again after load, means the highlight settles on
    // the real position rather than on the position at mount.
    if (!fromHash) measure();
    frame = window.requestAnimationFrame(measure);
    window.addEventListener("load", onScroll);

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // Arriving on /app/docs#demo, or clicking a TOC entry, moves the page
    // without necessarily emitting a scroll event the listener above sees.
    window.addEventListener("hashchange", onScroll);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("hashchange", onScroll);
      window.removeEventListener("load", onScroll);
    };
  }, [ids]);

  // The setter is handed back so a click can light its own entry at once
  // instead of waiting for the scroll that follows it.
  return [active, setActive];
}

export default function DocsPage() {
  // SECTIONS is module-level and never reassigned, so the id list is stable
  // and the effect above does not re-subscribe on every render.
  const [active, setActive] = useActiveSection(SECTION_IDS);

  return (
    <>
      <TopBar
        crumbs={[{ label: "Workspace", href: routes.workspace }, { label: "Documentation" }]}
      />
      <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-7">
        <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_200px] xl:gap-12">
          <div className="min-w-0 max-w-3xl">
        <PageHeading
          title="Documentation"
          description="What MoveProof does, what it checks, and what it deliberately does not claim."
        />

        <Section id="purpose" title="What this product is for" icon={BookOpen}>
          <p>
          A spreadsheet contains a customer ID of 00127. Someone imports it. The
          import reports success, every row lands, and the value in the database
          is now 127. An integer cast stripped the leading zero, and nothing
          flagged it because nothing was technically invalid.
          </p>
          <p>
            MoveProof moves spreadsheet data into an explicit destination
            contract and then checks, with code that had no part in writing the
            transformation, whether the values survived. The same architecture
            currently serves customer migrations and per-joint robot calibration data.
          </p>
        </Section>

        <Section id="workflow" title="The workflow" icon={Workflow}>
          <p>
            Inspect, plan, review, stage, verify, repair, commit, report. Four
            of those need a decision from you: approving a plan, resolving a
            review item, approving a repair, and committing.
          </p>
          <p>
            Nemotron 3 Super proposes the initial mapping. MoveProof then validates
            that proposal deterministically. When the validator detects multiple
            independent concerns, the same bounded context may be selectively
            escalated to Nemotron 3 Ultra for deeper reasoning. Validated code
            executes exactly what you approved. An independent verifier determines
            what actually happened, and you approve anything ambiguous. When field
            semantics are unclear, External Evidence Check can retrieve advisory
            public references to help inform that decision without changing
            verification results or commit eligibility.
          </p>
        </Section>

        <Section id="demo" title="Demo data" icon={Bot}>
          <p>
            The repository ships a deterministic synthetic dataset generator
            with a fixed seed. It produces files of any size with known hazards
            planted at known positions, along with a manifest used by the test
            suite. The application never reads that manifest: every result it
            shows is computed by executing real checks.
          </p>
        </Section>

        <Section id="one-file" title="One source file per migration" icon={FileSpreadsheet}>
          <Callout title="Why one file">
            <p>
              MoveProof deliberately processes one source file per migration. This keeps
              the source checksum, approved plan, execution run, verification results,
              evidence artifacts, commit and rollback isolated under one auditable
              migration record.
            </p>
          </Callout>
          <p>
            When one migration is finished, start a new migration for the next source
            file. Related files are not silently merged into a single execution scope.
            This keeps failures and rollback boundaries explicit.
          </p>
        </Section>

        <Section id="destinations" title="Destination contracts" icon={Database}>
          <p>
            MoveProof currently exposes two server-defined destination profiles:
            <span className="font-mono"> customers_v1</span> for customer records and
            <span className="font-mono"> robot_calibration_v1</span> for per-joint
            calibration records. The selected profile is stored with the migration,
            so planning, execution, verification, evidence, export, commit and rollback
            resolve the same contract.
          </p>
          <p>
            Robotics row identity is the composite key
            <span className="font-mono"> (robot_id, joint_name)</span>. The verifier
            separately checks that identifier-like values such as
            <span className="font-mono"> 0017</span> and firmware text such as
            <span className="font-mono"> 3.08</span> survive the move, while ambiguous
            dates and decimal conventions require an explicit human decision.
          </p>
          <p>
            A passed robotics migration verifies those approved data invariants. It
            does not determine whether a calibration value is physically correct,
            command a robot, or certify hardware safety.
          </p>
        </Section>

        <Section id="production" title="Production verification status" icon={ShieldCheck}>
          <p>
            The deployed <span className="font-mono">robot_calibration_v1</span>
            workflow has been exercised end to end with the clean, ambiguous and
            multi-joint robotics fixtures. The clean path remained on Nemotron 3
            Super, the ambiguous path exercised deterministic escalation to Nemotron
            3 Ultra and explicit human decisions, and the multi-joint path preserved
            composite <span className="font-mono">(robot_id, joint_name)</span>
            identity.
          </p>
          <p>
            Production checks also exercised verified CSV export, evidence generation,
            commit behavior, fail-closed destination conflicts and rollback. This
            status is evidence about migration integrity, not a statement that
            MoveProof validated physical calibration quality or robot safety.
          </p>
        </Section>

        <Section id="files" title="Supported files" icon={Upload}>
          <p>
            CSV, TSV, XLSX and XLSM, up to the size limit shown in Settings.
            Encoding and delimiter are detected. Every cell is read as text: no
            value is coerced to a number or a date during parsing, because a
            parser that guesses can destroy a leading zero before anybody has
            approved anything.
          </p>
          <p>
            A cell containing something like =SUM(A1:A9) is stored exactly as
            written and never evaluated.
          </p>
        </Section>

        <Section id="verification" title="What verification means" icon={FileCheck2}>
          <p>
            Results come back in four categories that do not overlap. Passed
            means a check ran and succeeded. Failed means an approved invariant
            was violated. Review required means a human decision is
            outstanding. Not verified means the property was never checked.
          </p>
          <p>
            The fourth category matters most. A property that was not checked
            is never folded into a passing score, and the evidence report names
            every one of them.
          </p>
        </Section>

        <Section id="limits" title="Limits of a passed verification" icon={Shield}>
          <Callout tone="warn" title="What a pass does not mean">
            <p>
              A passed verification means the invariants in the approved contract
              held. It does not mean every possible semantic error has been ruled
              out. Aggregate reconciliation against a source of truth ledger and
              referential integrity with other tables are outside the current
              contract, and the report says so rather than staying quiet. For robotics,
              migration verification is explicitly not a hardware-safety certification.
            </p>
          </Callout>
        </Section>

        <Section id="commit" title="Review, repair and commit" icon={GitCommit}>
          <p>
            Commit is blocked while any mandatory check has failed or awaits a
            decision. That gate lives in the backend and is checked again
            against stored records at commit time, so it cannot be bypassed by
            a screen that forgot to disable a button.
          </p>
          <p>
            A repair never edits the approved plan. It creates a new version
            with a reviewable diff, and the rerun reads the original uploaded
            file again. A leading zero destroyed by an integer cast cannot be
            recovered from the integer, so the repair has to return to the
            source.
          </p>
          <p>
            A commit that meets an existing destination row fails closed rather
            than skipping it quietly. Skipping requires an explicit policy.
          </p>
        </Section>

        <Section id="export" title="Verified data export" icon={FileSpreadsheet}>
          <p>
            After a migration passes verification, MoveProof can export the
            verified transformed dataset as CSV. The export is generated by the
            backend from stored verified data rather than reconstructed from
            browser state, preserving identifier values such as 00127.
          </p>
          <p>
            Verified CSV is available when a migration is ready to commit and
            remains available after commit. Failed or unverified migrations
            cannot be exported as verified data.
          </p>
          <p>
            CSV contains the verified transformed dataset. JSON, HTML and PDF
            serve a different purpose: they contain the migration evidence and
            audit record.
          </p>
        </Section>

        <Section id="model" title="Model reasoning and data boundaries" icon={Cpu}>
  <p>
    Only a summary of the schema and a small bounded sample of rows, the
    size of which is shown in Settings, can enter model-assisted reasoning.
    Full datasets are never sent to the model. Both the routine and
    escalation passes use the same bounded sampling path rather than
    sending additional rows to the deeper reasoning model.
  </p>

  <p>
    Nemotron 3 Super, served through Nebius Token Factory, handles the
    initial model-assisted planning pass. Its output is treated as
    untrusted input and validated deterministically against the supported
    operation allowlist.
  </p>

  <p>
    The model never emits SQL, shell commands, or executable code. Two
    deterministic profiles also remain available without live model
    credentials, keeping the core migration and verification workflow
    reproducible in local and test environments.
  </p>
</Section>


<Section id="routing" title="Selective reasoning escalation" icon={Cpu}>
  <p>
    MoveProof does not ask the model whether it needs a more powerful
    model. The routing decision is made by deterministic validation of the
    initial Super proposal.
  </p>

  <p>
    A validator concern is something MoveProof already knows how to detect,
    such as a mapping that requires explicit acknowledgement or a
    non-fatal validation issue. If fewer than two concerns are detected, MoveProof keeps the Super proposal.
    Two or more concerns can trigger a second reasoning pass
    with Nemotron 3 Ultra when escalation is configured.
  </p>

  <p>
    The Ultra pass receives the same bounded model context and remains
    subject to the same parsing, allowlist validation, human approval, and
    execution gates as the initial proposal. Escalation does not grant the
    model authority to execute transformations, approve a plan, change a
    verification result, or commit destination data.
  </p>

  <p>
    If the escalation model is not configured, MoveProof continues with
    the validated Super proposal. If an escalation request fails, the
    Super proposal remains available and the failure is recorded rather
    than granting additional authority.
  </p>
</Section>


<Section id="evidence" title="External Evidence Check" icon={Search}>
  <p>
    Some migration questions cannot be answered from the uploaded data
    alone. A value such as 00127 may clearly be zero-padded, but the
    dataset itself may not establish whether that formatting is
    semantically required by the source system.
  </p>
  <p>
    External Evidence Check lets a reviewer retrieve public references
    through Tavily while reviewing an ambiguous mapping. The reviewer
    chooses from a fixed set of questions, and MoveProof constructs the
    query on the backend.
  </p>
  <p>
    Only validated schema and review metadata are sent. Uploaded files,
    full datasets, sampled rows and raw cell values are not sent to
    Tavily.
  </p>
  <p>
    The returned sources are advisory. They cannot approve a plan,
    modify data, change a verification result, satisfy a mandatory
    check or bypass the commit gate. The reviewer remains responsible
    for deciding whether the external evidence is relevant and
    trustworthy.
  </p>
  <p>
    External Evidence Check is enabled in the production deployment and
    has been verified through a real Tavily runtime request.
  </p>
</Section>

        <Section id="data" title="Data handling" icon={Shield}>
        <p>
         The original uploaded bytes are stored alongside the parsed rows so
         a repair has an authoritative source and a checksum can be
         recomputed later. Robot calibration files can contain operationally
         sensitive values and are handled under the same private-data boundary
         as every other uploaded dataset.
        </p>
        <p>
         Deleting an uncommitted or already rolled-back migration removes
         its source, plans, runs, staged rows, checks and events. A committed
         migration cannot be deleted directly. Its committed destination
          rows must first be removed through an explicit rollback, and the
          migration itself can only be deleted after that rollback succeeds.
       </p>
       <p>
          Human approvals recorded in an evidence report are audit entries.
          They are not cryptographic signatures, and the product does not
          describe them as such.
      </p>
      </Section>



        <Section id="more" title="More" icon={Info}>
          <p>
            The repository README covers setup, testing and deployment in full.
          </p>
          <p>
            <a
              href={LINKS.github.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand hover:underline"
            >
              Open the repository
            </a>
          </p>
        </Section>
          </div>

          {/* On this page. Generated from the same ids the sections already
              carry, sticky beside the prose, and gone below xl where it would
              crowd the text rather than help it. It supplements the sidebar
              and never replaces it. */}
          <nav aria-label="On this page" className="hidden xl:block">
            <div className="sticky top-24">
              <p className="eyebrow">On this page</p>
              <ul className="mt-3 space-y-1.5 border-l border-line">
                {SECTIONS.map((section) => {
                  const current = active === section.id;
                  return (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        onClick={() => setActive(section.id)}
                        aria-current={current ? "location" : undefined}
                        className={[
                          "-ml-px block border-l py-0.5 pl-3 text-[13px] transition-colors",
                          current
                            ? "border-brand bg-brand-soft/40 font-semibold text-ink"
                            : "border-transparent text-ink-soft hover:border-brand hover:text-ink",
                        ].join(" ")}
                      >
                        {section.title}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          </nav>
        </div>
      </main>
    </>
  );
}
