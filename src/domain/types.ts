/**
 * The status vocabulary the interface reasons about.
 *
 * This file is deliberately small. The full domain model, including plan
 * versioning, the operation allowlist, row dispositions and the verification
 * engine, lives in the Python backend under `backend/app/domain`. The backend
 * is the authority: it computes every result, and the frontend renders what it
 * returns.
 *
 * What remains here are the shared vocabularies the interface needs in order
 * to render a status correctly, and the one row shape the source preview
 * uses. Payload shapes as they arrive over the wire are in
 * `src/lib/api-types.ts`.
 */

/**
 * The outcome of a verification check. These four do not overlap.
 *
 * - `passed`       the check ran against transformed data and succeeded
 * - `failed`       the check ran and an approved invariant was violated
 * - `review`       the check ran and needs a human decision to resolve
 * - `not_verified` the property was not configured or not executed
 *
 * A check that never ran is never reported as passed.
 */
export type CheckStatus = "passed" | "failed" | "review" | "not_verified";

/**
 * The status of a mapping inside a proposed plan.
 *
 * Separate from CheckStatus on purpose, and with no passed member, so a
 * proposal cannot be rendered as though it were a verified result.
 */
export type MappingStatus = "proposed" | "review" | "approved";

/** Where a migration stands in its lifecycle. */
export type MigrationState =
  | "draft"
  | "plan_approved"
  | "staging"
  | "verification_failed"
  | "review_required"
  | "ready_to_commit"
  | "committed"
  | "rolled_back";

/** A row from the source preview, as the parser read it. */
export interface SourceRow {
  rowNumber: number;
  values: Record<string, string>;
}
