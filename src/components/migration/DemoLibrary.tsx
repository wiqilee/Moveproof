"use client";

import { useState } from "react";
import { ArrowRightLeft, Bot, Eye, Info, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * The demo dataset library.
 *
 * Every dataset here is the real tracked fixture, served as a static file and
 * uploaded through the same `POST /api/migrations` a dragged file uses. There
 * is no shortcut and no prepared result: a demo migration is parsed, planned,
 * validated, approved, staged and verified exactly like any other, and it can
 * fail exactly like any other.
 *
 * That matters more than the convenience. A demo that skipped the pipeline
 * would prove nothing about the product, which is the one thing a demo is for.
 *
 * Nothing here answers an ambiguity on the operator's behalf. The ambiguous
 * dataset arrives ambiguous, and the mapping step still asks.
 */

export interface DemoDataset {
  id: string;
  /** Served from /public/demo, byte-identical to backend/tests/fixtures. */
  file: string;
  name: string;
  /** What this dataset is for, in one line. */
  purpose: string;
  /** What a reviewer should watch happen. */
  demonstrates: string[];
  profile: string;
  /** A short label for what the run will feel like. Never a promise about
   *  infrastructure the deployment may not have configured. */
  experience: string;
  rows: number;
}

export const DEMO_DATASETS: DemoDataset[] = [
  {
    id: "robot-clean",
    file: "robot_calibration_clean.csv",
    name: "Robotics calibration, clean",
    purpose:
      "Canonical ISO dates and one decimal convention. No ambiguity-resolution questions.",
    experience: "Clean path · stays on Super",
    demonstrates: [
      "Identifiers keep their leading zeros: 0017 is not 17",
      "Firmware 3.08 stays text rather than becoming a number",
      "ISO dates and one decimal convention, so nothing is ambiguous",
    ],
    profile: "robot_calibration_v1",
    rows: 5,
  },
  {
    id: "robot-ambiguous",
    file: "robot_calibration_ambiguous.csv",
    name: "Robotics calibration, ambiguous",
    purpose:
      "The data cannot say what it means. Deterministic validation finds two concerns and you decide.",
    experience: "Ambiguous path · exercises Ultra when escalation is configured",
    demonstrates: [
      "03/04/2026 reads as 3 April or 4 March, and the file cannot say which",
      "gear_ratio mixes 1,250.00 with 1250,00 in one column",
      "Two concerns exercise the Ultra path when escalation is configured",
      "Approval stays blocked until you choose both readings",
    ],
    profile: "robot_calibration_v1",
    rows: 5,
  },
  {
    id: "robot-multi-joint",
    file: "robot_calibration_multi_joint.csv",
    name: "Robotics calibration, multi-joint",
    purpose:
      "One robot with several joints, which a single-key workflow would call duplicate rows.",
    experience: "Composite identity · (robot_id, joint_name)",
    demonstrates: [
      "0017 appears three times, once per joint, and all three are real rows",
      "Row identity is the pair (robot_id, joint_name)",
      "A repeated pair would still be caught as a genuine duplicate",
    ],
    profile: "robot_calibration_v1",
    rows: 5,
  },
];

/**
 * One CSV row, quotes respected.
 *
 * `line.split(",")` produced eight cells for a seven-column row whenever a
 * value looked like "1,250.00", which is exactly the fixture this library
 * exists to show. Small and local on purpose: the backend parser remains the
 * only thing that reads a file for real, and this never touches an upload.
 */
export function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else cell += char;
  }

  cells.push(cell);
  return cells.map((value) => value.trim());
}

async function fetchDataset(dataset: DemoDataset): Promise<File> {
  const response = await fetch(`/demo/${dataset.file}`);
  if (!response.ok) {
    throw new Error(`The demo file ${dataset.file} could not be read.`);
  }
  const blob = await response.blob();
  // A real File, so the upload path cannot tell this apart from a drag and
  // drop. Same endpoint, same parser, same everything after this line.
  return new File([blob], dataset.file, { type: "text/csv" });
}

export function DemoLibrary({
  onUse,
  availableProfiles,
  disabled,
  selectedProfile,
  profileNames = {},
  onSwitchProfile,
}: {
  /**
   * The destination chosen above. A dataset only becomes usable when it
   * targets that destination, so a demo can never silently change the
   * destination the operator picked.
   */
  selectedProfile: string | null;
  /** Display names by profile id, for the explanation. */
  profileNames?: Record<string, string>;
  /** Lets the operator switch destination explicitly from here. */
  onSwitchProfile?: (profile: string) => void;
  onUse: (file: File, profile: string) => Promise<unknown> | void;
  /**
   * Destination profiles this backend actually advertises.
   *
   * The fixture metadata names a profile, but the server allowlist decides
   * what exists. A dataset whose destination is not offered here is shown and
   * explained, never submitted: sending an unadvertised id would push a value
   * the backend never published back at it.
   */
  availableProfiles: string[];
  disabled: boolean;
}) {
  const [preview, setPreview] = useState<{ id: string; rows: string[][] } | null>(
    null
  );
  const [loading, setLoading] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const showPreview = async (dataset: DemoDataset) => {
    if (preview?.id === dataset.id) {
      setPreview(null);
      return;
    }
    setLoading(`${dataset.id}:preview`);
    setFailed(null);
    try {
      const file = await fetchDataset(dataset);
      const text = await file.text();
      // A preview, not a parser. The backend does the real reading; this is
      // only enough to see the shape before choosing.
      setPreview({
        id: dataset.id,
        rows: text
          .trim()
          .split("\n")
          .slice(0, 4)
          .map(parseCsvRow),
      });
    } catch {
      setFailed(dataset.id);
    } finally {
      setLoading(null);
    }
  };

  const use = async (dataset: DemoDataset) => {
    setLoading(`${dataset.id}:use`);
    setFailed(null);
    try {
      await onUse(await fetchDataset(dataset), dataset.profile);
    } catch {
      setFailed(dataset.id);
    } finally {
      setLoading(null);
    }
  };

  // Datasets that target the destination chosen above. Every current fixture
  // is a robotics fixture, so choosing Customer records leaves none usable.
  const matching = DEMO_DATASETS.filter(
    (dataset) => !selectedProfile || dataset.profile === selectedProfile
  );
  const suggested = DEMO_DATASETS.find((dataset) =>
    availableProfiles.includes(dataset.profile)
  )?.profile;
  const nameOf = (id: string) => profileNames[id] ?? id;

  return (
    <div className="space-y-3">
      {/* A slowly turning teal-to-cyan sweep for the hovered dataset's
          border. @property lets the angle animate smoothly; browsers without
          it show the same gradient, still. Reduced motion keeps it still. */}
      <style>{`
        @property --mp-angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
        .mp-demo-ring {
          background: conic-gradient(from var(--mp-angle),
            rgba(20, 184, 166, 0) 0deg,
            rgba(20, 184, 166, 0.85) 70deg,
            rgba(56, 189, 248, 0.75) 120deg,
            rgba(20, 184, 166, 0) 190deg,
            rgba(20, 184, 166, 0.25) 280deg,
            rgba(20, 184, 166, 0) 360deg);
          animation: mp-demo-spin 4.5s linear infinite;
        }
        .mp-demo-ring-strong {
          background: conic-gradient(from var(--mp-angle),
            rgba(20, 184, 166, 0.15) 0deg,
            rgba(94, 234, 212, 1) 80deg,
            rgba(56, 189, 248, 0.9) 130deg,
            rgba(20, 184, 166, 0.15) 220deg,
            rgba(20, 184, 166, 0.15) 360deg);
          animation-duration: 3.5s;
        }
        @keyframes mp-demo-spin { to { --mp-angle: 360deg; } }
        @media (prefers-reduced-motion: reduce) { .mp-demo-ring { animation: none; } }
      `}</style>
      {matching.length === 0 && selectedProfile && (
        <div className="flex flex-col gap-3 rounded-card border border-line bg-muted/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-soft">
            <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              There are no demo datasets for{" "}
              <span className="font-semibold text-ink">{nameOf(selectedProfile)}</span> yet. The
              datasets below target{" "}
              <span className="font-semibold text-ink">
                {suggested ? nameOf(suggested) : "another destination"}
              </span>
              . Upload your own file, or switch the destination to use them.
            </span>
          </p>
          {suggested && onSwitchProfile && (
            // The one action that unlocks the demo datasets, so it carries
            // the dataset colour and a slowly turning ring to draw the eye.
            <span className="relative inline-flex shrink-0 rounded-control p-[2px]">
              <span
                aria-hidden
                className="mp-demo-ring mp-demo-ring-strong pointer-events-none absolute inset-0 rounded-control"
              />
              <button
                type="button"
                onClick={() => onSwitchProfile(suggested)}
                disabled={disabled}
                className="relative inline-flex items-center gap-2 whitespace-nowrap rounded-[7px] bg-[#0d9488] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_20px_-12px_rgba(13,148,136,0.8)] transition-colors duration-200 hover:bg-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4] focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ArrowRightLeft size={14} aria-hidden />
                Switch to {nameOf(suggested)}
              </button>
            </span>
          )}
        </div>
      )}

      {DEMO_DATASETS.map((dataset) => {
        const open = preview?.id === dataset.id;
        // The server decides which destinations exist. An empty list means the
        // backend advertised none, so nothing here is actionable.
        const offered = availableProfiles.includes(dataset.profile);
        // A dataset for a different destination is shown, dimmed and
        // inactive, never submitted under the wrong contract.
        const mismatched = Boolean(selectedProfile) && dataset.profile !== selectedProfile;
        return (
          // The outer frame carries the rotating ring; the card sits 1px
          // inside it, so the ring reads as the card's own border.
          <div key={dataset.id} className="group/demo relative rounded-card p-px">
            {!mismatched && (
              <span
                aria-hidden
                className="mp-demo-ring pointer-events-none absolute inset-0 rounded-card opacity-0 transition-opacity duration-500 group-hover/demo:opacity-100 group-focus-within/demo:opacity-100"
              />
            )}
          <article
            aria-disabled={mismatched || undefined}
            className={[
              "relative overflow-hidden rounded-[11px] border bg-surface shadow-sm transition-[border-color,box-shadow,opacity] duration-300",
              mismatched
                ? "border-line opacity-55"
                : "border-line group-hover/demo:border-transparent group-hover/demo:shadow-[0_14px_34px_-22px_rgba(13,148,136,0.6)] group-focus-within/demo:border-transparent",
            ].join(" ")}
          >
            <div className="px-5 py-4">
              {/* Teal, not blue: blue marks the destination above, teal marks
                  a dataset, so the two choices never look alike. The icon and
                  title share one frame and light up together. */}
              <div
                className={[
                  "-ml-1 inline-flex max-w-full items-center gap-3 rounded-lg border py-1 pl-1 pr-3 transition-[border-color,background-color] duration-300",
                  mismatched
                    ? "border-transparent"
                    : "border-transparent group-hover/demo:border-[#14b8a6]/45 group-hover/demo:bg-[#14b8a6]/[0.07] group-focus-within/demo:border-[#14b8a6]/45",
                ].join(" ")}
              >
                <span
                  className={[
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-[color,background-color,box-shadow] duration-300",
                    mismatched
                      ? "bg-muted text-ink-soft"
                      : "bg-[#14b8a6]/10 text-[#0f766e] group-hover/demo:bg-[#0d9488] group-hover/demo:text-white group-hover/demo:shadow-[0_0_0_4px_rgba(20,184,166,0.15),0_0_16px_rgba(20,184,166,0.5)] dark:text-[#5eead4] dark:group-hover/demo:text-white",
                  ].join(" ")}
                  aria-hidden
                >
                  <Bot size={17} />
                </span>
                <h3
                  className={[
                    "truncate text-[15px] font-semibold tracking-[-0.01em] transition-colors duration-300",
                    mismatched ? "" : "group-hover/demo:text-[#0f766e] dark:group-hover/demo:text-[#5eead4]",
                  ].join(" ")}
                >
                  {dataset.name}
                </h3>
              </div>
              <div className="mt-1.5 min-w-0 pl-12">
                <p className="text-[13px] leading-relaxed text-ink-soft">
                  {dataset.purpose}
                </p>
                <ul className="mt-2.5 space-y-1">
                  {dataset.demonstrates.map((line) => (
                    <li
                      key={line}
                      className="flex gap-2 text-xs leading-relaxed text-ink-soft"
                    >
                      <span
                        className={[
                          "mt-1.5 h-1 w-1 shrink-0 rounded-full",
                          mismatched ? "bg-ink-soft/50" : "bg-[#14b8a6]",
                        ].join(" ")}
                        aria-hidden
                      />
                      {line}
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 font-mono text-[10px] text-ink-soft/80">
                  {dataset.file} · {dataset.rows} rows · {dataset.profile}
                </p>
              </div>
            </div>

            {open && (
              <div className="border-t border-line bg-muted/30">
                <div className="table-scroll">
                  <table className="w-full min-w-[640px] border-collapse text-[11px]">
                    <tbody>
                      {preview.rows.map((row, index) => (
                        <tr
                          key={index}
                          className={index === 0 ? "bg-muted/60" : "border-t border-line"}
                        >
                          {row.map((cell, cellIndex) => (
                            <td
                              key={cellIndex}
                              className={`px-3 py-2 font-mono ${
                                index === 0 ? "font-semibold text-ink-soft" : ""
                              }`}
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-5 py-2.5 text-[11px] text-ink-soft">
                  First rows only. The backend parses the file itself on upload.
                </p>
              </div>
            )}

            {failed === dataset.id && (
              <p className="border-t border-line bg-bad-soft px-5 py-2.5 text-[13px] text-bad">
                That dataset could not be read. It is served from /demo, so a
                failure here usually means the file is missing from the build.
              </p>
            )}

            {!offered && (
              <p className="flex items-start gap-2 border-t border-line bg-muted/40 px-5 py-3 text-[13px] leading-relaxed text-ink-soft">
                <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  This backend does not offer the{" "}
                  <span className="font-mono">{dataset.profile}</span>{" "}
                  destination, so the dataset cannot be used here. Preview still
                  works, and the file itself is unchanged.
                </span>
              </p>
            )}

            <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
              <Button
                icon={loading === `${dataset.id}:use` ? Loader2 : Upload}
                onClick={() => void use(dataset)}
                disabled={disabled || !offered || mismatched || loading !== null}
              >
                {loading === `${dataset.id}:use`
                  ? "Uploading"
                  : !offered
                    ? "Destination unavailable"
                    : mismatched
                      ? `Requires ${nameOf(dataset.profile)}`
                      : "Use this dataset"}
              </Button>
              <Button
                variant="secondary"
                icon={loading === `${dataset.id}:preview` ? Loader2 : Eye}
                onClick={() => void showPreview(dataset)}
                disabled={loading !== null}
              >
                {open ? "Hide preview" : "Preview"}
              </Button>
            </div>
          </article>
          </div>
        );
      })}
    </div>
  );
}
