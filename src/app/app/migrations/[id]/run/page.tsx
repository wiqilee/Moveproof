"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDot,
  FileWarning,
  Loader2,
} from "lucide-react";
import { TopBar } from "@/components/workspace/TopBar";
import { PageHeading } from "@/components/workspace/PageHeading";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useMigration } from "@/lib/migration-store";
import { migrationCrumbs, routes } from "@/lib/routes";

export default function RunPage() {
  const params = useParams<{ id: string }>();
  const migrationId = params.id;
  const router = useRouter();
  const {
    runResult,
    runId,
    verification,
    planVersion,
    busy,
    error,
    runPhase,
    migrationId: activeId,
    selectMigration,
    runVerification,
    hasResults,
  } = useMigration();

  const loaded = useRef(false);
  useEffect(() => {
    if (!loaded.current && activeId !== migrationId) {
      loaded.current = true;
      void selectMigration(migrationId);
    }
  }, [activeId, migrationId, selectMigration]);

  // Execution, specifically. `busy` is set by every store operation including
  // "Loading migration", and showing that as staging told the operator the
  // executor was running when nothing was. The store's own run phase is the
  // only truthful source.
  //
  // There is no progress figure anywhere here on purpose: the backend reports
  // no percentage, and inventing one would be the reassuring fiction this
  // product exists to avoid.
  //
  // The store keeps runPhase at "running" from the moment staging starts until
  // a verification result exists, so on its own it cannot tell "the executor
  // is working" from "staged, waiting for the operator". A run result only
  // exists once staging has finished, which is the distinction this page needs.
  const staging = runPhase === "running" && !runResult;
  const verifying = busy === "Running the verifier";
  const awaitingVerification = Boolean(runResult) && !hasResults && !verifying;

  const stages = [
    {
      label: `Plan ${planVersion ? `v${planVersion} ` : ""}approved`,
      detail: "The exact version the executor runs",
      done: Boolean(planVersion),
      active: false,
    },
    {
      label: "Executing",
      detail: "Original uploaded bytes reparsed, never an earlier staged run",
      done: Boolean(runResult),
      active: staging,
    },
    {
      label: "Staged",
      detail: "Rows written to an isolated staging schema, destination untouched",
      done: Boolean(runResult),
      active: false,
    },
    {
      label: verifying ? "Verifying" : "Ready for verification",
      detail: verifying
        ? "The independent verifier is reading the staged rows back"
        : awaitingVerification
          ? "Waiting for you to run the independent verifier"
          : "An independent verifier reads the staged rows back",
      done: hasResults,
      active: Boolean(runResult) && !hasResults,
      // Waiting on the operator is a state, not work in progress, so it gets
      // a still marker rather than a spinner.
      waiting: awaitingVerification,
    },
  ];

  const verifyNow = async () => {
    await runVerification(runResult?.run_id ?? runId ?? undefined);
    router.push(routes.verification(migrationId));
  };

  return (
    <>
      <TopBar crumbs={migrationCrumbs(migrationId, "Run")} />
      <main className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-7">
        <PageHeading
          eyebrow={migrationId.slice(0, 8)}
          title="Execution"
          description="The executor runs exactly what the approved plan defines, reading the original uploaded bytes rather than any earlier staged output."
          back={{ href: routes.workspace, label: "Back to overview" }}
        />

        {!runResult && runId && !busy ? (
          /* A run exists on the backend, but GET /api/migrations/{id} does not
             return the original row accounting, and no endpoint reconstructs
             it. Saying "never staged" would contradict the record; inventing
             figures would be worse. So the page states exactly what is known. */
          <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-muted/40 px-5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                Previously staged
              </p>
              <span className="ml-auto rounded-full bg-ok-soft px-2.5 py-1 text-[11px] font-semibold text-ok">
                {verification ? "Staged and verified" : "Staged"}
              </span>
            </div>
            <div className="px-5 py-4">
              <p className="text-[13px] leading-relaxed text-ink-soft">
                This migration was staged in run{" "}
                <span className="font-mono">{runId.slice(0, 8)}</span>
                {planVersion ? ` under approved plan v${planVersion}` : ""}.
                {verification
                  ? " Its verification results are stored and can be opened below."
                  : " Verification has not been run against it yet."}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
                Row accounting from that run is not available after reopening:
                the API returns the stored checks, not the original execution
                figures. The evidence report holds the authoritative record.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {verification && (
                  <Button
                    icon={ArrowRight}
                    iconPosition="right"
                    onClick={() => router.push(routes.verification(migrationId))}
                  >
                    Open verification results
                  </Button>
                )}
                {!verification && (
                  <Button
                    onClick={() => void verifyNow()}
                    disabled={busy !== null}
                  >
                    {busy ?? "Run verification"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : !runResult && !busy && !error ? (
          <EmptyState
            title="This run has not been staged yet"
            body="Approve a plan and stage it from the migration wizard."
            action={{ label: "Open the wizard", href: routes.newMigration }}
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
              <div className="flex flex-wrap items-center gap-2 border-b border-line bg-muted/40 px-5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                  Lifecycle
                </p>
                <span
                  className={[
                    "ml-auto rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    staging || verifying
                      ? "bg-brand-soft text-brand"
                      : awaitingVerification
                        ? "bg-warn-soft text-warn"
                        : runResult
                          ? "bg-ok-soft text-ok"
                          : "bg-muted text-ink-soft",
                  ].join(" ")}
                >
                  {staging
                    ? "Staging in progress"
                    : verifying
                      ? "Verification in progress"
                      : awaitingVerification
                        ? "Staged · awaiting verification"
                        : runResult
                          ? "Staging complete"
                          : "Not staged"}
                </span>
              </div>
              <ol className="divide-y divide-line">
                {stages.map((stage) => (
                  <li
                    key={stage.label}
                    className={`flex items-start gap-3 px-5 py-3.5 ${
                      stage.active ? "bg-brand-soft/40" : ""
                    }`}
                  >
                    {stage.done ? (
                      <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-ok" aria-hidden />
                    ) : "waiting" in stage && stage.waiting ? (
                      <CircleDot size={17} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                    ) : stage.active ? (
                      <Loader2 size={17} className="spin mt-0.5 shrink-0 text-brand" aria-hidden />
                    ) : (
                      <Circle size={17} className="mt-0.5 shrink-0 text-line" aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span
                        className={`block text-[13px] ${
                          stage.done || stage.active
                            ? "font-semibold"
                            : "text-ink-soft"
                        }`}
                      >
                        {stage.label}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">
                        {stage.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            {runResult && (
              <>
                {/* The four figures a reviewer actually looks for, before the
                    arithmetic that explains them. */}
                <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                  {[
                    {
                      label: "Source rows",
                      value: runResult.accounting.source_rows,
                      tone: "text-ink",
                      hint: "read from the original upload",
                    },
                    {
                      label: "Staged rows",
                      value: runResult.accounting.staged_rows,
                      tone: "text-ink",
                      hint: "written to the staging schema",
                    },
                    {
                      label: "Eligible to commit",
                      value: runResult.accounting.committable_rows,
                      tone: "text-ok",
                      hint: "after policy exclusions",
                    },
                    {
                      label: "Transform errors",
                      value: runResult.transform_errors,
                      tone: runResult.transform_errors > 0 ? "text-bad" : "text-ink-soft",
                      hint: "rows the executor refused",
                    },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-card border border-line bg-surface px-4 py-3"
                    >
                      <p className={`font-mono text-2xl font-bold tabular-nums ${stat.tone}`}>
                        {stat.value}
                      </p>
                      <p className="mt-1 text-xs font-semibold">{stat.label}</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-ink-soft">
                        {stat.hint}
                      </p>
                    </div>
                  ))}
                </div>

                {runResult.transform_errors > 0 && (
                  <p className="mt-3 flex items-start gap-2 rounded-card border border-bad/30 bg-bad-soft px-4 py-3 text-[13px] leading-relaxed text-ink-soft">
                    <FileWarning size={15} className="mt-0.5 shrink-0 text-bad" aria-hidden />
                    <span>
                      <span className="font-semibold text-bad">
                        {runResult.transform_errors} row(s) were refused
                      </span>{" "}
                      rather than converted under a rule nobody approved. Each
                      refusal and its reason appears in the evidence report.
                    </span>
                  </p>
                )}

                {/* Technical detail, kept and available, visually subordinate. */}
                <details className="group mt-3 overflow-hidden rounded-card border border-line bg-surface">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-[13px] font-semibold text-brand transition-colors hover:bg-brand-soft/50 [&::-webkit-details-marker]:hidden">
                    <span>Row accounting, stated as arithmetic</span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-ink-soft">
              <span className="group-open:hidden">Show</span>
              <span className="hidden group-open:inline">Hide</span>
              <ChevronDown size={14} className="transition-transform duration-200 group-open:rotate-180" aria-hidden />
            </span>
                  </summary>
                  <div className="border-t border-line px-5 py-4">
                    <p className="font-mono text-[13px] leading-loose">
                      {runResult.accounting.arithmetic.map((line) => (
                        <span key={line} className="block">
                          {line}
                        </span>
                      ))}
                    </p>
                    <p className="mt-4 border-t border-line pt-3 font-mono text-[11px] text-ink-soft">
                      run {runResult.run_id.slice(0, 8)} · plan v{runResult.plan_version}
                    </p>
                  </div>
                </details>
              </>
            )}

            <div className="mt-6 flex flex-col gap-3 rounded-card border border-line bg-surface px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-xl text-[13px] leading-relaxed text-ink-soft">
                {runResult
                  ? "Nothing has reached the destination. An independent verifier now reads the staged rows back and checks them against the approved contract."
                  : "Staging has to finish before anything can be verified."}
              </p>
              <Button
                icon={ArrowRight}
                iconPosition="right"
                onClick={() => void verifyNow()}
                disabled={!runResult || busy !== null}
                className="sm:shrink-0"
              >
                {busy ?? "Run verification"}
              </Button>
            </div>
          </>
        )}
      </main>
    </>
  );
}
