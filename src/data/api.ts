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
  preserve_identifier_as_string: "Preserve identifier as string, VARCHAR(20)",
  cast_to_integer: "Cast with explicit rule to INTEGER",
  cast_to_decimal: "Cast with explicit rule to NUMERIC(12,2)",
  normalize_whitespace: "Normalize whitespace",
  rename_field: "Rename field",
  parse_date: "Parse date under the approved format policy",
  null_handling: "Apply null handling, empty string becomes NULL",
  deduplicate: "Deduplication policy: keep first exact duplicate",
};

export function toUiMapping(mapping: ApiPlanMapping): UiMapping {
  return {
    sourceColumn: mapping.source_column,
    destinationColumn: mapping.destination_column,
    operationLabel: OPERATION_LABELS[mapping.operation] ?? mapping.operation,
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
} {
  if (error instanceof ApiError) {
    const retryable = error.isRetryable;
    switch (error.kind) {
      case "network":
        return {
          title: "The backend is not reachable",
          detail: `${error.message} Nothing has been lost and you can retry.`,
          retryable: true,
        };
      case "commit_gate":
        return {
          title: "Commit was blocked",
          detail: error.message,
          retryable: false,
        };
      case "workflow":
        return {
          title: "This step cannot run yet",
          detail: error.message,
          retryable: false,
        };
      case "parse":
        return {
          title: "The file could not be read",
          detail: error.message,
          retryable: false,
        };
      case "integrity":
        return {
          title: "The stored source failed its integrity check",
          detail: error.message,
          retryable: false,
        };
      default:
        return { title: "Something went wrong", detail: error.message, retryable };
    }
  }
  return {
    title: "Something went wrong",
    detail: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}
