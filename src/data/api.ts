/**
 * The adapter between the backend and the interface.
 *
 * Every screen reads through this module. It converts API payloads into the
 * domain types the components already use, which is why wiring the backend up
 * did not require rewriting the UI.
 *
 * The mock layer that used to live here is gone. Nothing in this file returns
 * a fabricated verification result: if the backend is unreachable the call
 * fails and the interface says so, because a product about evidence should not
 * quietly invent some.
 */

import { api, ApiError } from "@/lib/api-client";
import type { ErrorKind } from "@/lib/api-client";
import type { ApiEvidence, ApiPlanMapping } from "@/lib/api-types";
import type { MappingStatus } from "@/domain/types";

export { api, ApiError };

export interface UiMapping {
  sourceColumn: string;
  destinationColumn: string | null;
  operationLabel: string;
  status: MappingStatus;
  note: string | null;
  requiresAcknowledgement: boolean;
}

const OPERATION_LABELS: Record<string, string> = {
  preserve_identifier_as_string: "Preserve value as text",
  cast_to_integer: "Cast with explicit rule to INTEGER",
  cast_to_decimal: "Cast with explicit rule to an exact decimal",
  normalize_whitespace: "Normalize whitespace",
  rename_field: "Rename field",
  parse_date: "Parse date under the approved format policy",
  null_handling: "Apply null handling, empty string becomes NULL",
  deduplicate: "Deduplication policy: keep first exact duplicate",
};

/**
 * Columns whose value is an identifier rather than ordinary text.
 *
 * `preserve_identifier_as_string` is one operation serving two purposes: it
 * keeps `00127` and `0017` intact, and it also carries ordinary strings like
 * `region` or `sensor_frame` through untouched. The operation code is correct
 * for both, so the fix belongs in presentation rather than in a rename that
 * would make the code wrong for half its uses.
 *
 * Identifier wording is therefore chosen per column, not per operation.
 */
const IDENTIFIER_COLUMNS = new Set(["customer_id", "robot_id"]);

function operationLabel(mapping: ApiPlanMapping): string {
  const base = OPERATION_LABELS[mapping.operation] ?? mapping.operation;

  if (mapping.operation !== "preserve_identifier_as_string") return base;

  const column = mapping.destination_column ?? mapping.source_column;
  return IDENTIFIER_COLUMNS.has(column)
    ? "Preserve identifier as text, leading zeros intact"
    : base;
}

export function toUiMapping(mapping: ApiPlanMapping): UiMapping {
  return {
    sourceColumn: mapping.source_column,
    destinationColumn: mapping.destination_column,
    operationLabel: operationLabel(mapping),
    status: mapping.status as MappingStatus,
    note: mapping.note,
    requiresAcknowledgement: mapping.requires_acknowledgement,
  };
}

/** Serialise the canonical evidence object for the JSON export. */
export function serializeEvidence(evidence: ApiEvidence): string {
  return JSON.stringify(evidence, null, 2);
}

/**
 * A human readable explanation for an error, chosen by kind rather than by
 * status code, so an operator learns whether their work survived.
 */
export function describeError(error: unknown): {
  title: string;
  detail: string;
  retryable: boolean;
  /**
   * The backend's own classification, carried through rather than dropped.
   *
   * A screen that wants to say *why* something failed needs this. Inferring a
   * destination conflict from an error string would be guessing, and a commit
   * that failed because the network dropped is not a conflict.
   */
  kind: ErrorKind;
} {
  if (error instanceof ApiError) {
    const retryable = error.isRetryable;
    switch (error.kind) {
      case "network":
        return {
          title: "The backend is not reachable",
          // Safe for a read, unsafe for a write: a commit can succeed on the
          // server and still lose its response. This sentence is shown by the
          // global banner too, so it must not claim anything about what the
          // server did.
          detail: `${error.message} The request did not complete normally. For actions that may write data, refresh the current state before retrying.`,
          retryable: true,
          kind: error.kind,
        };
      case "commit_gate":
        return {
          title: "Commit was blocked",
          detail: error.message,
          retryable: false,
          kind: error.kind,
        };
      case "workflow":
        return {
          title: "This step cannot run yet",
          detail: error.message,
          retryable: false,
          kind: error.kind,
        };
      case "parse":
        return {
          title: "The file could not be read",
          detail: error.message,
          retryable: false,
          kind: error.kind,
        };
      case "integrity":
        return {
          title: "The stored source failed its integrity check",
          detail: error.message,
          retryable: false,
          kind: error.kind,
        };
      default:
        return {
          title: "Something went wrong",
          detail: error.message,
          retryable,
          kind: error.kind,
        };
    }
  }
  return {
    title: "Something went wrong",
    detail: error instanceof Error ? error.message : String(error),
    retryable: false,
    // Not an ApiError at all, so the backend classified nothing.
    kind: "unknown",
  };
}
