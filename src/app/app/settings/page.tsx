"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Cpu,
  Database,
  FileText,
  Globe,
  RefreshCw,
  ShieldCheck,
  Table2,
  type LucideIcon,
} from "lucide-react";
import { TopBar } from "@/components/workspace/TopBar";
import { PageHeading } from "@/components/workspace/PageHeading";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useMigration } from "@/lib/migration-store";
import { useTheme } from "@/lib/theme";
import { API_BASE_URL, api } from "@/lib/api-client";
import type { ApiDestinationProfile } from "@/lib/api-types";
import { routes } from "@/lib/routes";

/**
 * Settings that actually do something.
 *
 * Theme persists. Everything else on this page is read from the backend and
 * reported honestly, including the parts that are not available. There are no
 * decorative switches: the status board below is a rendering of /health and
 * the destination profile registry, nothing more.
 */

type Capability = {
  label: string;
  role: string;
  icon: LucideIcon;
  available: boolean;
  detail: string;
};

/** The hostname only, so the board stays readable on a narrow screen. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default function SettingsPage() {
  const { health, refreshHealth } = useMigration();
  const { preference, resolved } = useTheme();
  const [destinationProfiles, setDestinationProfiles] = useState<ApiDestinationProfile[]>([]);
  const [defaultDestinationProfile, setDefaultDestinationProfile] = useState<string | null>(null);
  const [profilesReachable, setProfilesReachable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const check = () => {
    setChecking(true);
    void refreshHealth().finally(() => {
      setChecking(false);
      setCheckedAt(new Date());
    });
  };

  useEffect(() => {
    check();
    void api
      .destinationProfiles()
      .then((result) => {
        setDestinationProfiles(result.profiles);
        setDefaultDestinationProfile(result.default);
        setProfilesReachable(true);
      })
      .catch(() => {
        setDestinationProfiles([]);
        setDefaultDestinationProfile(null);
        setProfilesReachable(false);
      });
    // Runs once on mount; `check` closes over the stable refreshHealth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capabilities: Capability[] = [
    {
      label: "PostgreSQL",
      role: "Staging and commit gate",
      icon: Database,
      available: health?.database.connected ?? false,
      detail:
        health?.database.detail ?? "Staging, destination and the audit trail live here.",
    },
    {
      label: "Nebius Token Factory",
      role: "NVIDIA Nemotron inference",
      icon: Cpu,
      available: health?.nebius.configured ?? false,
      detail:
        health?.nebius.note ??
        "Used for model-assisted planning and selective reasoning escalation when configured.",
    },
    {
      label: "External Evidence Check",
      role: "Tavily, advisory only",
      icon: Globe,
      available: health?.external_evidence?.available ?? false,
      detail:
        health?.external_evidence?.note ??
        "Tavily-backed advisory references for human review. Never changes verification results or commit eligibility.",
    },
    {
      label: "Rust verifier",
      role: "Canonical reconciliation",
      icon: ShieldCheck,
      available: health?.rust_verifier.available ?? false,
      detail:
        health?.rust_verifier.note ??
        "Canonical row reconciliation. Reports not verified when absent.",
    },
    {
      label: "PDF export",
      role: "Evidence report rendering",
      icon: FileText,
      available: health?.reports.pdf_available ?? false,
      detail: "Server side rendering of the evidence report.",
    },
    {
      label: "Verified CSV export",
      role: "Verified dataset download",
      icon: Table2,
      available: health?.exports.verified_csv_available ?? false,
      detail: "The transformed dataset, read back from stored verified rows. Separate from the evidence report.",
    },
  ];

  const known = health !== null && health !== undefined;
  const availableCount = capabilities.filter((c) => c.available).length;
  const allUp = known && availableCount === capabilities.length;
  const summary = !known
    ? checking
      ? "Checking the backend…"
      : "Backend not reachable"
    : allUp
      ? "All systems available"
      : `${capabilities.length - availableCount} unavailable`;

  // The status board follows the theme: a light board in light mode, the
  // deep navy board in dark mode.
  const isDark = resolved === "dark";
  const ui = isDark
    ? {
        board: "border-white/10 text-[#f1f5f9] shadow-panel hover:border-[#60a5fa]/30",
        boardBg:
          "radial-gradient(60% 90% at 85% 0%, rgba(37, 99, 235, 0.28), transparent 70%), linear-gradient(180deg, #0a1122 0%, #060a14 100%)",
        grid: "rgba(148, 163, 184, 0.06)",
        eyebrow: "text-[#8b9bb8] group-hover/board:text-[#93c5fd]",
        icon: "group-hover/board:text-[#93c5fd] group-hover/board:drop-shadow-[0_0_6px_rgba(96,165,250,0.9)]",
        faint: "text-[#64748b]",
        soft: "text-[#a3b1c6]",
        dotOff: "bg-[#64748b]",
        button: "border-white/15 bg-white/5 text-[#f1f5f9] hover:bg-white/10",
        segmentIdle: "bg-white/10",
        segmentOff: "bg-[#475569]",
        card: "border-white/10 bg-white/[0.03] hover:border-[#60a5fa]/40 hover:bg-white/[0.06]",
        iconBox: "border-white/10 bg-[#0b1222] text-[#93c5fd]",
        iconLit: "group-hover/cap:border-[#60a5fa] group-hover/cap:bg-[#2563eb] group-hover/cap:text-white group-hover/cap:shadow-[0_0_0_4px_rgba(96,165,250,0.15),0_0_16px_rgba(96,165,250,0.6)]",
        badgeOff: "bg-white/5 text-[#a3b1c6]",
        role: "text-[#93c5fd]",
      }
    : {
        board: "border-line text-ink shadow-sm hover:border-brand/30 hover:shadow-[0_12px_32px_-20px_rgb(var(--color-brand)/0.35)]",
        boardBg:
          "radial-gradient(60% 90% at 85% 0%, rgba(59, 130, 246, 0.12), transparent 70%), linear-gradient(180deg, #ffffff 0%, #f7f9fc 100%)",
        grid: "rgba(23, 37, 84, 0.05)",
        eyebrow: "text-ink-soft group-hover/board:text-brand",
        icon: "group-hover/board:text-brand group-hover/board:drop-shadow-[0_0_6px_rgba(59,130,246,0.7)]",
        faint: "text-ink-soft/50",
        soft: "text-ink-soft",
        dotOff: "bg-ink-soft/40",
        button: "border-line bg-surface text-ink hover:bg-muted",
        segmentIdle: "bg-line",
        segmentOff: "bg-ink-soft/30",
        card: "border-line bg-surface/80 hover:border-brand/40 hover:shadow-sm",
        iconBox: "border-brand/20 bg-brand-soft text-brand",
        iconLit: "group-hover/cap:border-brand group-hover/cap:bg-brand group-hover/cap:text-on-brand group-hover/cap:shadow-[0_0_0_4px_rgb(var(--color-brand)/0.15),0_0_16px_rgb(var(--color-brand)/0.5)]",
        badgeOff: "bg-muted text-ink-soft",
        role: "text-brand",
      };

  return (
    <>
      <TopBar
        crumbs={[{ label: "Workspace", href: routes.workspace }, { label: "Settings" }]}
      />
      <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-7">
        <PageHeading
          title="Settings"
          description="Workspace preferences, backend capabilities, and the destination contracts exposed by the current backend revision."
        />

        {/* ============================================ System status board */}
        {/* Light theme gets a light board; dark theme keeps the deep navy one. */}
        <section
          aria-labelledby="status-heading"
          className={[
            "group/board relative mb-6 overflow-hidden rounded-card border transition-[border-color,box-shadow] duration-300",
            ui.board,
          ].join(" ")}
          style={{ background: ui.boardBg }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(to right, ${ui.grid} 1px, transparent 1px), linear-gradient(to bottom, ${ui.grid} 1px, transparent 1px)`,
              backgroundSize: "26px 26px",
              maskImage: "radial-gradient(80% 100% at 80% 0%, black 30%, transparent 85%)",
              WebkitMaskImage: "radial-gradient(80% 100% at 80% 0%, black 30%, transparent 85%)",
            }}
          />

          <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p
                className={[
                  "flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] transition-colors duration-300",
                  ui.eyebrow,
                ].join(" ")}
              >
                {/* Lights up while the board is being read. */}
                <Activity
                  size={12}
                  aria-hidden
                  className={[
                    "transition-[color,filter] duration-300 motion-safe:group-hover/board:animate-pulse",
                    ui.icon,
                  ].join(" ")}
                />
                System status · read only
              </p>
              <h2 id="status-heading" className="mt-3 flex items-baseline gap-3">
                <span className="font-mono text-5xl font-semibold tracking-tight">
                  {known ? availableCount : "–"}
                  <span className={ui.faint}> / {capabilities.length}</span>
                </span>
                <span className={["text-sm", ui.soft].join(" ")}>systems available</span>
              </h2>
              <p className="mt-2 flex items-center gap-2 text-sm">
                <span className="relative flex h-2.5 w-2.5">
                  {allUp && (
                    <span className="absolute inline-flex h-full w-full rounded-full bg-ok opacity-60 motion-safe:animate-ping" />
                  )}
                  <span
                    className={[
                      "relative inline-flex h-2.5 w-2.5 rounded-full",
                      allUp ? "bg-ok" : known ? "bg-warn" : ui.dotOff,
                    ].join(" ")}
                  />
                </span>
                <span className={allUp ? "font-medium text-ok" : ui.soft}>{summary}</span>
              </p>
            </div>

            <div className="flex flex-col items-start gap-2 sm:items-end">
              <button
                onClick={check}
                disabled={checking}
                className={[
                  "inline-flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60",
                  ui.button,
                ].join(" ")}
              >
                <RefreshCw
                  size={12}
                  aria-hidden
                  className={checking ? "motion-safe:animate-spin" : ""}
                />
                {checking ? "Checking" : "Refresh"}
              </button>
              <p className={["font-mono text-[11px]", ui.soft].join(" ")}>
                {hostOf(API_BASE_URL)}
                {checkedAt && ` · checked ${checkedAt.toLocaleTimeString()}`}
              </p>
            </div>
          </div>

          {/* One segment per capability, so the board reads at a glance. */}
          <div className="relative flex gap-1 px-6" aria-hidden>
            {capabilities.map((capability) => (
              <span
                key={capability.label}
                className={[
                  "h-1 flex-1 rounded-full transition-colors duration-500",
                  !known ? ui.segmentIdle : capability.available ? "bg-ok" : ui.segmentOff,
                ].join(" ")}
              />
            ))}
          </div>

          <ul className="relative grid gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map(({ label, role, icon: Icon, available, detail }) => (
              <li
                key={label}
                className={[
                  "group/cap rounded-control border p-4 transition-colors duration-200",
                  ui.card,
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={[
                      "flex h-8 w-8 items-center justify-center rounded-lg border transition-[color,background-color,border-color,box-shadow] duration-300",
                      ui.iconBox,
                      ui.iconLit,
                    ].join(" ")}
                  >
                    <Icon size={16} aria-hidden />
                  </span>
                  <span
                    className={[
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                      known && available ? "bg-ok/15 text-ok" : ui.badgeOff,
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "h-1.5 w-1.5 rounded-full",
                        known && available ? "bg-ok" : ui.dotOff,
                      ].join(" ")}
                    />
                    {!known ? "unknown" : available ? "available" : "not available"}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold">{label}</p>
                <p className={["font-mono text-[11px]", ui.role].join(" ")}>{role}</p>
                <p className={["mt-2 text-xs leading-relaxed", ui.soft].join(" ")}>{detail}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ===================================== Destination contracts */}
        <section className="panel mb-6 p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold">Destination contracts</h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-soft">
                Loaded from the backend profile registry. Unknown profile IDs are refused rather
                than converted into database table or column names.
              </p>
            </div>
            {profilesReachable && destinationProfiles.length > 0 && (
              <span className="font-mono text-[11px] text-ink-soft">
                {destinationProfiles.length} registered
              </span>
            )}
          </div>

          {profilesReachable === null ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-busy>
              {[0, 1].map((i) => (
                <div key={i} className="h-36 animate-pulse rounded-control border border-line bg-muted/50" />
              ))}
              <span className="sr-only">Loading destination contracts…</span>
            </div>
          ) : profilesReachable && destinationProfiles.length > 0 ? (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {destinationProfiles.map((profile) => {
                const isDefault = profile.id === defaultDestinationProfile;
                return (
                  <li
                    key={profile.id}
                    className="relative flex flex-col overflow-hidden rounded-control border border-line bg-surface p-4 transition-colors duration-200 hover:border-brand/40"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand to-transparent"
                    />
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold">{profile.display_name}</p>
                      {isDefault && (
                        <span className="rounded-full border border-brand/30 bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-brand">{profile.id}</p>
                    <p className="mb-4 mt-2 text-xs leading-relaxed text-ink-soft">
                      {profile.description}
                    </p>
                    <dl className="mt-auto grid grid-cols-[1.7fr_0.6fr_1fr] gap-2 border-t border-line pt-3">
                      {[
                        ["Table", profile.destination_table],
                        ["Schema", `v${profile.schema_version}`],
                        ["Columns", `${profile.column_count} · ${profile.required_count} req`],
                      ].map(([key, value]) => (
                        <div key={key} className="min-w-0">
                          <dt className="text-[10px] uppercase tracking-wider text-ink-soft">{key}</dt>
                          <dd className="truncate font-mono text-[11px]" title={value}>
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 text-sm leading-relaxed text-ink-soft">
              The current backend revision does not expose destination profiles yet. This is
              expected until the robotics-capable backend and migration 004 are deployed.
            </p>
          )}
        </section>

        {/* ================================ Appearance and connection */}
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="panel p-5">
            <h2 className="text-[15px] font-semibold">Appearance</h2>
            <p className="mb-4 mt-1 text-sm leading-relaxed text-ink-soft">
              Stored in this browser. Choosing system keeps following your operating system when
              it changes.
            </p>
            <ThemeToggle variant="full" />
            <p className="mt-3 font-mono text-[11px] text-ink-soft">
              preference: {preference} · applied: {resolved}
            </p>
          </section>

          <section className="panel p-5">
            <h2 className="text-[15px] font-semibold">Connection</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <dt className="text-ink-soft">API base URL</dt>
                <dd className="break-all font-mono text-xs">{API_BASE_URL}</dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <dt className="text-ink-soft">Upload limit</dt>
                <dd className="font-mono text-xs">
                  {health
                    ? `${Math.round(health.limits.max_upload_bytes / 1024 / 1024)} MB`
                    : "unknown"}
                </dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <dt className="text-ink-soft">Maximum sampled rows for model reasoning</dt>
                <dd className="font-mono text-xs">
                  {health ? health.limits.model_sample_rows : "unknown"}
                </dd>
              </div>
            </dl>
            <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-soft">
              Change the API URL with NEXT_PUBLIC_API_BASE_URL. The other limits are backend
              settings.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
