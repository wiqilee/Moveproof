"use client";

import { useEffect } from "react";
import { CheckCircle2, Minus, RefreshCw } from "lucide-react";
import { TopBar } from "@/components/workspace/TopBar";
import { PageHeading } from "@/components/workspace/PageHeading";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useMigration } from "@/lib/migration-store";
import { useTheme } from "@/lib/theme";
import { API_BASE_URL } from "@/lib/api-client";
import { routes } from "@/lib/routes";

/**
 * Settings that actually do something.
 *
 * Theme persists. Everything else on this page is read from the backend and
 * reported honestly, including the parts that are not available. There are no
 * decorative switches.
 */
export default function SettingsPage() {
  const { health, refreshHealth } = useMigration();
  const { preference, resolved } = useTheme();

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const capabilities = [
    {
      label: "PostgreSQL",
      available: health?.database.connected ?? false,
      detail:
        health?.database.detail ??
        "Staging, destination and the audit trail live here.",
    },
    {
      label: "Nebius Token Factory",
      available: health?.nebius.configured ?? false,
      detail:
        health?.nebius.note ??
        "Needed only for the model assisted mapping profile.",
    },
    {
      label: "Rust verifier",
      available: health?.rust_verifier.available ?? false,
      detail:
        health?.rust_verifier.note ??
        "Canonical row reconciliation. Reports not verified when absent.",
    },
    {
      label: "PDF export",
      available: health?.reports.pdf_available ?? false,
      detail: "Server side rendering of the evidence report.",
    },
  ];

  return (
    <>
      <TopBar
        crumbs={[{ label: "Workspace", href: routes.workspace }, { label: "Settings" }]}
      />
      <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-7">
        <PageHeading
          title="Settings"
          description="Workspace preferences and the current state of every backend capability."
        />

        <section className="mb-6 rounded-card border border-line bg-surface p-5">
          <h2 className="text-[15px] font-semibold">Appearance</h2>
          <p className="mb-4 mt-1 text-sm leading-relaxed text-ink-soft">
            Stored in this browser. Choosing system keeps following your
            operating system when it changes.
          </p>
          <ThemeToggle variant="full" />
          <p className="mt-3 font-mono text-[11px] text-ink-soft">
            preference: {preference} · applied: {resolved}
          </p>
        </section>

        <section className="mb-6 rounded-card border border-line bg-surface p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">Backend capabilities</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Reported by the API. A capability that is off is stated as off
                rather than hidden.
              </p>
            </div>
            <button
              onClick={() => void refreshHealth()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
            >
              <RefreshCw size={12} aria-hidden />
              Refresh
            </button>
          </div>

          <ul className="divide-y divide-line">
            {capabilities.map((capability) => (
              <li key={capability.label} className="flex items-start gap-3 py-3">
                {capability.available ? (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ok" aria-hidden />
                ) : (
                  <Minus size={16} className="mt-0.5 shrink-0 text-neutral" aria-hidden />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {capability.label}
                    <span
                      className={`ml-2 text-xs font-normal ${
                        capability.available ? "text-ok" : "text-neutral"
                      }`}
                    >
                      {capability.available ? "available" : "not available"}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                    {capability.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="text-[15px] font-semibold">Connection</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-ink-soft">API base URL</dt>
              <dd className="break-all font-mono text-xs">{API_BASE_URL}</dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-ink-soft">Upload limit</dt>
              <dd className="font-mono text-xs">
                {health ? `${Math.round(health.limits.max_upload_bytes / 1024 / 1024)} MB` : "unknown"}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-ink-soft">Rows sent to the model</dt>
              <dd className="font-mono text-xs">
                {health ? health.limits.model_sample_rows : "unknown"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-soft">
            Change the API URL with NEXT_PUBLIC_API_BASE_URL. The other limits
            are backend settings.
          </p>
        </section>
      </main>
    </>
  );
}
