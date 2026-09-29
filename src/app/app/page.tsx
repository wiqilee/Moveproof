"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileSearch, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { TopBar } from "@/components/workspace/TopBar";
import { PageHeading } from "@/components/workspace/PageHeading";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusPill } from "@/components/ui/StatusPill";
import { migrationStatePresentation } from "@/domain/status";
import { api, describeError } from "@/data/api";
import type { MigrationState } from "@/domain/types";
import { MigrationActions } from "@/components/migration/MigrationActions";
import { useMigration } from "@/lib/migration-store";
import type { ErrorState } from "@/lib/migration-store";
import { routes } from "@/lib/routes";

/**
 * What the operator can actually do next, and whether evidence exists.
 *
 * Every value here comes from the migration list the backend already returns.
 * A draft genuinely cannot be resumed, so it says so rather than offering a
 * link that would silently restart the wizard.
 */
function nextAction(row: {
  approved_plan_version: number | null;
  verified_at: string | null;
  committed_at: string | null;
}): { label: string; evidence: string } {
  if (row.committed_at)
    return { label: "Open evidence", evidence: "Evidence available" };
  if (row.verified_at)
    return { label: "Review and commit", evidence: "Evidence available" };
  if (row.approved_plan_version)
    return { label: "Continue to execution", evidence: "No evidence yet" };
  return { label: "Restart required", evidence: "No evidence yet" };
}

function stateLabel(row: {
  state: string;
  approved_plan_version: number | null;
  verified_at: string | null;
  committed_at: string | null;
}): string {
  if (row.committed_at) return "committed";
  if (row.verified_at) return "verified, awaiting your decision";
  if (row.approved_plan_version) return `plan v${row.approved_plan_version} approved`;
  // A draft cannot be resumed: the wizard resets on mount, and no API returns
  // a half-finished migration to it. Saying so is kinder than a row that
  // simply refuses to open and leaves the operator guessing.
  return "draft · restart required";
}

export default function OverviewPage() {
  const { migrations, migrationsLoading, refreshMigrations, backendReachable } =
    useMigration();
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ErrorState | null>(null);
  const [deleteDraftsOpen, setDeleteDraftsOpen] = useState(false);
  const [deleteDraftsBusy, setDeleteDraftsBusy] = useState(false);

  useEffect(() => {
    if (backendReachable) void refreshMigrations();
  }, [backendReachable, refreshMigrations]);

  const draftMigrations = migrations.filter(
    (migration) => !migration.approved_plan_version && !migration.committed_at
  );

  const deleteAllDrafts = async () => {
    if (draftMigrations.length === 0 || deleteDraftsBusy) return;

    const total = draftMigrations.length;
    let deleted = 0;

    setDeleteDraftsBusy(true);
    setNotice(null);
    setActionError(null);

    try {
      for (const migration of draftMigrations) {
        await api.deleteMigration(migration.id);
        deleted += 1;
      }

      setNotice(`Deleted ${deleted} draft migration${deleted === 1 ? "" : "s"}.`);
    } catch (caught) {
      setActionError(describeError(caught));

      if (deleted > 0) {
        setNotice(
          `Deleted ${deleted} of ${total} draft migrations before the operation stopped.`
        );
      }
    } finally {
      setDeleteDraftsOpen(false);
      setDeleteDraftsBusy(false);
      void refreshMigrations();
    }
  };

  const counts = {
    total: migrations.length,
    committed: migrations.filter((m) => m.committed_at).length,
    awaiting: migrations.filter((m) => m.verified_at && !m.committed_at).length,
    draft: draftMigrations.length,
  };

  return (
    <>
      <TopBar crumbs={[{ label: "Workspace", href: routes.workspace }, { label: "Overview" }]} />
      <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-7">
        <PageHeading
          title="Overview"
          description="Every figure here is derived from backend migration records. No synthetic metrics are shown."
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
            <div className="grid grid-cols-2 divide-line panel sm:grid-cols-4 sm:divide-x">
              {[
                {
                  label: "Migrations",
                  value: counts.total,
                  tone: "text-ink",
                  hint: "uploads on record",
                },
                {
                  label: "No plan yet",
                  value: counts.draft,
                  tone: "text-ink-soft",
                  hint: "nothing approved",
                },
                {
                  label: "Awaiting a decision",
                  value: counts.awaiting,
                  tone: "text-warn",
                  hint: "verified, not committed",
                },
                {
                  label: "Committed",
                  value: counts.committed,
                  tone: "text-ok",
                  hint: "written with evidence",
                },
                // Ordered along the lifecycle rather than by importance, so the
                // row reads as a workflow instead of a metrics strip.
              ].map((stat) => (
                <div key={stat.label} className="px-5 py-4">
                  <p
                    className={`font-mono text-[1.9rem] font-semibold leading-none tabular-nums ${stat.tone}`}
                  >
                    {stat.value}
                  </p>
                  <p className="mt-2 text-xs font-semibold">{stat.label}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-ink-soft">
                    {stat.hint}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section aria-label="Migrations">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-ink-soft">Migrations</h2>

            <div className="flex items-center gap-1">
              {draftMigrations.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDeleteDraftsOpen(true)}
                  disabled={deleteDraftsBusy}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-bad transition-colors hover:bg-bad-soft disabled:pointer-events-none disabled:opacity-45"
                >
                  {deleteDraftsBusy ? (
                    <Loader2 size={12} className="spin" aria-hidden />
                  ) : (
                    <Trash2 size={12} aria-hidden />
                  )}
                  Delete all drafts ({draftMigrations.length})
                </button>
              )}

              <button
                type="button"
                onClick={() => void refreshMigrations()}
                disabled={deleteDraftsBusy}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-soft transition-colors hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:opacity-45"
              >
                <RefreshCw size={12} aria-hidden />
                Refresh
              </button>
            </div>
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
            <div className="panel overflow-hidden">
              {migrations.map((row, index) => {
                // A draft has no screen of its own to open. It used to link to
                // the wizard, which resets on mount, so the row looked like it
                // would resume an upload and never did. Until a draft has an
                // approved plan there is nothing to navigate to, so the row
                // stays put and the actions menu carries the only thing you
                // can actually do with it.
                // A committed migration opens its evidence report rather than
                // an earlier lifecycle screen, which is the thing an operator
                // actually wants from a finished migration.
                const destination = row.committed_at
                  ? routes.report(row.id)
                  : row.verified_at
                    ? routes.verification(row.id)
                    : row.approved_plan_version
                      ? routes.run(row.id)
                      : null;

                const next = nextAction(row);

                const summary = (
                  <>
                    <p className="truncate text-sm font-medium">{row.filename}</p>
                    <p className="mt-1 truncate font-mono text-xs text-ink-soft">
                      {row.id.slice(0, 8)} ·{" "}
                      {row.destination_profile ?? "customers_v1"} · {row.row_count}{" "}
                      rows · {stateLabel(row)}
                    </p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                      <span
                        className={
                          next.evidence === "Evidence available"
                            ? "font-semibold text-ok"
                            : "text-ink-soft"
                        }
                      >
                        {next.evidence}
                      </span>
                      <span className="text-line" aria-hidden>
                        ·
                      </span>
                      <span
                        className={
                          destination ? "font-semibold text-brand" : "text-ink-soft"
                        }
                      >
                        {next.label}
                      </span>
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
                              ? `Deleted ${row.filename}. Its migration record is gone; no destination rows were written by it.`
                              : `Rollback complete. ${rowsRemoved} destination row(s) removed, and the migration record for ${row.filename} was then deleted.`
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

        <ConfirmDialog
          open={deleteDraftsOpen}
          busy={deleteDraftsBusy}
          title={`Delete all ${draftMigrations.length} draft migration${
            draftMigrations.length === 1 ? "" : "s"
          }?`}
          body={`This will permanently remove ${draftMigrations.length} migration${
            draftMigrations.length === 1 ? "" : "s"
          } with no approved plan, including their uploaded source files and derived data. Migrations with approved plans and committed migrations will not be touched.`}
          confirmLabel="Delete all drafts"
          cancelLabel="Cancel"
          onConfirm={() => void deleteAllDrafts()}
          onCancel={() => {
            if (!deleteDraftsBusy) setDeleteDraftsOpen(false);
          }}
        />
      </main>
    </>
  );
}
