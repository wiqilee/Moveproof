"use client";

import { TopBar } from "@/components/workspace/TopBar";
import { PageHeading } from "@/components/workspace/PageHeading";
import { LINKS } from "@/lib/site";
import { routes } from "@/lib/routes";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line py-7 first:border-t-0 first:pt-0">
      <h2 className="mb-3 text-[15px] font-semibold">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}

export default function DocsPage() {
  return (
    <>
      <TopBar
        crumbs={[{ label: "Workspace", href: routes.workspace }, { label: "Documentation" }]}
      />
      <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-7">
        <PageHeading
          title="Documentation"
          description="What MoveProof does, what it checks, and what it deliberately does not claim."
        />

        <Section title="What this product is for">
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

        <Section title="The workflow">
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

        <Section title="Destination contracts">
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

        <Section title="Supported files">
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

        <Section title="What verification means">
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

        <Section title="Limits of a passed verification">
          <p>
            A passed verification means the invariants in the approved contract
            held. It does not mean every possible semantic error has been ruled
            out. Aggregate reconciliation against a source of truth ledger and
            referential integrity with other tables are outside the current
            contract, and the report says so rather than staying quiet. For robotics,
            migration verification is explicitly not a hardware-safety certification.
          </p>
        </Section>

        <Section title="Review, repair and commit">
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

        <Section title="Verified data export">
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

        <Section title="Model reasoning and data boundaries">
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


<Section title="Selective reasoning escalation">
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


<Section title="External Evidence Check">
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

        <Section title="Data handling">
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

        <Section title="Demo data">
          <p>
            The repository ships a deterministic synthetic dataset generator
            with a fixed seed. It produces files of any size with known hazards
            planted at known positions, along with a manifest used by the test
            suite. The application never reads that manifest: every result it
            shows is computed by executing real checks.
          </p>
        </Section>

        <Section title="More">
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
      </main>
    </>
  );
}
