/**
 * Response shapes returned by the FastAPI backend.
 *
 * These mirror `backend/app/api/main.py`. They are kept separate from
 * `src/domain/types.ts` on purpose: the domain types describe what the
 * interface reasons about, and these describe what arrives over the wire. The
 * adapter in `src/data/api.ts` is the single place the two meet, so a backend
 * field rename breaks one file rather than twenty components.
 */

export interface ApiDestinationColumn {
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  description: string;
}

/**
 * One destination MoveProof can migrate into.
 *
 * The backend registry is the authority. The browser never constructs a
 * profile id of its own; it offers what /api/schema/profiles returned.
 */
export interface ApiDestinationProfile {
  id: string;
  display_name: string;
  description: string;
  destination_table: string;
  schema_version: string;
  column_count: number;
  required_count: number;
}

export interface ApiDestinationSchema {
  name: string;
  version: string;
  columns: ApiDestinationColumn[];
  contract: {
    version: string;
    destination_schema: string;
    destination_schema_version: string;
    key_column: string;
    date_columns: string[];
    mandatory_checks: string[];
    advisory_checks: string[];
    exclusions: string[];
    hash: string;
  };
  /** Absent on a response from an older backend, which means customers_v1. */
  profile?: string;
}

export interface ApiUploadResult {
  migration_id: string;
  filename: string;
  checksum: string;
  row_count: number;
  columns: string[];
  encoding: string;
  delimiter: string;
}

export interface ApiPreview {
  migration_id: string;
  filename: string;
  columns: string[];
  row_count: number;
  state: string;
  rows: { row_number: number; values: Record<string, string> }[];
  truncated: boolean;
}

export interface ApiMigrationSummary {
  id: string;
  filename: string;
  checksum: string;
  row_count: number;
  state: string;
  created_at: string;
  updated_at: string;
  latest_plan_version: number | null;
  approved_plan_version: number | null;
  latest_run_id: string | null;
  verified_at: string | null;
  committed_at: string | null;
  /** Null for a migration recorded before profiles existed: customers_v1. */
  destination_profile?: string | null;
}

export interface ApiPlanMapping {
  source_column: string;
  destination_column: string | null;
  operation: string;
  status: "proposed" | "review" | "approved";
  note: string | null;
  requires_acknowledgement: boolean;
}

/**
 * The identity of a server-generated proposal.
 *
 * Approval names this rather than sending a plan back, so what executes is
 * the exact plan the server produced and the reviewer saw.
 */
export interface ApiProposalIdentity {
  version: number;
  hash: string;
  source: string;
}

export interface ApiPlanProposal {
  plan: {
    version: number;
    proposed_by: string;
    key_column: string;
    date_format_policy: string | null;
    duplicate_policy: string;
    required_field_policy: string | null;
    mappings: ApiPlanMapping[];
  };
  issues: { column: string; reason: string; fatal: boolean }[];
  is_executable: boolean;
  requires_acknowledgement: boolean;
  acknowledgement_columns: string[];
  contract_hash: string;
  /** Present from a backend that stores proposals. Approval binds to it. */
  proposal?: ApiProposalIdentity;
  /** Present only when the model source was used. */
  routing?: {
    default_model: string;
    selected_model: string;
    escalated: boolean;
    reasons: string[];
  };
}

export interface ApiApprovalResult {
  migration_id: string;
  plan_version: number;
  contract_hash: string;
  acknowledgements: string[];
}

export interface ApiRunResult {
  migration_id: string;
  run_id: string;
  plan_version: number;
  idempotency_key: string;
  accounting: {
    source_rows: number;
    staged_rows: number;
    committable_rows: number;
    arithmetic: string[];
  };
  applied_operations: string[];
  transform_errors: number;
}

export interface ApiCheckEvidence {
  row_key: string;
  field: string;
  source_value: string;
  destination_value: string;
}

export interface ApiCheck {
  check_id: string;
  name: string;
  expected: string;
  observed: string;
  status: "passed" | "failed" | "review" | "not_verified";
  mandatory?: boolean;
  evidence: ApiCheckEvidence[];
  checked_at?: string;
}

export interface ApiVerification {
  migration_id: string;
  run_id: string;
  state: string;
  summary: {
    passed: number;
    failed: number;
    review: number;
    not_verified: number;
    total: number;
  };
  checks: ApiCheck[];
}

export interface ApiRepairProposal {
  migration_id: string;
  run_id: string;
  current_plan_version: number;
  proposed_plan_version: number;
  failed_checks: {
    check_id: string;
    name: string;
    observed: string;
    evidence: ApiCheckEvidence[];
  }[];
  changes: { column: string; before: string; after: string }[];
  rerun_source: string;
  note: string;
}

export interface ApiCommitResult {
  migration_id: string;
  run_id: string;
  expected: number;
  written: number;
  skipped: number;
}

export interface ApiEvidence {
  schema_version: string;
  migration_id: string;
  run_id: string;
  state: string;
  source_file: {
    filename: string;
    content_type: string;
    byte_size: number;
    checksum: string;
    uploaded_by: string;
    uploaded_at: string;
    row_count: number;
    columns: string[];
  };
  destination: { schema: string; schema_version: string };
  plan: {
    version: number;
    proposed_by: string;
    approved_by: string | null;
    approved_at: string | null;
    acknowledgements: string[];
    conflict_policy: string;
    contract_hash: string | null;
    mappings: ApiPlanMapping[];
  };
  contract: { hash: string; exclusions: string[]; [key: string]: unknown };
  execution: {
    started_at: string;
    finished_at: string | null;
    verified_at: string | null;
    applied_operations: string[];
    transform_errors: {
      row_number: number;
      source_key: string;
      field: string;
      source_value: string;
      reason: string;
    }[];
  };
  row_accounting: {
    source_rows: number;
    duplicates_excluded: number;
    rejected: number;
    staged_rows: number;
    quarantined: number;
    policy_excluded: number;
    conflicts_unresolved: number;
    committable_rows: number;
    arithmetic: string[];
  };
  verification: {
    summary: ApiVerification["summary"];
    checks: ApiCheck[];
  };
  discrepancies: (ApiCheckEvidence & {
    check_id: string;
    check_name: string;
    status: string;
  })[];
  approvals: {
    action: string;
    plan_version: number;
    approved_by: string;
    approved_at: string;
  }[];
  commit: {
    committed_at: string;
    committed_by: string;
    expected_rows: number;
    written_rows: number;
    skipped_rows: number;
    conflict_policy: string;
  } | null;
  limitations: string[];
  not_verified: string[];
  disclaimer: string;
}

export interface ApiEvidenceSource {
  title: string;
  url: string;
  domain: string;
  excerpt: string;
  published_at: string | null;
}

/**
 * Advisory context for a human reviewer.
 *
 * Deliberately not called a verification result anywhere in this type. It
 * carries no status the verifier owns, and there is no field an interface
 * could read as passed or failed.
 */
export interface ApiExternalEvidence {
  migration_id: string;
  context: {
    source_column: string;
    destination_column: string;
    source_type: string | null;
    destination_type: string | null;
    proposed_operation: string | null;
    risk_category: string | null;
    source_system: string | null;
  };
  question: string;
  sanitized_query: string;
  provider: string;
  checked_at: string;
  status: "results" | "no_results";
  result_count: number;
  sources: ApiEvidenceSource[];
  advisory_notice: string;
}

export interface ApiEvidenceQuestion {
  id: string;
  label: string;
}

export interface ApiEvidenceRequest {
  source_column: string;
  destination_column: string;
  question: string;
  source_type?: string | null;
  destination_type?: string | null;
  proposed_operation?: string | null;
  risk_category?: string | null;
  ambiguity_reason?: string | null;
  source_system?: string | null;
}

export interface ApiHealth {
  status: "ok" | "degraded";
  database: { connected: boolean; detail: string | null };
  nebius: { configured: boolean; note: string };
  exports: {
    verified_csv_available: boolean;
  };
  reports: {
    pdf_available: boolean;
    html_available: boolean;
    json_available: boolean;
  };
  rust_verifier: { available: boolean; note: string };
  external_evidence: { available: boolean; provider: string; note: string };
  limits: { max_upload_bytes: number; model_sample_rows: number };
}

export interface ApiEvent {
  run_id: string | null;
  level: "info" | "warn" | "error" | "success";
  message: string;
  created_at: string;
}
