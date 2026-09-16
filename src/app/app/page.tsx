"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileSearch, Loader2, Plus, RefreshCw } from "lucide-react";
import { TopBar } from "@/components/workspace/TopBar";
import { PageHeading } from "@/components/workspace/PageHeading";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusPill } from "@/components/ui/StatusPill";
import { migrationStatePresentation } from "@/domain/status";
import type { MigrationState } from "@/domain/types";
import { MigrationActions } from "@/components/migration/MigrationActions";
import { useMigration } from "@/lib/migration-store";
import type { ErrorState } from "@/lib/migration-store";
import { routes } from "@/lib/routes";

function stateLabel(row: {
  state: string;
  approved_plan_version: number | null;
  verified_at: string | null;
  committed_at: string | null;
}): string {
  if (row.committed_at) return "committed";
  if (row.verified_at) return "verified, awaiting your decision";
  if (row.approved_plan_version) return `plan v${row.approved_plan_version} approved`;
  return "uploaded, no plan approved yet";
}

export default function OverviewPage() {
  const { migrations, migrationsLoading, refreshMigrations, backendReachable } =
    useMigration();
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ErrorState | null>(null);

  useEffect(() => {
    if (backendReachable) void refreshMigrations();
  }, [backendReachable, refreshMigrations]);

  const counts = {
    total: migrations.length,
    committed: migrations.filter((m) => m.committed_at).length,
    awaiting: migrations.filter((m) => m.verified_at && !m.committed_at).length,
    draft: migrations.filter((m) => !m.approved_plan_version).length,
  };

  return (
    <>
      <TopBar crumbs={[{ label: "Workspace", href: routes.workspace }, { label: "Overview" }]} />
      <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-7">
        <PageHeading
          title="Overview"
          description="Every figure here is read from the backend. Nothing on this page is computed in the browser."
          action={
            <Link
              href={routes.newMigration}
              className="inline-flex items-center gap-2 rounded-control bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand shadow-sm transition-colors hover:bg-brand/90 active:translate-y-px"
            >
              <Plus size={15} aria-hidden />
              New migration
            </Link>
          }
        />

        {migrations.length > 0 && (
          <section aria-label="Workspace summary" className="mb-8">
            <div className="grid grid-cols-2 divide-line rounded-card border border-line bg-surface sm:grid-cols-4 sm:divide-x">
              {[
                { label: "Migrations", value: counts.total, tone: "text-ink" },
                { label: "Awaiting a decision", value: counts.awaiting, tone: "text-warn" },
                { label: "Committed", value: counts.committed, tone: "text-ok" },
                { label: "No plan yet", value: counts.draft, tone: "text-ink-soft" },
              ].map((stat) => (
                <div key={stat.label} className="px-5 py-4">
                  <p className={`font-mono text-[1.75rem] font-semibold leading-none ${stat.tone}`}>
                    {stat.value}
                  </p>
                  <p className="mt-2 text-xs text-ink-soft">{stat.label}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section aria-label="Migrations">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-ink-soft">Migrations</h2>
            <button
              onClick={() => void refreshMigrations()}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-soft transition-colors hover:bg-muted hover:text-ink"
            >
              <RefreshCw size={12} aria-hidden />
              Refresh
            </button>
          </div>

          {notice && (
            <p
              role="status"
              className="mb-3 rounded-card border border-line bg-muted/60 px-4 py-2.5 text-sm"
            >
              {notice}
            </p>
          )}

          {actionError && (
            <div className="mb-3 rounded-card border border-bad/30 bg-bad-soft px-4 py-3">
              <p className="text-sm font-semibold text-bad">{actionError.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">
                {actionError.detail}
              </p>
            </div>
          )}

          {migrationsLoading && migrations.length === 0 ? (
            <div
              className="flex items-center gap-2.5 rounded-card border border-line bg-surface px-5 py-8 text-sm text-ink-soft"
              role="status"
            >
              <Loader2 size={15} className="spin" aria-hidden />
              Loading migrations
            </div>
          ) : migrations.length === 0 ? (
            <EmptyState
              icon={FileSearch}
              title="No migrations yet"
              body="Upload a spreadsheet to start one. Counts and verification results appear here once a migration has been staged and checked."
              action={{ label: "Start a migration", href: routes.newMigration }}
            />
          ) : (
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              {migrations.map((row, index) => {
                // A draft has no screen of its own to open. It used to link to
                // the wizard, which resets on mount, so the row looked like it
                // would resume an upload and never did. Until a draft has an
                // approved plan there is nothing to navigate to, so the row
                // stays put and the actions menu carries the only thing you
                // can actually do with it.
                const destination = row.verified_at
                  ? routes.verification(row.id)
                  : row.approved_plan_version
                    ? routes.run(row.id)
                    : null;

                const summary = (
                  <>
                    <p className="truncate text-sm font-medium">{row.filename}</p>
                    <p className="mt-1 truncate font-mono text-xs text-ink-soft">
                      {row.id.slice(0, 8)} · {row.row_count} rows · {stateLabel(row)}
                    </p>
                  </>
                );

                return (
                  <div
                    key={row.id}
                    className={`flex items-center justify-between gap-4 px-4 py-4 ${
                      index > 0 ? "border-t border-line" : ""
                    }`}
                  >
                    {/* The link covers the summary rather than the whole row,
                        so the actions button is not nested inside an anchor. */}
                    {destination ? (
                      <Link
                        href={destination}
                        className="-m-2 min-w-0 flex-1 rounded-md p-2 transition-colors hover:bg-muted/60"
                      >
                        {summary}
                      </Link>
                    ) : (
                      <div className="min-w-0 flex-1">{summary}</div>
                    )}

                    <div className="flex shrink-0 items-center gap-2">
                      <StatusPill
                        presentation={
                          migrationStatePresentation[row.state as MigrationState] ??
                          migrationStatePresentation.draft
                        }
                      />
                      {destination && (
                        <ArrowRight size={15} className="text-line" aria-hidden />
                      )}
                      <MigrationActions
                        migration={{
                          id: row.id,
                          filename: row.filename,
                          committed: row.committed_at !== null,
                        }}
                        onError={(error) => {
                          setNotice(null);
                          setActionError(error);
                        }}
                        onDone={({ rowsRemoved }) => {
                          setActionError(null);
                          setNotice(
                            rowsRemoved === null
                              ? `Deleted ${row.filename}.`
                              : `Rolled back ${rowsRemoved} row(s) and deleted ${row.filename}.`
                          );
                          void refreshMigrations();
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
