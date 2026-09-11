"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  FileCheck2,
  FileSearch,
  FileText,
  Home,
  LayoutDashboard,
  ListOrdered,
  Loader2,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "@/data/api";
import { useMigrationOptional } from "@/lib/migration-store";
import { useTheme } from "@/lib/theme";
import { routes } from "@/lib/routes";

/**
 * The palette panel.
 *
 * Deliberately a controlled component. Open and closed state, the keyboard
 * shortcut and the portal all live in CommandPaletteProvider, which is mounted
 * once at the application root. Having the panel own that state as well was
 * the reason two implementations drifted apart and the shortcut stopped
 * working outside the workspace.
 *
 * Scope: this navigates and it changes a display preference. It cannot approve
 * a plan, run a verification or commit a migration. Those decisions belong to
 * screens that show the evidence behind them, and a shortcut that could commit
 * in two keystrokes would bypass every gate the backend enforces.
 *
 * Only commands that are genuinely available are listed. There is no entry for
 * resuming a draft that does not exist.
 */

type CommandGroup = "Results" | "Migrations" | "Navigate" | "Appearance";

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: CommandGroup;
  icon: LucideIcon;
  keywords: string;
  run: () => void;
}

const GROUP_ORDER: CommandGroup[] = ["Results", "Migrations", "Navigate", "Appearance"];

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<{ id: string; filename: string; state: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const router = useRouter();
  const { preference, setPreference } = useTheme();

  // Null on the public site, where no workspace provider is mounted. The
  // palette then offers navigation and appearance commands only, rather than
  // throwing.
  const migration = useMigrationOptional();
  const migrations = migration?.migrations ?? [];
  const migrationId = migration?.migrationId ?? null;
  const runId = migration?.runId ?? null;
  const hasResults = migration?.hasResults ?? false;
  const backendReachable = migration?.backendReachable ?? null;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // The panel only exists while open, so focusing on mount is correct.
  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Search the backend. The delay batches keystrokes into one request; it is
  // not an artificial wait.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2 || !backendReachable) {
      setResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api
        .searchMigrations(term)
        .then((response) => {
          if (!cancelled) {
            setResults(response.results);
            setSearchError(null);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setResults([]);
            setSearchError(error instanceof Error ? error.message : "The search failed.");
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, backendReachable]);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router]
  );

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: "nav-overview",
        label: "Open the workspace overview",
        group: "Navigate",
        icon: LayoutDashboard,
        keywords: "overview workspace dashboard app",
        run: () => go(routes.workspace),
      },
      {
        id: "nav-new",
        label: "Start a new migration",
        hint: "Upload a spreadsheet",
        group: "Navigate",
        icon: Plus,
        keywords: "new migration upload csv xlsx start",
        run: () => go(routes.newMigration),
      },
      {
        id: "nav-migrations",
        label: "Browse migrations",
        group: "Navigate",
        icon: ListOrdered,
        keywords: "migrations list browse history",
        run: () => go(routes.migrations),
      },
      {
        id: "nav-reports",
        label: "Browse reports",
        group: "Navigate",
        icon: FileCheck2,
        keywords: "reports evidence exports pdf json",
        run: () => go(routes.reports),
      },
      {
        id: "nav-settings",
        label: "Open settings",
        group: "Navigate",
        icon: Settings,
        keywords: "settings preferences theme configuration",
        run: () => go(routes.settings),
      },
      {
        id: "nav-docs",
        label: "Open documentation",
        group: "Navigate",
        icon: BookOpen,
        keywords: "documentation docs help guide",
        run: () => go(routes.docs),
      },
      {
        id: "nav-home",
        label: "Go to the home page",
        group: "Navigate",
        icon: Home,
        keywords: "home public landing exit",
        run: () => go(routes.home),
      },
    ];

    if (migrationId && hasResults) {
      list.push({
        id: "current-verification",
        label: "Open verification results for the current migration",
        hint: runId ? runId.slice(0, 8) : undefined,
        group: "Results",
        icon: FileSearch,
        keywords: "verification results checks current discrepancy",
        run: () => go(routes.verification(migrationId)),
      });
      list.push({
        id: "current-report",
        label: "Open the evidence report for the current migration",
        group: "Results",
        icon: FileText,
        keywords: "evidence report export current",
        run: () => go(routes.report(migrationId)),
      });
    }

    const resumable = migrations.find((row) => !row.approved_plan_version);
    if (resumable) {
      list.push({
        id: "resume-draft",
        label: `Resume ${resumable.filename}`,
        hint: "No plan approved yet",
        group: "Migrations",
        icon: ArrowRight,
        keywords: `resume draft continue ${resumable.filename}`,
        run: () => go(routes.newMigration),
      });
    }

    for (const row of migrations.slice(0, 5)) {
      list.push({
        id: `recent-${row.id}`,
        label: row.filename,
        hint: `${row.state.replace(/_/g, " ")} · ${row.id.slice(0, 8)}`,
        group: "Migrations",
        icon: FileSearch,
        keywords: `${row.filename} ${row.id} ${row.state}`,
        run: () =>
          go(
            row.verified_at
              ? routes.verification(row.id)
              : row.approved_plan_version
                ? routes.run(row.id)
                : routes.newMigration
          ),
      });
    }

    const themes: { id: string; label: string; icon: LucideIcon; value: typeof preference }[] = [
      { id: "theme-light", label: "Use the light theme", icon: Sun, value: "light" },
      { id: "theme-dark", label: "Use the dark theme", icon: Moon, value: "dark" },
      { id: "theme-system", label: "Follow the system theme", icon: Monitor, value: "system" },
    ];
    for (const theme of themes) {
      if (theme.value === preference) continue;
      list.push({
        id: theme.id,
        label: theme.label,
        group: "Appearance",
        icon: theme.icon,
        keywords: `theme appearance ${theme.value} dark light system colour color`,
        run: () => {
          setPreference(theme.value);
          onClose();
        },
      });
    }

    return list;
  }, [go, migrationId, hasResults, runId, migrations, preference, setPreference, onClose]);

  const searchCommands = useMemo<Command[]>(
    () =>
      results
        .filter((row) => !migrations.slice(0, 5).some((recent) => recent.id === row.id))
        .map((row) => ({
          id: `search-${row.id}`,
          label: row.filename,
          hint: `${row.state.replace(/_/g, " ")} · ${row.id.slice(0, 8)}`,
          group: "Migrations" as const,
          icon: FileSearch,
          keywords: `${row.filename} ${row.id}`,
          run: () => go(routes.verification(row.id)),
        })),
    [results, migrations, go]
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const local = term
      ? commands.filter(
          (command) =>
            command.label.toLowerCase().includes(term) ||
            command.keywords.toLowerCase().includes(term)
        )
      : commands;
    return [...local, ...searchCommands];
  }, [commands, searchCommands, query]);

  const grouped = useMemo(() => {
    const map = new Map<CommandGroup, Command[]>();
    for (const command of filtered) {
      const bucket = map.get(command.group) ?? [];
      bucket.push(command);
      map.set(command.group, bucket);
    }
    return GROUP_ORDER.filter((group) => map.has(group)).map((group) => ({
      group,
      items: map.get(group) ?? [],
    }));
  }, [filtered]);

  const flat = useMemo(() => grouped.flatMap((section) => section.items), [grouped]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (flat.length ? (current + 1) % flat.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (flat.length ? (current - 1 + flat.length) % flat.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      flat[active]?.run();
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(0, flat.length - 1));
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-navy/30 p-0 backdrop-blur-[2px] animate-backdrop-in sm:items-start sm:p-6 sm:pt-[12vh]"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="safe-bottom flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-panel animate-palette-in sm:max-h-[62vh] sm:max-w-xl sm:rounded-card"
        onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
          <Search size={16} className="shrink-0 text-ink-soft" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search migrations or jump to a page"
            aria-label="Search commands and migrations"
            aria-controls="command-list"
            aria-activedescendant={flat[active] ? `command-${flat[active].id}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-soft"
          />
          {searching && <Loader2 size={14} className="spin text-ink-soft" aria-hidden />}
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-soft sm:block">
            esc
          </kbd>
        </div>

        <ul
          id="command-list"
          ref={listRef}
          role="listbox"
          aria-label="Commands"
          className="min-h-0 flex-1 overflow-y-auto py-2"
        >
          {flat.length === 0 && (
            <li className="px-4 py-8 text-center">
              <p className="text-sm font-medium">Nothing matches that</p>
              <p className="mt-1 text-xs text-ink-soft">
                {searchError
                  ? searchError
                  : backendReachable === false
                    ? "The backend is unreachable, so migrations cannot be searched."
                    : "Try a filename, a migration id, or a page name."}
              </p>
            </li>
          )}

          {grouped.map((section) => (
            <li key={section.group}>
              <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                {section.group}
              </p>
              <ul>
                {section.items.map((command) => {
                  const index = flat.indexOf(command);
                  const selected = index === active;
                  return (
                    <li key={command.id}>
                      <button
                        id={`command-${command.id}`}
                        data-index={index}
                        role="option"
                        aria-selected={selected}
                        onMouseEnter={() => setActive(index)}
                        onClick={command.run}
                        className={[
                          "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                          selected ? "bg-brand-soft" : "hover:bg-muted",
                        ].join(" ")}
                      >
                        <command.icon
                          size={15}
                          className={selected ? "text-brand" : "text-ink-soft"}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{command.label}</span>
                          {command.hint && (
                            <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-soft">
                              {command.hint}
                            </span>
                          )}
                        </span>
                        {selected && <ArrowRight size={14} className="shrink-0 text-brand" aria-hidden />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[11px] text-ink-soft">
          <span className="flex items-center gap-3">
            <span>
              <kbd className="font-mono">↑↓</kbd> move
            </span>
            <span>
              <kbd className="font-mono">enter</kbd> open
            </span>
          </span>
          <span className="hidden sm:inline">
            Navigation only. Approvals and commits stay on their own screens.
          </span>
        </div>
      </div>
    </div>
  );
}
