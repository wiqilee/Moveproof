"use client";

import { useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { FileText } from "lucide-react";
import { TopBar } from "@/components/workspace/TopBar";
import { PageHeading } from "@/components/workspace/PageHeading";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { EvidenceReportView } from "@/components/migration/EvidenceReport";
import { useMigration } from "@/lib/migration-store";
import { migrationCrumbs, routes } from "@/lib/routes";

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const migrationId = params.id;
  const {
    evidence,
    loadEvidence,
    commitAllowed,
    commit,
    busy,
    error,
    health,
    migrationId: activeId,
    selectMigration,
  } = useMigration();

  const loaded = useRef(false);
  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      const boot = async () => {
        if (activeId !== migrationId) await selectMigration(migrationId);
        await loadEvidence();
      };
      void boot();
    }
  }, [activeId, migrationId, selectMigration, loadEvidence]);

  return (
    <>
      <TopBar crumbs={migrationCrumbs(migrationId, "Evidence report")} />
      <main className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-7">
        <PageHeading
          eyebrow={migrationId.slice(0, 8)}
          title="Evidence report"
          description="Assembled by the backend from execution and verification records. The JSON export and the PDF render this same object."
          back={{
            href: routes.verification(migrationId),
            label: "Back to verification results",
          }}
        />

        {evidence ? (
          <EvidenceReportView
            evidence={evidence}
            commitAllowed={commitAllowed}
            busy={busy}
            pdfAvailable={health?.reports.pdf_available ?? false}
            onCommit={() => void commit()}
          />
        ) : busy ? (
          <Spinner label={busy} />
        ) : (
          <EmptyState
            icon={FileText}
            title="There is no evidence to report yet"
            body={
              error?.detail ??
              "An evidence report is assembled from execution and verification records. Neither exists until a migration has been staged and checked."
            }
            action={{ label: "Open the run", href: routes.run(migrationId) }}
          />
        )}
      </main>
    </>
  );
}
