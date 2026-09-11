import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * The action row shared by every wizard step.
 *
 * Back and Continue keep the same position on every screen, and on a narrow
 * viewport the primary action moves to the top of the stack so it stays within
 * thumb reach rather than being pushed below the fold.
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
    <div className="mt-8 flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
      <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
        {backLabel}
      </Button>
      <div className="flex flex-col gap-3 sm:flex-row">{children}</div>
    </div>
  );
}
