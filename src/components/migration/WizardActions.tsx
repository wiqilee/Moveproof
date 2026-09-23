import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * The action row shared by every wizard step.
 *
 * Back and Continue keep the same position on every screen. On a narrow
 * viewport the primary action moves to the top of the stack so it stays
 * within thumb reach rather than being pushed below the fold.
 *
 * The row sits on its own surface band rather than floating on the page
 * background, so each step ends somewhere definite instead of trailing off.
 */
export function WizardActions({
  onBack,
  backLabel,
  children,
}: {
  onBack: () => void;
  backLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-8 flex flex-col-reverse gap-3 rounded-card border border-line bg-surface px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
        {backLabel}
      </Button>
      <div className="flex flex-col gap-3 sm:flex-row">{children}</div>
    </div>
  );
}
