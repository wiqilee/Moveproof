/**
 * The HTTP client.
 *
 * One place that knows the backend exists. Every call goes through `request`,
 * so timeouts, error shapes and the base URL are handled once.
 *
 * Errors carry the backend's `kind` where it sends one. That matters because a
 * commit blocked by a safety gate and a network failure both surface as a
 * rejected promise, and the interface has to tell an operator which happened.
 */

import type {
  ApiApprovalResult,
  ApiEvidenceQuestion,
  ApiEvidenceRequest,
  ApiExternalEvidence,
  ApiCommitResult,
  ApiDestinationSchema,
  ApiEvent,
  ApiEvidence,
  ApiHealth,
  ApiMigrationSummary,
  ApiPlanProposal,
  ApiPreview,
  ApiRepairProposal,
  ApiRunResult,
  ApiUploadResult,
  ApiVerification,
} from "./api-types";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const DEFAULT_TIMEOUT_MS = 30_000;

export type ErrorKind =
  | "evidence_unavailable"
  | "workflow"
  | "commit_gate"
  | "parse"
  | "integrity"
  | "source"
  | "network"
  | "unknown";

export class ApiError extends Error {
  readonly status: number;
  readonly kind: ErrorKind;

  constructor(message: string, status: number, kind: ErrorKind = "unknown") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
  }

  /** True when the operator's work is intact and the call can simply be retried. */
  get isRetryable(): boolean {
    return this.kind === "network" || this.status >= 500;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: body instanceof FormData ? headers : { "Content-Type": "application/json", ...headers },
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      signal: options.signal ?? controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    const aborted = error instanceof DOMException && error.name === "AbortError";
    throw new ApiError(
      aborted
        ? `The request to ${path} timed out. Your work is unchanged and you can retry.`
        : `Could not reach the backend at ${API_BASE_URL}. Is it running?`,
      0,
      "network"
    );
  }
  clearTimeout(timer);

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { detail: text };
    }
  }

  if (!response.ok) {
    const record = (payload ?? {}) as { detail?: string; kind?: ErrorKind };
    throw new ApiError(
      record.detail ?? `Request failed with status ${response.status}`,
      response.status,
      record.kind ?? "unknown"
    );
  }

  return payload as T;
}

export interface CsvExport {
  blob: Blob;
  filename: string;
  runId: string | null;
  planVersion: string | null;
  rowCount: number | null;
  committed: boolean;
}

/**
 * Fetch a file as a blob rather than navigating to it.
 *
 * A plain link to the export would take a failed request and render the JSON
 * error where the report used to be. Fetching means an error stays an error
 * the page can display, and the download only starts once the bytes arrived.
 */
async function requestFile(path: string, timeoutMs = 60_000): Promise<CsvExport> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    const aborted = error instanceof DOMException && error.name === "AbortError";
    throw new ApiError(
      aborted
        ? `The download from ${path} timed out. Nothing has changed and you can retry.`
        : `Could not reach the backend at ${API_BASE_URL}. Is it running?`,
      0,
      "network"
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    // The backend sends JSON for every error, including on a file route.
    const text = await response.text();
    let record: { detail?: string; kind?: ErrorKind } = {};
    try {
      record = JSON.parse(text);
    } catch {
      record = { detail: text };
    }
    throw new ApiError(
      record.detail ?? `Request failed with status ${response.status}`,
      response.status,
      record.kind ?? "unknown"
    );
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const rowCount = response.headers.get("X-MoveProof-Row-Count");

  return {
    blob: await response.blob(),
    filename: match ? match[1] : "moveproof-verified.csv",
    runId: response.headers.get("X-MoveProof-Run-Id"),
    planVersion: response.headers.get("X-MoveProof-Plan-Version"),
    rowCount: rowCount === null ? null : Number(rowCount),
    committed: response.headers.get("X-MoveProof-Committed") === "true",
  };
}

export const api = {
  health: () => request<ApiHealth>("/health"),

  destinationSchema: () => request<ApiDestinationSchema>("/api/schema/destination"),

  listMigrations: () =>
    request<{ migrations: ApiMigrationSummary[] }>("/api/migrations"),

  searchMigrations: (term: string) =>
    request<{ results: { id: string; filename: string; state: string }[] }>(
      `/api/migrations/search?q=${encodeURIComponent(term)}`
    ),

  getMigration: (id: string) =>
    request<{
      id: string;
      filename: string;
      checksum: string;
      row_count: number;
      columns: string[];
      state: string;
      created_at: string;
      plans: {
        version: number;
        proposed_by: string;
        approved_by: string | null;
        approved_at: string | null;
        acknowledgements: string[];
        conflict_policy: string;
      }[];
      latest_run_id: string | null;
    }>(`/api/migrations/${id}`),

  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    // Upload gets a longer window than a normal call, because a 25 MB file on
    // a slow connection is not an error.
    return request<ApiUploadResult>("/api/migrations", {
      method: "POST",
      body: form,
      timeoutMs: 120_000,
    });
  },

  preview: (id: string, limit = 50) =>
    request<ApiPreview>(`/api/migrations/${id}/preview?limit=${limit}`),

  events: (id: string) =>
    request<{ events: ApiEvent[] }>(`/api/migrations/${id}/events`),

  deleteMigration: (id: string) =>
    request<void>(`/api/migrations/${id}`, { method: "DELETE" }),

  proposePlan: (id: string, profile: "safe" | "legacy" | "model" = "safe") =>
    request<ApiPlanProposal>(
      `/api/migrations/${id}/plan/propose?profile=${profile}`,
      { method: "POST", timeoutMs: 90_000 }
    ),

  approvePlan: (
    id: string,
    body: {
      profile: "safe" | "legacy";
      acknowledgements: string[];
      date_format_policy?: string | null;
      required_field_policy?: string | null;
      conflict_policy?: string | null;
    }
  ) =>
    request<ApiApprovalResult>(`/api/migrations/${id}/plan/approve`, {
      method: "POST",
      body,
    }),

  run: (id: string, idempotencyKey?: string) =>
    request<ApiRunResult>(`/api/migrations/${id}/run`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
      timeoutMs: 120_000,
    }),

  verify: (id: string, runId: string) =>
    request<ApiVerification>(`/api/migrations/${id}/runs/${runId}/verify`, {
      method: "POST",
      timeoutMs: 120_000,
    }),

  verification: (id: string, runId: string) =>
    request<{
      run_id: string;
      checks: ApiVerification["checks"];
      summary: ApiVerification["summary"];
    }>(`/api/migrations/${id}/runs/${runId}/verification`),

  proposeRepair: (id: string, runId: string) =>
    request<ApiRepairProposal>(
      `/api/migrations/${id}/runs/${runId}/repair/propose`,
      { method: "POST", timeoutMs: 90_000 }
    ),

  commit: (id: string, runId: string, conflictPolicy?: string) =>
    request<ApiCommitResult>(`/api/migrations/${id}/runs/${runId}/commit`, {
      method: "POST",
      body: conflictPolicy ? { conflict_policy: conflictPolicy } : {},
    }),

  rollback: (id: string) =>
    request<{ migration_id: string; rows_removed: number }>(
      `/api/migrations/${id}/rollback`,
      { method: "POST" }
    ),

  /**
   * The verified transformed dataset. Distinct from the evidence exports:
   * this is the data, those describe what happened to it.
   */
  exportVerifiedCsv: (id: string) =>
    requestFile(`/api/migrations/${id}/export/csv`),

  evidenceQuestions: () =>
    request<{ questions: ApiEvidenceQuestion[]; provider: string }>(
      "/api/evidence/questions"
    ),

  /**
   * Fetch advisory external context for one ambiguous field.
   *
   * A longer window than a normal call, because it waits on a third party.
   * Failure here never affects the migration: the caller shows the error and
   * the review continues.
   */
  externalEvidence: (id: string, body: ApiEvidenceRequest) =>
    request<ApiExternalEvidence>(`/api/migrations/${id}/external-evidence`, {
      method: "POST",
      body,
      timeoutMs: 45_000,
    }),

  evidence: (id: string, runId?: string) =>
    request<ApiEvidence>(
      `/api/migrations/${id}/evidence${runId ? `?run_id=${runId}` : ""}`
    ),
};
