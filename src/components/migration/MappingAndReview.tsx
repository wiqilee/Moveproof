"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { AlertTriangle, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Stepper } from "@/components/ui/Stepper";
import { StatusPill } from "@/components/ui/StatusPill";
import { WizardActions } from "./WizardActions";
import { StepIntro, WIZARD_STEPS } from "./SourceAndDestination";
import { toUiMapping } from "@/data/api";
import { mappingStatusPresentation } from "@/domain/status";
import { useMigration } from "@/lib/migration-store";

type Profile = "safe" | "legacy" | "model";

const PROFILE_LABELS: Record<Profile, { name: string; detail: string }> = {
  safe: {
    name: "Deterministic baseline",
    detail: "Preserves identifiers as strings. No model call.",
  },
  legacy: {
    name: "Legacy import profile",
    detail:
      "Casts the identifier to an integer, as an older importer would. Flagged review required.",
  },
  model: {
    name: "Nemotron via Nebius",
    detail: "A model reads the schema and a five row sample, then proposes a mapping.",
  },
};

export function MappingStep({
  onNext,
  onBack,
  backLabel,
}: {
  onNext: () => void;
  onBack: () => void;
  backLabel: string;
}) {
  const { proposal, proposePlan, approvePlan, busy, health } = useMigration();
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
        title="Proposed mapping"
        description="Proposed by the backend and validated against the operation allowlist. Nothing has executed, so every status here describes the plan rather than a result."
      />

      <div className="mb-5 grid gap-2.5 sm:grid-cols-3">
        {(Object.keys(PROFILE_LABELS) as Profile[]).map((key) => {
          const disabled = key === "model" && !health?.nebius.configured;
          return (
            <button
              key={key}
              onClick={() => !disabled && setProfile(key)}
              aria-pressed={profile === key}
              disabled={disabled}
              className={[
                "rounded-card border p-3.5 text-left transition-colors",
                profile === key
                  ? "border-brand bg-brand-soft"
                  : "border-line bg-surface hover:bg-muted",
                disabled ? "cursor-not-allowed opacity-50" : "",
              ].join(" ")}
            >
              <p className="text-[13px] font-semibold">{PROFILE_LABELS[key].name}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                {disabled
                  ? "Needs Nebius credentials on the backend."
                  : PROFILE_LABELS[key].detail}
              </p>
            </button>
          );
        })}
      </div>

      {!proposal ? (
        <div
          className="flex items-center gap-3 rounded-card border border-line bg-surface px-5 py-6 text-sm text-ink-soft"
          role="status"
        >
          <Loader2 size={16} className="spin text-brand" aria-hidden />
          {busy ?? "Building the plan"}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="table-scroll">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60">
                    {["Source column", "Proposed transformation", "Destination", "Plan status"].map(
                      (header) => (
                        <th
                          key={header}
                          scope="col"
                          className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-soft"
                        >
                          {header}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping) => (
                    <tr key={mapping.sourceColumn} className="border-t border-line align-top">
                      <td className="px-4 py-3.5 font-mono text-[13px] font-medium">
                        {mapping.sourceColumn}
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-[13px]">{mapping.operationLabel}</p>
                        {mapping.note && (
                          <p
                            className={`mt-1.5 flex max-w-md items-start gap-1.5 text-xs leading-relaxed ${
                              mapping.status === "review" ? "text-warn" : "text-ink-soft"
                            }`}
                          >
                            <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden />
                            {mapping.note}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[13px] text-ink-soft">
                        {mapping.destinationColumn ?? "not written"}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusPill presentation={mappingStatusPresentation[mapping.status]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-4 py-3 text-xs leading-relaxed text-ink-soft">
              Proposed by {proposal.plan.proposed_by}. {mappings.length} operations checked
              against the allowlist, {proposal.issues.filter((i) => i.fatal).length} fatal
              issue(s). Proposed and review required describe a plan. Passed is reserved
              for a check that has actually run.
            </p>
          </div>

          {proposal.issues.filter((issue) => issue.fatal).length > 0 && (
            <div className="mt-4 rounded-card border border-bad/30 bg-bad-soft p-4">
              <p className="text-[13px] font-semibold text-bad">
                This plan cannot be approved
              </p>
              <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed">
                {proposal.issues
                  .filter((issue) => issue.fatal)
                  .map((issue) => (
                    <li key={issue.column + issue.reason}>
                      <span className="font-mono">{issue.column}</span>: {issue.reason}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {needed.length > 0 && (
            <div className="mt-4 rounded-card border border-warn/30 bg-warn-soft p-4">
              <p className="mb-3 text-[13px] font-semibold text-warn">
                These operations lose information and must be acknowledged by name
              </p>
              <div className="space-y-3">
                {needed.map((column) => {
                  const mapping = mappings.find((m) => m.sourceColumn === column);
                  return (
                    <label
                      key={column}
                      className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed"
                    >
                      <input
                        type="checkbox"
                        checked={acknowledged.includes(column)}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          toggle(column, event.target.checked)
                        }
                        className="mt-1 h-4 w-4 shrink-0 accent-current text-warn"
                      />
                      <span>
                        <span className="font-mono font-semibold">{column}</span>:{" "}
                        {mapping?.note ??
                          "This operation can lose information. Approving it is deliberate."}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-ink-soft">
                The backend records each acknowledgement against the approved plan version
                and refuses to execute without them.
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
        title="Review before staging"
        description="Nothing has touched the destination table. The next action stages the approved plan against an isolated schema, reading the original uploaded bytes."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-5">
          <h3 className="text-[13px] font-semibold">Scope</h3>
          <dl className="mt-4 space-y-2.5 text-[13px]">
            {[
              ["Source file", filename ?? "not set"],
              ["Approved plan", planVersion ? `v${planVersion}` : "not approved"],
              ["Date policy", proposal?.plan.date_format_policy ?? "not set"],
              ["Duplicate policy", proposal?.plan.duplicate_policy ?? "not set"],
              ["Conflict policy", "fail closed"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-4">
                <dt className="text-ink-soft">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div
          className={`rounded-card border p-5 ${
            risky.length ? "border-warn/30 bg-warn-soft" : "border-line bg-surface"
          }`}
        >
          <h3 className="text-[13px] font-semibold">
            {risky.length ? "Known risks carried into execution" : "No acknowledged risks"}
          </h3>
          {risky.length ? (
            <ul className="mt-4 space-y-3">
              {risky.map((mapping) => (
                <li
                  key={mapping.source_column}
                  className="flex items-start gap-2.5 text-[13px] leading-relaxed"
                >
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                  <span>
                    <span className="font-mono">{mapping.source_column}</span>:{" "}
                    {mapping.note}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
              This plan contains no operation that loses information.
            </p>
          )}
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
