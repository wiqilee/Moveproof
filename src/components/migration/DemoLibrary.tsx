"use client";

import { useState } from "react";
import { Bot, Eye, Info, Loader2, Upload } from "lucide-react";
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
}: {
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

  return (
    <div className="space-y-3">
      {DEMO_DATASETS.map((dataset) => {
        const open = preview?.id === dataset.id;
        // The server decides which destinations exist. An empty list means the
        // backend advertised none, so nothing here is actionable.
        const offered = availableProfiles.includes(dataset.profile);
        return (
          <article
            key={dataset.id}
            className="overflow-hidden rounded-card border border-line bg-surface shadow-sm transition-colors hover:border-brand/40"
          >
            <div className="flex flex-wrap items-start gap-3 px-5 py-4">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"
                aria-hidden
              >
                <Bot size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-semibold tracking-[-0.01em]">
                  {dataset.name}
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                  {dataset.purpose}
                </p>
                <ul className="mt-2.5 space-y-1">
                  {dataset.demonstrates.map((line) => (
                    <li
                      key={line}
                      className="flex gap-2 text-xs leading-relaxed text-ink-soft"
                    >
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" aria-hidden />
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
                disabled={disabled || !offered || loading !== null}
              >
                {loading === `${dataset.id}:use`
                  ? "Uploading"
                  : offered
                    ? "Use this dataset"
                    : "Destination unavailable"}
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
        );
      })}
    </div>
  );
}
