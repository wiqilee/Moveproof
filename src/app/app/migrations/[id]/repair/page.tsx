"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { TopBar } from "@/components/workspace/TopBar";
import { PageHeading } from "@/components/workspace/PageHeading";
import { EmptyState } from "@/components/ui/EmptyState";
import { RepairProposal } from "@/components/migration/RepairProposal";
import { useMigration } from "@/lib/migration-store";
import { migrationCrumbs, routes } from "@/lib/routes";

export default function RepairPage() {
  const params = useParams<{ id: string }>();
  const migrationId = params.id;
  const router = useRouter();
  const {
    repairProposal,
    loadRepairProposal,
    approvePlan,
    startRun,
    runVerification,
    summary,
    busy,
    migrationId: activeId,
    selectMigration,
  } = useMigration();

  // Two-phase hydration, for the same reason as the report page: the callback
  // captured before selectMigration() resolves still belongs to the previous
  // migration, or to none at all on a direct link.
  const selecting = useRef<string | null>(null);
  const proposalLoadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (activeId === migrationId) return;
    if (selecting.current === migrationId) return;
    selecting.current = migrationId;
    void selectMigration(migrationId);
  }, [activeId, migrationId, selectMigration]);

  useEffect(() => {
    if (activeId !== migrationId) return;
    if (proposalLoadedFor.current === migrationId) return;
    proposalLoadedFor.current = migrationId;
    // No automatic retry on failure; the ref stays set.
    void loadRepairProposal();
  }, [activeId, migrationId, loadRepairProposal]);

  const approveAndRerun = async () => {
    const approved = await approvePlan({ source: "safe", acknowledgements: [] });
    if (!approved) return;
    const runId = await startRun();
    if (!runId) return;
    await runVerification(runId);
    router.push(routes.verification(migrationId));
  };

  return (
    <>
      <TopBar crumbs={migrationCrumbs(migrationId, "Repair")} />
      <main className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-7">
        <PageHeading
          eyebrow={migrationId.slice(0, 8)}
          title="Repair proposal"
          description="Nothing reruns until you approve it, and the revision creates a new plan version rather than editing the approved one."
          back={{
            href: routes.verification(migrationId),
            label: "Back to verification results",
          }}
        />

        {repairProposal ? (
          <RepairProposal
            proposal={repairProposal}
            busy={busy}
            onApprove={() => void approveAndRerun()}
          />
        ) : (
          <EmptyState
            icon={CheckCircle2}
            title={
              summary && summary.failed === 0
                ? "There is no failed invariant to repair"
                : "Loading the diagnosis"
            }
            body="A repair proposal is only meaningful once a verification run has reported a failure."
            action={{
              label: "Back to verification results",
              href: routes.verification(migrationId),
            }}
          />
        )}
      </main>
    </>
  );
}
