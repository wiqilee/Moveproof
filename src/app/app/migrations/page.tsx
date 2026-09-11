"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import Link from "next/link";
import { ArrowRight, FileSearch, Loader2, Plus, Search } from "lucide-react";
import { TopBar } from "@/components/workspace/TopBar";
import { PageHeading } from "@/components/workspace/PageHeading";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusPill } from "@/components/ui/StatusPill";
import { migrationStatePresentation } from "@/domain/status";
import type { MigrationState } from "@/domain/types";
import { useMigration } from "@/lib/migration-store";
import { routes } from "@/lib/routes";

export default function MigrationsPage() {
  const { migrations, migrationsLoading, refreshMigrations, backendReachable } =
    useMigration();
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (backendReachable) void refreshMigrations();
  }, [backendReachable, refreshMigrations]);

  const term = filter.trim().toLowerCase();
  const visible = term
    ? migrations.filter(
        (row) =>
          row.filename.toLowerCase().includes(term) || row.id.includes(term)
      )
    : migrations;

  return (
    <>
      <TopBar
        crumbs={[{ label: "Workspace", href: routes.workspace }, { label: "Migrations" }]}
      />
      <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-7">
        <PageHeading
          title="Migrations"
          description="Every migration in this workspace, with its plan version and latest run."
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
          <label className="mb-4 flex items-center gap-2.5 rounded-control border border-line bg-surface px-3 py-2.5">
            <Search size={15} className="shrink-0 text-ink-soft" aria-hidden />
            <input
              value={filter}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setFilter(event.target.value)}
              placeholder="Filter by filename or id"
              aria-label="Filter migrations"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-soft"
            />
          </label>
        )}

        {migrationsLoading && migrations.length === 0 ? (
          <div
            className="flex items-center gap-2.5 rounded-card border border-line bg-surface px-5 py-8 text-sm text-ink-soft"
            role="status"
          >
            <Loader2 size={15} className="spin" aria-hidden />
            Loading migrations
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={FileSearch}
            title={term ? "Nothing matches that filter" : "No migrations yet"}
            body={
              term
                ? "Try a different filename or identifier."
                : "Upload a spreadsheet to start one."
            }
            action={term ? undefined : { label: "Start a migration", href: routes.newMigration }}
          />
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="table-scroll">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60">
                    {["Source file", "Rows", "Plan", "Latest run", "State", ""].map((header) => (
                      <th
                        key={header}
                        scope="col"
                        className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-soft"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.id} className="border-t border-line">
                      <td className="px-4 py-3">
                        <p className="font-medium">{row.filename}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-ink-soft">
                          {row.id.slice(0, 8)} · {new Date(row.created_at).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono">{row.row_count}</td>
                      <td className="px-4 py-3 font-mono text-ink-soft">
                        {row.approved_plan_version ? `v${row.approved_plan_version}` : "none"}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-ink-soft">
                        {row.verified_at
                          ? `verified ${new Date(row.verified_at).toLocaleTimeString()}`
                          : row.latest_run_id
                            ? "staged, not verified"
                            : "not run"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill
                          presentation={
                            migrationStatePresentation[row.state as MigrationState] ??
                            migrationStatePresentation.draft
                          }
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={
                            row.verified_at
                              ? routes.verification(row.id)
                              : row.approved_plan_version
                                ? routes.run(row.id)
                                : routes.newMigration
                          }
                          className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                        >
                          Open
                          <ArrowRight size={12} aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
