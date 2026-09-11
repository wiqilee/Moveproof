"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { ArrowRight, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Stepper } from "@/components/ui/Stepper";
import { WizardActions } from "./WizardActions";
import { api } from "@/data/api";
import type { ApiDestinationSchema, ApiPreview } from "@/lib/api-types";
import { useMigration } from "@/lib/migration-store";

export const WIZARD_STEPS = ["Source", "Destination", "Mapping", "Review"];

const ACCEPTED = ".csv,.tsv,.xlsx,.xlsm";

export function StepIntro({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-semibold tracking-[-0.015em]">{title}</h2>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-soft">{description}</p>
    </div>
  );
}

export function SourceStep({ onNext, onCancel }: { onNext: () => void; onCancel: () => void }) {
  const { migrationId, filename, uploadFile, busy } = useMigration();
  const [preview, setPreview] = useState<ApiPreview | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!migrationId) {
      setPreview(null);
      return;
    }
    let active = true;
    api
      .preview(migrationId, 25)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch(() => {
        if (active) setPreview(null);
      });
    return () => {
      active = false;
    };
  }, [migrationId]);

  const accept = async (file: File | undefined) => {
    if (!file) return;
    await uploadFile(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    void accept(event.dataTransfer.files?.[0]);
  };

  return (
    <div>
      <Stepper steps={WIZARD_STEPS} current={0} />
      <StepIntro
        title="Upload your source file"
        description="CSV or XLSX, up to 25 MB. The file is parsed by the backend and the original bytes are stored, so a repair can always return to the source."
      />

      <div
        onDragOver={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          "rounded-card border-2 border-dashed p-8 text-center transition-colors",
          dragging ? "border-brand bg-brand-soft" : "border-line bg-surface",
        ].join(" ")}
      >
        <Upload size={22} className="mx-auto mb-3 text-ink-soft" aria-hidden />
        <p className="text-sm font-semibold">Drop a spreadsheet here</p>
        <p className="mt-1 text-xs text-ink-soft">CSV, TSV, XLSX or XLSM</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="sr-only"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            void accept(event.target.files?.[0] ?? undefined)
          }
        />
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => inputRef.current?.click()}
          disabled={busy !== null}
        >
          {busy ? "Uploading" : "Choose a file"}
        </Button>
      </div>

      {busy === "Uploading and parsing" && (
        <p className="mt-4 flex items-center gap-2 text-sm text-ink-soft" role="status">
          <Loader2 size={15} className="spin" aria-hidden />
          Parsing the file on the backend
        </p>
      )}

      {preview && (
        <div className="mt-6 overflow-hidden rounded-card border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft">
              <FileSpreadsheet size={18} className="text-brand" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{filename ?? preview.filename}</p>
              <p className="mt-0.5 text-xs text-ink-soft">
                {preview.row_count} rows · {preview.columns.length} columns
                {preview.truncated && `, showing the first ${preview.rows.length}`}
              </p>
            </div>
          </div>

          <div className="table-scroll">
            <table className="w-full min-w-[680px] border-collapse text-table">
              <thead>
                <tr className="bg-muted/60">
                  {preview.columns.map((header) => (
                    <th
                      key={header}
                      scope="col"
                      className="px-4 py-2.5 text-left font-mono text-[11px] font-medium text-ink-soft"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row_number} className="border-t border-line">
                    {preview.columns.map((column) => {
                      const value = row.values[column] ?? "";
                      return (
                        <td key={column} className="px-4 py-2.5 font-mono">
                          {value === "" ? (
                            <span className="text-ink-soft">(empty)</span>
                          ) : (
                            value
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-ink-soft">
            Values are shown exactly as the parser read them. Nothing has been coerced to
            a number or a date yet, because type interpretation is a decision the plan
            makes explicitly.
          </p>
        </div>
      )}

      <WizardActions onBack={onCancel} backLabel="Cancel migration">
        <Button
          icon={ArrowRight}
          iconPosition="right"
          onClick={onNext}
          disabled={!migrationId}
        >
          Continue to destination
        </Button>
      </WizardActions>
    </div>
  );
}

export function DestinationStep({
  onNext,
  onBack,
  backLabel,
}: {
  onNext: () => void;
  onBack: () => void;
  backLabel: string;
}) {
  const [schema, setSchema] = useState<ApiDestinationSchema | null>(null);

  useEffect(() => {
    let active = true;
    api
      .destinationSchema()
      .then((result) => {
        if (active) setSchema(result);
      })
      .catch(() => {
        if (active) setSchema(null);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <Stepper steps={WIZARD_STEPS} current={1} />
      <StepIntro
        title="Destination schema"
        description={
          schema
            ? `${schema.name}, schema version ${schema.version}. You do not need to write SQL to continue.`
            : "Loading the destination schema from the backend."
        }
      />

      {schema ? (
        <>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="table-scroll">
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60">
                    {["Column", "Type", "Requirement", "Constraint", "Description"].map(
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
                  {schema.columns.map((column) => (
                    <tr key={column.name} className="border-t border-line">
                      <td className="px-4 py-3 font-mono text-[13px] font-medium">
                        {column.name}
                      </td>
                      <td className="px-4 py-3 font-mono text-[13px] text-ink-soft">
                        {column.type}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            column.required
                              ? "text-[11px] font-semibold uppercase tracking-wider text-bad"
                              : "text-[11px] uppercase tracking-wider text-ink-soft"
                          }
                        >
                          {column.required ? "Required" : "Optional"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-ink-soft">
                        {column.unique ? "Unique" : "None"}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-ink-soft">
                        {column.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-3 font-mono text-[11px] text-ink-soft">
            Verification contract {schema.contract.version} ·{" "}
            {schema.contract.hash.slice(0, 22)}
          </p>
        </>
      ) : (
        <p className="flex items-center gap-2 text-sm text-ink-soft" role="status">
          <Loader2 size={15} className="spin" aria-hidden />
          Loading
        </p>
      )}

      <WizardActions onBack={onBack} backLabel={`Back to ${backLabel.toLowerCase()}`}>
        <Button icon={ArrowRight} iconPosition="right" onClick={onNext} disabled={!schema}>
          Continue to mapping
        </Button>
      </WizardActions>
    </div>
  );
}
