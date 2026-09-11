"use client";

import { Loader2 } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/Navigation";
import { CommandTrigger } from "@/components/command/CommandTrigger";
import { StatusPill } from "@/components/ui/StatusPill";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { migrationStatePresentation } from "@/domain/status";
import { useMigration } from "@/lib/migration-store";
import type { MigrationState } from "@/domain/types";
import type { Crumb } from "@/lib/routes";

export function TopBar({ crumbs }: { crumbs: Crumb[] }) {
  const { state, busy } = useMigration();
  const presentation =
    migrationStatePresentation[state as MigrationState] ??
    migrationStatePresentation.draft;

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-surface/85 px-5 py-2.5 backdrop-blur-md sm:px-7">
      <Breadcrumbs crumbs={crumbs} />
      <div className="flex items-center gap-2.5">
        {busy && (
          <span
            className="flex items-center gap-1.5 text-xs text-ink-soft"
            role="status"
            aria-live="polite"
          >
            <Loader2 size={13} className="spin" aria-hidden />
            {busy}
          </span>
        )}
        <StatusPill presentation={presentation} />
        <CommandTrigger />
        <ThemeToggle />
      </div>
    </div>
  );
}
