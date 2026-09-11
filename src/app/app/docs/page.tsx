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
            A spreadsheet holds a customer id of 00127. Someone imports it. The
            import reports success, every row lands, and the value in the
            database is now 127. An integer cast stripped the leading zero and
            nothing flagged it, because nothing was technically wrong.
          </p>
          <p>
            MoveProof moves spreadsheet data into a structured database and
            then checks, with code that had no part in writing the
            transformation, whether the values survived.
          </p>
        </Section>

        <Section title="The workflow">
          <p>
            Inspect, plan, review, stage, verify, repair, commit, report. Four
            of those need a decision from you: approving a plan, resolving a
            review item, approving a repair, and committing.
          </p>
          <p>
            A model proposes the mapping. Validated code executes exactly what
            you approved. An independent verifier decides what actually
            happened. You approve anything ambiguous.
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
            contract, and the report says so rather than staying quiet.
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

        <Section title="What is sent to the model">
          <p>
            Only a summary of the schema and a small sample of rows, the size
            of which is shown in Settings. Full datasets never leave the
            backend. The model never emits SQL, shell commands or code, and
            every proposal is validated against an allowlist of supported
            operations before a human or the executor sees it.
          </p>
          <p>
            The model assisted profile is optional. Two deterministic profiles
            work with no credentials at all.
          </p>
        </Section>

        <Section title="Data handling">
          <p>
            The original uploaded bytes are stored alongside the parsed rows so
            a repair has an authoritative source and a checksum can be
            recomputed later. Deleting a migration removes its source, plans,
            runs, staged rows, checks and events, and rolls back any rows it
            committed.
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
