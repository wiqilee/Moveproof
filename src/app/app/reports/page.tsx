"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowRight, FileCheck2, FileText, Loader2 } from "lucide-react";
import { TopBar } from "@/components/workspace/TopBar";
import { PageHeading } from "@/components/workspace/PageHeading";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusPill } from "@/components/ui/StatusPill";
import { migrationStatePresentation } from "@/domain/status";
import type { MigrationState } from "@/domain/types";
import { useMigration } from "@/lib/migration-store";
import { API_BASE_URL } from "@/lib/api-client";
import { routes } from "@/lib/routes";

/**
 * The report index.
 *
 * Only migrations that have actually been verified appear. A migration with
 * no run has no evidence, and listing it here with a download link would
 * offer a document that cannot exist.
 */
export default function ReportsPage() {
  const { migrations, migrationsLoading, refreshMigrations, backendReachable, health } =
    useMigration();

  useEffect(() => {
    if (backendReachable) void refreshMigrations();
  }, [backendReachable, refreshMigrations]);

  const withEvidence = migrations.filter((row) => row.verified_at && row.latest_run_id);
  const pdfAvailable = health?.reports.pdf_available ?? false;

  return (
    <>
      <TopBar
        crumbs={[{ label: "Workspace", href: routes.workspace }, { label: "Reports" }]}
      />
      <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-7">
        <PageHeading
          title="Reports"
          description="An evidence report exists once a migration has been staged and verified. Each one is rendered from a single canonical object."
        />

        {migrationsLoading && migrations.length === 0 ? (
          <div
            className="flex items-center gap-2.5 rounded-card border border-line bg-surface px-5 py-8 text-sm text-ink-soft"
            role="status"
          >
            <Loader2 size={15} className="spin" aria-hidden />
            Loading
          </div>
        ) : withEvidence.length === 0 ? (
          <EmptyState
            icon={FileCheck2}
            title="No evidence reports yet"
            body="A report is assembled from execution and verification records. Run a migration through verification and it will appear here."
            action={{ label: "Start a migration", href: routes.newMigration }}
          />
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            {withEvidence.map((row, index) => (
              <div
                key={row.id}
                className={`flex flex-wrap items-center justify-between gap-3 px-4 py-4 ${
                  index > 0 ? "border-t border-line" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.filename}</p>
                  <p className="mt-1 truncate font-mono text-[11px] text-ink-soft">
                    {row.id.slice(0, 8)} · {row.destination_profile ?? "customers_v1"} · plan v{row.approved_plan_version} ·{" "}
                    {row.committed_at ? "committed" : "staged"}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill
                    presentation={
                      migrationStatePresentation[row.state as MigrationState] ??
                      migrationStatePresentation.draft
                    }
                  />
                  <a
                    href={`${API_BASE_URL}/api/migrations/${row.id}/report/html?run_id=${row.latest_run_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-control border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
                  >
                    HTML
                  </a>
                  <a
                    href={`${API_BASE_URL}/api/migrations/${row.id}/evidence?run_id=${row.latest_run_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-control border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
                  >
                    JSON
                  </a>
                  {pdfAvailable ? (
                    <a
                      href={`${API_BASE_URL}/api/migrations/${row.id}/report/pdf?run_id=${row.latest_run_id}`}
                      className="inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
                    >
                      <FileText size={12} aria-hidden />
                      PDF
                    </a>
                  ) : (
                    <span
                      title="The backend reports that PDF generation is unavailable."
                      aria-disabled="true"
                      className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-xs font-semibold opacity-45"
                    >
                      <FileText size={12} aria-hidden />
                      PDF
                    </span>
                  )}
                  <Link
                    href={routes.report(row.id)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                  >
                    Open
                    <ArrowRight size={12} aria-hidden />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
