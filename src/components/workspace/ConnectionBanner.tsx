"use client";

import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { useMigration } from "@/lib/migration-store";

/**
 * An honest connection banner.
 *
 * When the backend is unreachable the workspace says so instead of rendering
 * an empty state that looks like "no migrations yet". Those two situations
 * mean very different things and confusing them would be exactly the kind of
 * misleading status this product exists to avoid.
 */
export function ConnectionBanner() {
  const { backendReachable, health, refreshHealth, error, clearError } = useMigration();

  if (backendReachable === false) {
    return (
      <div className="border-b border-bad/30 bg-bad-soft px-5 py-3 sm:px-7">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <WifiOff size={16} className="shrink-0 text-bad" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold text-bad">The backend is not reachable.</span>{" "}
            <span className="text-ink-soft">
              Start it with{" "}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                make db-up migrate api
              </code>{" "}
              in the backend directory. No data is shown until it responds.
            </span>
          </p>
          <button
            onClick={() => void refreshHealth()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
          >
            <RefreshCw size={13} aria-hidden />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (health?.status === "degraded") {
    return (
      <div className="border-b border-warn/30 bg-warn-soft px-5 py-2.5 sm:px-7">
        <p className="mx-auto flex max-w-5xl items-center gap-2 text-sm text-ink-soft">
          <AlertTriangle size={15} className="shrink-0 text-warn" aria-hidden />
          The API is running but the database is not connected.
          {health.database.detail && (
            <span className="font-mono text-xs">{health.database.detail}</span>
          )}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-b border-bad/30 bg-bad-soft px-5 py-3 sm:px-7">
        <div className="mx-auto flex max-w-5xl flex-wrap items-start gap-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-bad" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-bad">{error.title}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{error.detail}</p>
          </div>
          <button
            onClick={clearError}
            className="shrink-0 rounded-control border border-line bg-surface px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return null;
}
