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
    committed,
    commit,
    busy,
    error,
    health,
    migrationId: activeId,
    selectMigration,
  } = useMigration();

  // Two-phase hydration.
  //
  // The single-shot version called loadEvidence() immediately after
  // selectMigration(), using the callback from the render *before* the store
  // learned the new id. On a direct link or a reload that callback still
  // closed over a null or previous migration, and the `loaded` ref then
  // stopped the page from ever trying again.
  //
  // Phase one only asks the store to switch. Phase two runs on a later
  // render, once the store actually reports this migration, and is keyed by
  // migration id so it happens once per migration rather than once per mount.
  const selecting = useRef<string | null>(null);
  const evidenceLoadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (activeId === migrationId) return;
    if (selecting.current === migrationId) return;
    selecting.current = migrationId;
    void selectMigration(migrationId);
  }, [activeId, migrationId, selectMigration]);

  useEffect(() => {
    // Only now is loadEvidence bound to this migration.
    if (activeId !== migrationId) return;
    if (evidenceLoadedFor.current === migrationId) return;
    evidenceLoadedFor.current = migrationId;
    // A failure is left alone rather than retried: the ref stays set, so a
    // dropped request does not become a loop. The user retries explicitly.
    void loadEvidence();
  }, [activeId, migrationId, loadEvidence]);

  return (
    <>
      <TopBar crumbs={migrationCrumbs(migrationId, "Evidence report")} />
      <main className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-7">
        <PageHeading
          eyebrow={migrationId.slice(0, 8)}
          title="Evidence report"
          description="Verified CSV contains the transformed data. JSON, HTML, and PDF render the canonical evidence object assembled from execution and verification records."
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
            onCommit={() => commit()}
            commitError={error}
            committedSignal={committed}
            onRefresh={() => loadEvidence()}
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
