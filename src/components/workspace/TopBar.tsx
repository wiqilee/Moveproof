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
    // Sits on the canvas rather than on its own surface, so the bar and the
    // sidebar read as one shell instead of two stacked strips.
    <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-canvas/80 px-5 py-3 backdrop-blur-xl sm:px-7">
      <Breadcrumbs crumbs={crumbs} />
      <div className="flex items-center gap-2.5">
        {busy && (
          <span
            className="inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand shadow-sm"
            role="status"
            aria-live="polite"
          >
            <Loader2 size={14} className="spin" aria-hidden />
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
