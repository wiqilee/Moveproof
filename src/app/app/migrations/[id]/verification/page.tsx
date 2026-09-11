"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { FileSearch } from "lucide-react";
import { TopBar } from "@/components/workspace/TopBar";
import { PageHeading } from "@/components/workspace/PageHeading";
import { EmptyState } from "@/components/ui/EmptyState";
import { VerificationResults } from "@/components/migration/VerificationResults";
import { useMigration } from "@/lib/migration-store";
import { migrationCrumbs, routes } from "@/lib/routes";

export default function VerificationPage() {
  const params = useParams<{ id: string }>();
  const migrationId = params.id;
  const router = useRouter();
  const {
    checks,
    summary,
    hasResults,
    runId,
    planVersion,
    runResult,
    busy,
    migrationId: activeId,
    selectMigration,
  } = useMigration();

  const loaded = useRef(false);
  useEffect(() => {
    if (!loaded.current && activeId !== migrationId) {
      loaded.current = true;
      void selectMigration(migrationId);
    }
  }, [activeId, migrationId, selectMigration]);

  return (
    <>
      <TopBar crumbs={migrationCrumbs(migrationId, "Verification")} />
      <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-7">
        <PageHeading
          eyebrow={migrationId.slice(0, 8)}
          title="Verification results"
          description="Produced by a verifier that shares no code with the planner, reading the rows as they were actually written to staging."
          back={{ href: routes.workspace, label: "Back to overview" }}
        />

        {hasResults && summary ? (
          <VerificationResults
            checks={checks}
            summary={summary}
            accounting={runResult?.accounting}
            runLabel={`Run ${runId?.slice(0, 8) ?? "unknown"} · plan v${planVersion ?? "?"}`}
            busy={busy}
            onRepair={() => router.push(routes.repair(migrationId))}
            onContinue={() => router.push(routes.report(migrationId))}
          />
        ) : (
          <EmptyState
            icon={FileSearch}
            title="No verification has run for this migration yet"
            body="There is nothing to report until a plan has been staged and checked. Nothing is inferred in the browser."
            action={{ label: "Open the run", href: routes.run(migrationId) }}
          />
        )}
      </main>
    </>
  );
}
