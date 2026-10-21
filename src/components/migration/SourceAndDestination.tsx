"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, ReactNode } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  Upload,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Stepper } from "@/components/ui/Stepper";
import { WizardActions } from "./WizardActions";
import { DemoLibrary } from "./DemoLibrary";
import { api } from "@/data/api";
import type {
  ApiDestinationProfile,
  ApiDestinationSchema,
  ApiPreview,
} from "@/lib/api-types";
import { useMigration } from "@/lib/migration-store";

export const WIZARD_STEPS = ["Source", "Destination", "Mapping", "Review"];

const ACCEPTED = ".csv,.tsv,.xlsx,.xlsm";

/**
 * The heading every step shares.
 *
 * The eyebrow carries the step number so the position is stated twice, once
 * in the stepper and once where the eye actually lands. `aside` is for the
 * one fact worth putting on the same line as the title.
 */
export function StepIntro({
  title,
  description,
  step,
  aside,
}: {
  title: string;
  description: string;
  step?: number;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          {step !== undefined && (
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
              Step {step} of {WIZARD_STEPS.length}
            </p>
          )}
          <h2 className="text-[1.45rem] font-semibold tracking-[-0.02em] sm:text-2xl">
            {title}
          </h2>
        </div>
        {aside}
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">{description}</p>
    </div>
  );
}

/** A short reassurance line. Used sparingly, and only where it is true. */
function TrustNote({ icon: Icon, children }: { icon: typeof Lock; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-soft">
      <Icon size={12} aria-hidden />
      {children}
    </span>
  );
}

/**
 * Which destination this migration targets.
 *
 * Chosen before upload, because the backend records the profile on the
 * migration row and every later stage resolves its contract from there.
 * Changing it afterwards would mean verifying against a different contract
 * than the rows were staged for, so the choice locks once a file has landed.
 */
function ProfilePicker({
  profiles,
  selected,
  onSelect,
  locked,
}: {
  profiles: ApiDestinationProfile[];
  selected: string | null;
  onSelect: (id: string) => void;
  locked: boolean;
}) {
  // One destination is not a choice, so nothing is shown. An older backend
  // without the profiles endpoint lands here too.
  if (profiles.length < 2) return null;

  return (
    <fieldset className="mb-6" disabled={locked}>
      <legend className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
        Destination
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {profiles.map((profile) => {
          const active = selected === profile.id;
          const Icon = profile.id.startsWith("robot") ? Bot : Users;
          return (
            <button
              key={profile.id}
              type="button"
              onClick={() => onSelect(profile.id)}
              aria-pressed={active}
              className={[
                "rounded-card border p-4 text-left",
                "transition-[border-color,background-color,box-shadow] duration-200",
                active
                  ? "border-brand bg-brand-soft shadow-sm ring-1 ring-brand/20"
                  : "border-line bg-surface hover:border-brand/40 hover:bg-muted/50",
                locked ? "cursor-not-allowed opacity-60" : "",
              ].join(" ")}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span
                  className={[
                    "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                    active ? "bg-brand text-on-brand" : "bg-muted text-ink-soft",
                  ].join(" ")}
                  aria-hidden
                >
                  <Icon size={16} />
                </span>
                {active && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-brand">
                    <CheckCircle2 size={10} strokeWidth={3} aria-hidden />
                    Selected
                  </span>
                )}
              </div>
              <p className="text-[13px] font-semibold tracking-[-0.01em]">
                {profile.display_name}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                {profile.description}
              </p>
              <p className="mt-2 font-mono text-[10px] text-ink-soft/80">
                {profile.destination_table} · {profile.column_count} columns
              </p>
            </button>
          );
        })}
      </div>
      {locked && (
        <p className="mt-2.5 text-xs text-ink-soft">
          The destination is fixed once a file is uploaded. Cancel and start again
          to migrate into a different one.
        </p>
      )}
    </fieldset>
  );
}

export function SourceStep({ onNext, onCancel }: { onNext: () => void; onCancel: () => void }) {
  const {
    migrationId,
    filename,
    uploadFile,
    busy,
    destinationProfile,
    setDestinationProfile,
  } = useMigration();
  const [profiles, setProfiles] = useState<ApiDestinationProfile[]>([]);
  // Until this settles, the destination on screen is not yet the destination
  // an upload would record. Uploading before then is how an operator ends up
  // with robotics selected and a customer migration created.
  const [profilesReady, setProfilesReady] = useState(false);
  // Two ways in, stated as a choice rather than a demo link hidden under an
  // upload box. Neither is a shortcut: both end at the same endpoint.
  const [entry, setEntry] = useState<"upload" | "demo">("upload");
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

  useEffect(() => {
    let active = true;
    api
      .destinationProfiles()
      .then((result) => {
        if (!active) return;
        setProfiles(result.profiles);
        // The backend names its own default, so the browser never has to.
        if (!destinationProfile) setDestinationProfile(result.default);
      })
      .catch(() => {
        // An older backend has no profiles endpoint. Customers is then the
        // only destination, and omitting the parameter selects it.
        if (active) setProfiles([]);
      })
      .finally(() => {
        if (active) setProfilesReady(true);
      });
    return () => {
      active = false;
    };
    // The store setters are stable; this runs once per step mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accept = async (file: File | undefined) => {
    if (!file) return;
    // Refuse rather than upload against a destination that may still change
    // under the operator a moment later.
    if (!profilesReady) return;
    await uploadFile(file, destinationProfile ?? undefined);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    void accept(event.dataTransfer.files?.[0]);
  };

  const uploading = busy === "Uploading and parsing";

  return (
    <div>
      <Stepper steps={WIZARD_STEPS} current={0} />
      <StepIntro
        step={1}
        title="Upload your source file"
        description="CSV, TSV, XLSX, or XLSM, up to 25 MB. The file is parsed by the backend and the original bytes are stored, so a repair can always return to the source."
      />

      {/* The dropzone is the only thing on screen until a file lands, so it
          carries the weight: a layered surface, a real target area, and the
          formats stated where they are needed rather than in a footnote. */}
      {/* One file per migration, and the reason said once, where the
          decision is made. */}
      <div className="mb-6 flex items-start gap-2.5 rounded-card border border-line bg-muted/40 px-4 py-3 text-[13px] leading-relaxed text-ink-soft">
        <ShieldCheck size={15} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          One source file per migration. Keeping them separate is what makes
          execution, verification, evidence and rollback isolated and auditable:
          every row committed can be traced to one upload, and rolling back
          removes exactly those rows.
        </span>
      </div>

      <div
        className="mb-6 grid gap-2.5 sm:grid-cols-2"
        role="group"
        aria-label="How to start"
      >
        {[
          {
            key: "upload" as const,
            title: "Upload your own file",
            body: "A CSV, TSV, XLSX or XLSM from your machine, up to 25 MB.",
            Icon: Upload,
          },
          {
            key: "demo" as const,
            title: "Try demo data",
            body: "Real tracked fixtures, run through the identical pipeline.",
            Icon: Bot,
          },
        ].map((option) => {
          const active = entry === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setEntry(option.key)}
              aria-pressed={active}
              disabled={migrationId !== null}
              className={[
                "rounded-card border p-4 text-left",
                "transition-[border-color,background-color,box-shadow] duration-200",
                active
                  ? "border-brand bg-brand-soft shadow-sm ring-1 ring-brand/20"
                  : "border-line bg-surface hover:border-brand/40 hover:bg-muted/50",
                migrationId !== null ? "cursor-not-allowed opacity-60" : "",
              ].join(" ")}
            >
              <span
                className={[
                  "mb-2 flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                  active ? "bg-brand text-on-brand" : "bg-muted text-ink-soft",
                ].join(" ")}
                aria-hidden
              >
                <option.Icon size={16} />
              </span>
              <span className="block text-[13px] font-semibold">{option.title}</span>
              <span className="mt-1 block text-xs leading-relaxed text-ink-soft">
                {option.body}
              </span>
            </button>
          );
        })}
      </div>

      <ProfilePicker
        profiles={profiles}
        selected={destinationProfile}
        onSelect={setDestinationProfile}
        locked={migrationId !== null}
      />

      {entry === "demo" && !migrationId ? (
        <DemoLibrary
          availableProfiles={profiles.map((profile) => profile.id)}
          selectedProfile={destinationProfile}
          profileNames={Object.fromEntries(
            profiles.map((profile) => [profile.id, profile.display_name])
          )}
          onSwitchProfile={setDestinationProfile}
          disabled={!profilesReady || busy !== null}
          onUse={async (file, profile) => {
            // Identical to a dragged file: same store action, same endpoint.
            // Only datasets for the chosen destination are usable, so the
            // destination never changes behind the operator's back.
            await uploadFile(file, profile);
          }}
        />
      ) : (
      <div
        onDragOver={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          "relative overflow-hidden rounded-card border-2 border-dashed px-6 py-12 text-center",
          "transition-[border-color,background-color] duration-200",
          dragging
            ? "border-brand bg-brand-soft"
            : "border-line bg-gradient-to-b from-surface to-canvas hover:border-brand/40",
        ].join(" ")}
      >
        <span
          className={[
            "mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl",
            "transition-colors duration-200",
            dragging ? "bg-brand text-on-brand" : "bg-brand-soft text-brand",
          ].join(" ")}
          aria-hidden
        >
          {uploading ? (
            <Loader2 size={24} className="spin" />
          ) : (
            <Upload size={24} strokeWidth={2.25} />
          )}
        </span>

        <p className="text-[15px] font-semibold tracking-[-0.01em]">
          {dragging ? "Release to upload" : "Drop a spreadsheet here"}
        </p>
        <p className="mt-1.5 text-[13px] text-ink-soft">
          or choose a file from your computer
        </p>

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
          className="mt-5"
          onClick={() => inputRef.current?.click()}
          disabled={busy !== null || !profilesReady}
        >
          {!profilesReady
            ? "Loading destinations"
            : uploading
              ? "Uploading"
              : "Choose a file"}
        </Button>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-line pt-5">
          <TrustNote icon={FileSpreadsheet}>CSV, TSV, XLSX, XLSM · up to 25 MB</TrustNote>
          <TrustNote icon={ShieldCheck}>Original bytes stored with a checksum</TrustNote>
          <TrustNote icon={Lock}>Nothing is written to the destination yet</TrustNote>
        </div>
      </div>
      )}

      {uploading && (
        <p className="mt-4 flex items-center gap-2 text-sm text-ink-soft" role="status">
          <Loader2 size={15} className="spin" aria-hidden />
          Parsing the file on the backend
        </p>
      )}

      {preview && (
        <div className="mt-6 overflow-hidden rounded-card border border-line bg-surface shadow-sm">
          {/* The ingested file, presented as a record rather than a filename:
              what arrived, how much of it, and that it is now held safely. */}
          <div className="flex flex-wrap items-center gap-4 border-b border-line bg-gradient-to-r from-brand-soft/60 to-transparent px-5 py-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface text-brand shadow-sm">
              <FileSpreadsheet size={20} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold tracking-[-0.01em]">
                {filename ?? preview.filename}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
                <span className="font-mono tabular-nums">{preview.row_count}</span> rows
                <span aria-hidden>·</span>
                <span className="font-mono tabular-nums">{preview.columns.length}</span> columns
                {preview.truncated && (
                  <>
                    <span aria-hidden>·</span>
                    showing the first {preview.rows.length}
                  </>
                )}
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 text-[11px] font-semibold text-ok">
              <CheckCircle2 size={13} strokeWidth={2.5} aria-hidden />
              Parsed
            </span>
          </div>

          <div className="table-scroll">
            <table className="w-full min-w-[680px] border-collapse text-table">
              <thead>
                <tr className="bg-muted/60">
                  {preview.columns.map((header) => (
                    <th
                      key={header}
                      scope="col"
                      className="whitespace-nowrap border-b border-line px-4 py-3 text-left font-mono text-[11px] font-semibold text-ink-soft"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr
                    key={row.row_number}
                    className="border-t border-line transition-colors hover:bg-muted/40"
                  >
                    {preview.columns.map((column) => {
                      const value = row.values[column] ?? "";
                      return (
                        <td key={column} className="px-4 py-2.5 font-mono">
                          {value === "" ? (
                            <span className="text-ink-soft/70">(empty)</span>
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

          <p className="flex items-start gap-2 border-t border-line bg-muted/30 px-5 py-3 text-xs leading-relaxed text-ink-soft">
            <KeyRound size={13} className="mt-0.5 shrink-0" aria-hidden />
            Values are shown exactly as the parser read them. Nothing has been coerced to a
            number or a date yet, because type interpretation is a decision the plan makes
            explicitly.
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
  const { destinationProfile } = useMigration();
  const [schema, setSchema] = useState<ApiDestinationSchema | null>(null);

  useEffect(() => {
    let active = true;
    setSchema(null);
    api
      // The real schema for the chosen destination, from the backend registry.
      // Nothing here is constructed in the browser.
      .destinationSchema(destinationProfile ?? undefined)
      .then((result) => {
        if (active) setSchema(result);
      })
      .catch(() => {
        if (active) setSchema(null);
      });
    return () => {
      active = false;
    };
  }, [destinationProfile]);

  const required = schema?.columns.filter((column) => column.required).length ?? 0;

  return (
    <div>
      <Stepper steps={WIZARD_STEPS} current={1} />
      <StepIntro
        step={2}
        title="Destination schema"
        description={
          schema
            ? `${schema.name}, schema version ${schema.version}. You do not need to write SQL to continue.`
            : "Loading the destination schema from the backend."
        }
        aside={
          schema ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-[11px] text-ink-soft">
                {schema.columns.length} columns
              </span>
              <span className="rounded-full bg-bad-soft px-2.5 py-1 text-[11px] font-semibold text-bad">
                {required} required
              </span>
            </div>
          ) : undefined
        }
      />

      {schema ? (
        <>
          <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
            <div className="table-scroll">
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60">
                    {["Column", "Type", "Requirement", "Constraint", "Description"].map(
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
                  {schema.columns.map((column) => (
                    <tr
                      key={column.name}
                      className="border-t border-line align-top transition-colors hover:bg-muted/40"
                    >
                      <td className="px-4 py-3.5 font-mono text-[13px] font-semibold">
                        {column.name}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[13px] text-ink-soft">
                        {column.type}
                      </td>
                      <td className="px-4 py-3.5">
                        {/* Required is the one value a reader scans for, so it
                            gets a chip and Optional stays quiet. */}
                        {column.required ? (
                          <span className="inline-flex items-center rounded-full bg-bad-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-bad">
                            Required
                          </span>
                        ) : (
                          <span className="text-[11px] uppercase tracking-wider text-ink-soft/70">
                            Optional
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-[13px] text-ink-soft">
                        {column.unique ? (
                          <span className="inline-flex items-center gap-1.5 text-[13px]">
                            <KeyRound size={12} className="shrink-0" aria-hidden />
                            Unique
                          </span>
                        ) : (
                          <span className="text-ink-soft/70">None</span>
                        )}
                      </td>
                      <td className="max-w-sm px-4 py-3.5 text-[13px] leading-relaxed text-ink-soft">
                        {column.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-3 flex items-center gap-2 font-mono text-[11px] text-ink-soft">
            <ShieldCheck size={12} aria-hidden />
            Verification contract {schema.contract.version} ·{" "}
            {schema.contract.hash.slice(0, 22)}
          </p>
        </>
      ) : (
        <div
          className="flex items-center gap-3 rounded-card border border-line bg-surface px-5 py-8 text-sm text-ink-soft"
          role="status"
        >
          <Loader2 size={16} className="spin text-brand" aria-hidden />
          Loading the destination schema
        </div>
      )}

      <WizardActions onBack={onBack} backLabel={`Back to ${backLabel.toLowerCase()}`}>
        <Button icon={ArrowRight} iconPosition="right" onClick={onNext} disabled={!schema}>
          Continue to mapping
        </Button>
      </WizardActions>
    </div>
  );
}
