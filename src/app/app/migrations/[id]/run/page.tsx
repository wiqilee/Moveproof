"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
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
    planVersion,
    busy,
    error,
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

  const stages = [
    { label: "Upload validated and stored", done: true },
    { label: `Plan ${planVersion ? `v${planVersion}` : ""} approved`, done: Boolean(planVersion) },
    { label: "Original bytes reparsed", done: Boolean(runResult) },
    { label: "Transformation staged", done: Boolean(runResult) },
    { label: "Verification", done: hasResults },
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

        {!runResult && !busy && !error ? (
          <EmptyState
            title="This run has not been staged yet"
            body="Approve a plan and stage it from the migration wizard."
            action={{ label: "Open the wizard", href: routes.newMigration }}
          />
        ) : (
          <>
            <div className="rounded-card border border-line bg-surface p-5">
              <ol>
                {stages.map((stage) => (
                  <li key={stage.label} className="flex items-center gap-2.5 py-2">
                    {stage.done ? (
                      <CheckCircle2 size={16} className="text-ok" aria-hidden />
                    ) : busy ? (
                      <Loader2 size={16} className="spin text-brand" aria-hidden />
                    ) : (
                      <Circle size={16} className="text-line" aria-hidden />
                    )}
                    <span className={stage.done ? "text-sm" : "text-sm text-ink-soft"}>
                      {stage.label}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            {runResult && (
              <div className="mt-4 rounded-card border border-line bg-surface p-5">
                <p className="mb-3 text-xs font-semibold text-ink-soft">Row accounting</p>
                <p className="font-mono text-sm leading-loose">
                  {runResult.accounting.arithmetic.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </p>
                <p className="mt-4 border-t border-line pt-3 text-xs text-ink-soft">
                  Run {runResult.run_id.slice(0, 8)} · plan v{runResult.plan_version} ·{" "}
                  {runResult.transform_errors} transformation error(s)
                </p>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <Button
                onClick={() => void verifyNow()}
                disabled={!runResult || busy !== null}
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
