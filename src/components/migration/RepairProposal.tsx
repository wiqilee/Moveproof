"use client";

import { Info, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ApiRepairProposal } from "@/lib/api-types";

export function RepairProposal({
  proposal,
  onApprove,
  busy,
}: {
  proposal: ApiRepairProposal;
  onApprove: () => void;
  busy: string | null;
}) {
  return (
    <div>
      {proposal.failed_checks.map((check) => (
        <div key={check.check_id} className="mb-3.5 rounded-card border border-line bg-surface p-4">
          <p className="text-xs font-semibold text-ink-soft">Failed invariant</p>
          <p className="mt-1.5 text-[15px] font-semibold">{check.name}</p>
          <p className="mt-1.5 font-mono text-sm text-bad">{check.observed}</p>

          {check.evidence.length > 0 && (
            <div className="table-scroll mt-3">
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60">
                    {["Row", "Field", "Source", "Destination"].map((header) => (
                      <th
                        key={header}
                        className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-soft"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {check.evidence.slice(0, 8).map((evidence, index) => (
                    <tr key={index} className="border-t border-line">
                      <td className="px-3 py-2 font-mono">{evidence.row_key}</td>
                      <td className="px-3 py-2 font-mono text-ink-soft">{evidence.field}</td>
                      <td className="px-3 py-2 font-mono">{evidence.source_value}</td>
                      <td className="px-3 py-2 font-mono font-semibold text-bad">
                        {evidence.destination_value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      <div className="mb-3.5 rounded-card border border-line bg-surface p-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-brand">
          <Sparkles size={13} aria-hidden />
          Proposed revision, plan v{proposal.current_plan_version} to v
          {proposal.proposed_plan_version}
        </p>

        <div className="mt-3 rounded-lg bg-muted p-3.5 font-mono text-xs leading-loose">
          {proposal.changes.map((change) => (
            <div key={change.column}>
              <p className="font-semibold text-ink-soft">{change.column}</p>
              <p className="text-bad">- {change.before}</p>
              <p className="text-ok">+ {change.after}</p>
            </div>
          ))}
          {proposal.changes.length === 0 && (
            <p className="text-ink-soft">No transformation change is proposed.</p>
          )}
        </div>

        <div className="mt-3.5 flex items-start gap-2 rounded-lg bg-warn-soft p-3.5 text-xs leading-relaxed">
          <Info size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <span>{proposal.note}</span>
        </div>
      </div>

      <div className="mb-4 rounded-card border border-line bg-surface p-4">
        <p className="text-xs font-semibold text-ink-soft">Rerun source</p>
        <p className="mt-1.5 text-sm leading-relaxed">
          {proposal.rerun_source}. Approving the revision creates a new plan version. The
          previous version stays on the record as the one that was approved and executed.
        </p>
      </div>

      <div className="flex justify-end">
        <Button
          variant="accent"
          icon={busy ? RefreshCw : Sparkles}
          onClick={onApprove}
          disabled={busy !== null}
        >
          {busy ?? `Approve plan v${proposal.proposed_plan_version} and rerun`}
        </Button>
      </div>
    </div>
  );
}
