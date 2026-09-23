"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleAlert,
  Cpu,
  FileWarning,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Stepper } from "@/components/ui/Stepper";
import { StatusPill } from "@/components/ui/StatusPill";
import { WizardActions } from "./WizardActions";
import { ExternalEvidencePanel } from "./ExternalEvidencePanel";
import type { ApiPlanMapping } from "@/lib/api-types";
import { StepIntro, WIZARD_STEPS } from "./SourceAndDestination";
import { toUiMapping } from "@/data/api";
import { mappingStatusPresentation } from "@/domain/status";
import { useMigration } from "@/lib/migration-store";

type Profile = "safe" | "legacy" | "model";

const PROFILE_LABELS: Record<
  Profile,
  { name: string; detail: string; tag: string; icon: typeof ShieldCheck }
> = {
  safe: {
    name: "Deterministic baseline",
    detail: "Preserves identifiers as strings. No model call.",
    tag: "No AI",
    icon: ShieldCheck,
  },
  legacy: {
    name: "Legacy import profile",
    detail:
      "Casts the identifier to an integer, as an older importer would. Flagged review required.",
    tag: "Demo",
    icon: FileWarning,
  },
  model: {
    name: "Nemotron via Nebius",
    detail: "A model reads the schema and a five row sample, then proposes a mapping.",
    tag: "AI assisted",
    icon: Cpu,
  },
};

/**
 * The model returns a free-text risk note. When it is one of the three words
 * we recognise it becomes a calibrated chip; anything else stays prose.
 *
 * Low is deliberately quiet. Rendering it with the same warning triangle as
 * high made an ordinary mapping look like a problem on screen.
 */
const SEVERITY: Record<string, { label: string; className: string; icon: typeof Check }> = {
  low: { label: "Low", className: "bg-muted text-ink-soft", icon: Check },
  medium: { label: "Medium", className: "bg-warn-soft text-warn", icon: CircleAlert },
  high: { label: "High", className: "bg-bad-soft text-bad", icon: AlertTriangle },
};

function MappingNote({ note, review }: { note: string; review: boolean }) {
  const severity = SEVERITY[note.trim().toLowerCase()];

  if (severity) {
    const Icon = severity.icon;
    return (
      <span
        className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${severity.className}`}
      >
        <Icon size={11} strokeWidth={2.75} aria-hidden />
        {severity.label} risk
      </span>
    );
  }

  return (
    <p
      className={`mt-2 flex max-w-md items-start gap-1.5 text-xs leading-relaxed ${
        review ? "text-warn" : "text-ink-soft"
      }`}
    >
      <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden />
      {note}
    </p>
  );
}

export function MappingStep({
  onNext,
  onBack,
  backLabel,
}: {
  onNext: () => void;
  onBack: () => void;
  backLabel: string;
}) {
  const { proposal, proposePlan, approvePlan, busy, health, migrationId } = useMigration();
  const [profile, setProfile] = useState<Profile>("safe");
  const [acknowledged, setAcknowledged] = useState<string[]>([]);

  useEffect(() => {
    setAcknowledged([]);
    void proposePlan(profile);
    // proposePlan is stable and depends on the migration id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const mappings = proposal?.plan.mappings.map(toUiMapping) ?? [];
  const needed = proposal?.acknowledgement_columns ?? [];
  const fatal = proposal?.issues.filter((issue) => issue.fatal) ?? [];
  const allAcknowledged = needed.every((column) => acknowledged.includes(column));
  const canApprove =
    proposal !== null && proposal.is_executable && allAcknowledged && busy === null;

  const toggle = (column: string, checked: boolean) =>
    setAcknowledged((current) =>
      checked ? [...current, column] : current.filter((c) => c !== column)
    );

  const approve = async () => {
    const ok = await approvePlan({
      profile: profile === "model" ? "safe" : profile,
      acknowledgements: acknowledged,
    });
    if (ok) onNext();
  };

  return (
    <div>
      <Stepper steps={WIZARD_STEPS} current={2} />
      <StepIntro
        step={3}
        title="Proposed mapping"
        description="Proposed by the backend and validated against the operation allowlist. Nothing has executed, so every status here describes the plan rather than a result."
        aside={
          proposal ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <span className="rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-[11px] text-ink-soft">
                {mappings.length} operations
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  fatal.length ? "bg-bad-soft text-bad" : "bg-ok-soft text-ok"
                }`}
              >
                {fatal.length} fatal
              </span>
            </div>
          ) : undefined
        }
      />

      {/* Profile choice reads as three routes through the same step, so the
          selected one is stated by border, tint and a check rather than by a
          faint background alone. */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {(Object.keys(PROFILE_LABELS) as Profile[]).map((key) => {
          const option = PROFILE_LABELS[key];
          const selected = profile === key;
          const disabled = key === "model" && !health?.nebius.configured;
          const Icon = option.icon;
          return (
            <button
              key={key}
              onClick={() => !disabled && setProfile(key)}
              aria-pressed={selected}
              disabled={disabled}
              className={[
                "group relative overflow-hidden rounded-card border p-4 text-left",
                "transition-[border-color,background-color,box-shadow] duration-200",
                selected
                  ? "border-brand bg-brand-soft shadow-sm ring-1 ring-brand/20"
                  : "border-line bg-surface hover:border-brand/40 hover:bg-muted/50",
                disabled ? "cursor-not-allowed opacity-50 hover:border-line hover:bg-surface" : "",
              ].join(" ")}
            >
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <span
                  className={[
                    "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                    selected ? "bg-brand text-on-brand" : "bg-muted text-ink-soft",
                  ].join(" ")}
                  aria-hidden
                >
                  <Icon size={16} />
                </span>
                {selected ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-brand">
                    <Check size={10} strokeWidth={3} aria-hidden />
                    Selected
                  </span>
                ) : (
                  <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                    {option.tag}
                  </span>
                )}
              </div>
              <p className="text-[13px] font-semibold tracking-[-0.01em]">{option.name}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                {disabled ? "Needs Nebius credentials on the backend." : option.detail}
              </p>
            </button>
          );
        })}
      </div>

      {!proposal ? (
        <div
          className="flex items-center gap-3 rounded-card border border-line bg-surface px-5 py-8 text-sm text-ink-soft shadow-sm"
          role="status"
        >
          <Loader2 size={16} className="spin text-brand" aria-hidden />
          {busy ?? "Building the plan"}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
            <div className="table-scroll">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60">
                    {["Source column", "Proposed transformation", "Destination", "Plan status"].map(
                      (header) => (
                        <th
                          key={header}
                          scope="col"
                          className="whitespace-nowrap border-b border-line px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-soft"
                        >
                          {header}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping) => (
                    <tr
                      key={mapping.sourceColumn}
                      className={[
                        "border-t border-line align-top transition-colors",
                        mapping.status === "review"
                          ? "bg-warn-soft/30 hover:bg-warn-soft/50"
                          : "hover:bg-muted/40",
                      ].join(" ")}
                    >
                      <td className="px-4 py-4 font-mono text-[13px] font-semibold">
                        {mapping.sourceColumn}
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-[13px] leading-snug">{mapping.operationLabel}</p>
                        {mapping.note && (
                          <MappingNote
                            note={mapping.note}
                            review={mapping.status === "review"}
                          />
                        )}
                      </td>
                      <td className="px-4 py-4 font-mono text-[13px] text-ink-soft">
                        {mapping.destinationColumn ?? (
                          <span className="text-ink-soft/70">not written</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <StatusPill presentation={mappingStatusPresentation[mapping.status]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line bg-muted/30 px-4 py-3 text-xs leading-relaxed text-ink-soft">
              Proposed by{" "}
              <span className="font-mono text-ink">{proposal.plan.proposed_by}</span>.{" "}
              {mappings.length} operations checked against the allowlist, {fatal.length} fatal
              issue(s). Proposed and review required describe a plan. Passed is reserved for a
              check that has actually run.
            </p>
          </div>

          {fatal.length > 0 && (
            <div className="mt-5 overflow-hidden rounded-card border border-bad/30 bg-surface shadow-sm">
              <div className="flex items-center gap-2.5 border-b border-bad/20 bg-bad-soft px-5 py-3">
                <AlertTriangle size={16} className="shrink-0 text-bad" aria-hidden />
                <p className="text-[13px] font-semibold text-bad">
                  This plan cannot be approved
                </p>
                <span className="ml-auto rounded-full bg-bad px-2 py-0.5 text-[10px] font-bold text-surface">
                  {fatal.length}
                </span>
              </div>
              <ul className="divide-y divide-line">
                {fatal.map((issue) => (
                  <li
                    key={issue.column + issue.reason}
                    className="flex gap-3 px-5 py-3 text-[13px] leading-relaxed"
                  >
                    <span className="mt-0.5 font-mono text-[12px] font-semibold text-bad">
                      {issue.column}
                    </span>
                    <span className="text-ink-soft">{issue.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Evidence sits beside the mappings that were actually flagged,
              inside the existing review step, rather than on a page of its
              own. The question it answers is only meaningful next to the
              decision it informs. */}
          {needed.length > 0 && migrationId && (
            <div className="mt-5 space-y-4">
              {needed.map((column) => {
                const mapping = proposal?.plan.mappings.find(
                  (entry: ApiPlanMapping) => entry.source_column === column
                );
                if (!mapping) return null;
                return (
                  <ExternalEvidencePanel
                    key={`evidence-${column}`}
                    migrationId={migrationId}
                    available={health?.external_evidence.available ?? false}
                    defaultQuestion={
                      mapping.operation === "parse_date" ? "date_format" : "leading_zeros"
                    }
                    context={{
                      source_column: mapping.source_column,
                      destination_column: mapping.destination_column ?? mapping.source_column,
                      proposed_operation: mapping.operation,
                      risk_category: "review_required",
                    }}
                  />
                );
              })}
            </div>
          )}

          {needed.length > 0 && (
            <div className="mt-5 overflow-hidden rounded-card border border-warn/30 bg-surface shadow-sm">
              <div className="flex flex-wrap items-center gap-2.5 border-b border-warn/20 bg-warn-soft px-5 py-3">
                <ShieldCheck size={16} className="shrink-0 text-warn" aria-hidden />
                <p className="text-[13px] font-semibold text-warn">
                  These operations lose information and must be acknowledged by name
                </p>
                <span className="ml-auto font-mono text-[11px] font-semibold text-warn">
                  {acknowledged.filter((c) => needed.includes(c)).length}/{needed.length}
                </span>
              </div>

              <div className="divide-y divide-line">
                {needed.map((column) => {
                  const mapping = mappings.find((m) => m.sourceColumn === column);
                  const checked = acknowledged.includes(column);
                  return (
                    <label
                      key={column}
                      className={[
                        "flex cursor-pointer items-start gap-3 px-5 py-3.5 text-sm leading-relaxed",
                        "transition-colors",
                        checked ? "bg-ok-soft/30" : "hover:bg-muted/40",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          toggle(column, event.target.checked)
                        }
                        className="mt-0.5 h-4 w-4 shrink-0 accent-current text-warn"
                      />
                      <span className="min-w-0">
                        <span className="font-mono text-[13px] font-semibold">{column}</span>
                        <span className="ml-2 text-ink-soft">
                          {mapping?.note && SEVERITY[mapping.note.trim().toLowerCase()]
                            ? "This operation can lose information. Approving it is deliberate."
                            : mapping?.note ??
                              "This operation can lose information. Approving it is deliberate."}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>

              <p className="border-t border-line bg-muted/30 px-5 py-3 text-xs leading-relaxed text-ink-soft">
                The backend records each acknowledgement against the approved plan version and
                refuses to execute without them.
              </p>
            </div>
          )}
        </>
      )}

      <WizardActions onBack={onBack} backLabel={`Back to ${backLabel.toLowerCase()}`}>
        <Button
          icon={ArrowRight}
          iconPosition="right"
          disabled={!canApprove}
          onClick={() => void approve()}
        >
          Approve plan
        </Button>
      </WizardActions>
    </div>
  );
}

export function ReviewStep({
  onExecute,
  onBack,
  backLabel,
}: {
  onExecute: () => void;
  onBack: () => void;
  backLabel: string;
}) {
  const { proposal, planVersion, filename, busy } = useMigration();
  const risky = proposal?.plan.mappings.filter((m) => m.requires_acknowledgement) ?? [];

  return (
    <div>
      <Stepper steps={WIZARD_STEPS} current={3} />
      <StepIntro
        step={4}
        title="Review before staging"
        description="Nothing has touched the destination table. The next action stages the approved plan against an isolated schema, reading the original uploaded bytes."
        aside={
          planVersion ? (
            <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-1 font-mono text-[11px] font-semibold text-brand">
              Plan v{planVersion} approved
            </span>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
          <h3 className="border-b border-line bg-muted/40 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Scope
          </h3>
          <dl className="divide-y divide-line">
            {[
              ["Source file", filename ?? "not set"],
              ["Approved plan", planVersion ? `v${planVersion}` : "not approved"],
              ["Date policy", proposal?.plan.date_format_policy ?? "not set"],
              ["Duplicate policy", proposal?.plan.duplicate_policy ?? "not set"],
              ["Conflict policy", "fail closed"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-4 px-5 py-2.5 text-[13px]"
              >
                <dt className="text-ink-soft">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div
          className={`overflow-hidden rounded-card border shadow-sm ${
            risky.length ? "border-warn/30" : "border-line"
          }`}
        >
          <h3
            className={`border-b px-5 py-3 text-[11px] font-semibold uppercase tracking-wider ${
              risky.length
                ? "border-warn/20 bg-warn-soft text-warn"
                : "border-line bg-muted/40 text-ink-soft"
            }`}
          >
            {risky.length ? "Known risks carried into execution" : "No acknowledged risks"}
          </h3>
          <div className="bg-surface px-5 py-4">
            {risky.length ? (
              <ul className="space-y-3">
                {risky.map((mapping) => (
                  <li
                    key={mapping.source_column}
                    className="flex items-start gap-2.5 text-[13px] leading-relaxed"
                  >
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                    <span>
                      <span className="font-mono font-semibold">{mapping.source_column}</span>
                      {mapping.note ? `: ${mapping.note}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] leading-relaxed text-ink-soft">
                This plan contains no operation that loses information.
              </p>
            )}
          </div>
        </div>
      </div>

      <WizardActions onBack={onBack} backLabel={`Back to ${backLabel.toLowerCase()}`}>
        <Button
          variant="accent"
          icon={Sparkles}
          onClick={onExecute}
          disabled={!planVersion || busy !== null}
        >
          Stage and execute
        </Button>
      </WizardActions>
    </div>
  );
}
