"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/workspace/TopBar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DestinationStep, SourceStep } from "@/components/migration/SourceAndDestination";
import { MappingStep, ReviewStep } from "@/components/migration/MappingAndReview";
import { useMigration } from "@/lib/migration-store";
import { routes } from "@/lib/routes";

const STEP_LABELS = ["Source", "Destination", "Mapping", "Review"];

export default function NewMigrationPage() {
  const [step, setStep] = useState(0);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const router = useRouter();
  const { reset, migrationId, startRun } = useMigration();

  // Starting a new migration clears anything held from an earlier one. This
  // runs once on mount, so stepping backwards never discards work in progress.
  useEffect(() => {
    reset();
  }, [reset]);

  const goNext = () => setStep((current) => current + 1);
  const goBack = () => setStep((current) => Math.max(0, current - 1));

  const execute = async () => {
    const runId = await startRun();
    if (runId && migrationId) {
      router.push(routes.run(migrationId));
    }
  };

  return (
    <>
      <TopBar
        crumbs={[
          { label: "Workspace", href: routes.workspace },
          { label: "Migrations", href: routes.migrations },
          { label: "New migration" },
        ]}
      />
      <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-7">
        {step === 0 && <SourceStep onNext={goNext} onCancel={() => setConfirmLeave(true)} />}
        {step === 1 && (
          <DestinationStep onNext={goNext} onBack={goBack} backLabel={STEP_LABELS[0]} />
        )}
        {step === 2 && (
          <MappingStep onNext={goNext} onBack={goBack} backLabel={STEP_LABELS[1]} />
        )}
        {step === 3 && (
          <ReviewStep
            onBack={goBack}
            backLabel={STEP_LABELS[2]}
            onExecute={() => void execute()}
          />
        )}
      </main>

      <ConfirmDialog
        open={confirmLeave}
        title="Leave this migration?"
        body={
          migrationId
            ? "The uploaded file stays on the backend and you can return to it from the migrations list. Nothing approved will be lost."
            : "Nothing has been uploaded yet, so there is nothing to lose."
        }
        confirmLabel="Leave"
        cancelLabel="Stay on this page"
        onConfirm={() => {
          setConfirmLeave(false);
          router.push(routes.workspace);
        }}
        onCancel={() => setConfirmLeave(false)}
      />
    </>
  );
}
