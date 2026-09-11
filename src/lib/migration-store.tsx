"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { api, describeError } from "@/data/api";
import type {
  ApiCheck,
  ApiEvidence,
  ApiHealth,
  ApiMigrationSummary,
  ApiPlanProposal,
  ApiRepairProposal,
  ApiRunResult,
  ApiVerification,
} from "@/lib/api-types";

/**
 * The migration workspace store.
 *
 * Every number this holds comes from the backend. There is no derived
 * verification result computed in the browser any more: the frontend asks the
 * API what happened and renders the answer.
 *
 * `runPhase` still exists, because a computable check is not an executed one.
 * The interface must not show a verification result before a verification has
 * run, and that distinction is now backed by whether the API has returned one.
 */

export type RunPhase = "not_started" | "running" | "complete";

export interface ErrorState {
  title: string;
  detail: string;
  retryable: boolean;
}

interface MigrationStore {
  // Connection
  health: ApiHealth | null;
  backendReachable: boolean | null;

  // Workspace
  migrations: ApiMigrationSummary[];
  migrationsLoading: boolean;

  // The migration currently being worked on
  migrationId: string | null;
  filename: string | null;
  runId: string | null;
  planVersion: number | null;
  proposal: ApiPlanProposal | null;
  runResult: ApiRunResult | null;
  verification: ApiVerification | null;
  repairProposal: ApiRepairProposal | null;
  evidence: ApiEvidence | null;

  // Derived
  runPhase: RunPhase;
  hasResults: boolean;
  checks: ApiCheck[];
  summary: ApiVerification["summary"] | null;
  state: string;
  commitAllowed: boolean;
  committed: boolean;

  // Status
  busy: string | null;
  error: ErrorState | null;
  clearError: () => void;

  // Actions
  refreshHealth: () => Promise<void>;
  refreshMigrations: () => Promise<void>;
  uploadFile: (file: File) => Promise<string | null>;
  selectMigration: (id: string) => Promise<void>;
  proposePlan: (profile: "safe" | "legacy" | "model") => Promise<void>;
  approvePlan: (input: {
    profile: "safe" | "legacy";
    acknowledgements: string[];
    dateFormatPolicy?: string | null;
    requiredFieldPolicy?: string | null;
    conflictPolicy?: string | null;
  }) => Promise<boolean>;
  startRun: () => Promise<string | null>;
  runVerification: (runId?: string) => Promise<void>;
  loadRepairProposal: () => Promise<void>;
  loadEvidence: () => Promise<void>;
  commit: (conflictPolicy?: string) => Promise<boolean>;
  reset: () => void;
}

const MigrationContext = createContext<MigrationStore | null>(null);

export function MigrationProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);

  const [migrations, setMigrations] = useState<ApiMigrationSummary[]>([]);
  const [migrationsLoading, setMigrationsLoading] = useState(false);

  const [migrationId, setMigrationId] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [planVersion, setPlanVersion] = useState<number | null>(null);
  const [proposal, setProposal] = useState<ApiPlanProposal | null>(null);
  const [runResult, setRunResult] = useState<ApiRunResult | null>(null);
  const [verification, setVerification] = useState<ApiVerification | null>(null);
  const [repairProposal, setRepairProposal] = useState<ApiRepairProposal | null>(null);
  const [evidence, setEvidence] = useState<ApiEvidence | null>(null);

  const [runPhase, setRunPhase] = useState<RunPhase>("not_started");
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);

  const clearError = useCallback(() => setError(null), []);

  /** Runs an action with a busy label, turning any failure into an ErrorState. */
  const guard = useCallback(
    async <T,>(label: string, action: () => Promise<T>): Promise<T | null> => {
      setBusy(label);
      setError(null);
      try {
        return await action();
      } catch (caught) {
        setError(describeError(caught));
        return null;
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const refreshHealth = useCallback(async () => {
    try {
      const result = await api.health();
      setHealth(result);
      setBackendReachable(true);
    } catch {
      setHealth(null);
      setBackendReachable(false);
    }
  }, []);

  const refreshMigrations = useCallback(async () => {
    setMigrationsLoading(true);
    try {
      const result = await api.listMigrations();
      setMigrations(result.migrations);
      setBackendReachable(true);
    } catch (caught) {
      setError(describeError(caught));
      setBackendReachable(false);
    } finally {
      setMigrationsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const reset = useCallback(() => {
    setMigrationId(null);
    setFilename(null);
    setRunId(null);
    setPlanVersion(null);
    setProposal(null);
    setRunResult(null);
    setVerification(null);
    setRepairProposal(null);
    setEvidence(null);
    setRunPhase("not_started");
    setCommitted(false);
    setError(null);
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      const result = await guard("Uploading and parsing", () => api.upload(file));
      if (!result) return null;
      reset();
      setMigrationId(result.migration_id);
      setFilename(result.filename);
      return result.migration_id;
    },
    [guard, reset]
  );

  const selectMigration = useCallback(
    async (id: string) => {
      await guard("Loading migration", async () => {
        const migration = await api.getMigration(id);
        setMigrationId(migration.id);
        setFilename(migration.filename);
        const approved = migration.plans.filter((p) => p.approved_at !== null);
        setPlanVersion(approved.length ? approved[approved.length - 1].version : null);
        setCommitted(migration.state === "committed");

        if (migration.latest_run_id) {
          setRunId(migration.latest_run_id);
          try {
            const stored = await api.verification(id, migration.latest_run_id);
            setVerification({
              migration_id: id,
              run_id: migration.latest_run_id,
              state: migration.state,
              summary: stored.summary,
              checks: stored.checks,
            });
            setRunPhase("complete");
          } catch {
            // A run without a stored verification is not an error. It simply
            // means the checks have not been executed yet.
            setVerification(null);
            setRunPhase("not_started");
          }
        }
        return null;
      });
    },
    [guard]
  );

  const proposePlan = useCallback(
    async (profile: "safe" | "legacy" | "model") => {
      if (!migrationId) return;
      const result = await guard(
        profile === "model" ? "Asking the model for a mapping" : "Building the plan",
        () => api.proposePlan(migrationId, profile)
      );
      if (result) setProposal(result);
    },
    [guard, migrationId]
  );

  const approvePlan = useCallback(
    async (input: {
      profile: "safe" | "legacy";
      acknowledgements: string[];
      dateFormatPolicy?: string | null;
      requiredFieldPolicy?: string | null;
      conflictPolicy?: string | null;
    }) => {
      if (!migrationId) return false;
      const result = await guard("Approving the plan", () =>
        api.approvePlan(migrationId, {
          profile: input.profile,
          acknowledgements: input.acknowledgements,
          date_format_policy: input.dateFormatPolicy ?? null,
          required_field_policy: input.requiredFieldPolicy ?? null,
          conflict_policy: input.conflictPolicy ?? null,
        })
      );
      if (!result) return false;
      setPlanVersion(result.plan_version);
      // A new approved plan invalidates any earlier result.
      setVerification(null);
      setRunResult(null);
      setRepairProposal(null);
      setEvidence(null);
      setRunPhase("not_started");
      return true;
    },
    [guard, migrationId]
  );

  const startRun = useCallback(async () => {
    if (!migrationId) return null;
    setRunPhase("running");
    const result = await guard("Staging the approved plan", () => api.run(migrationId));
    if (!result) {
      setRunPhase("not_started");
      return null;
    }
    setRunResult(result);
    setRunId(result.run_id);
    return result.run_id;
  }, [guard, migrationId]);

  const runVerification = useCallback(
    async (explicitRunId?: string) => {
      const target = explicitRunId ?? runId;
      if (!migrationId || !target) return;
      const result = await guard("Running the verifier", () =>
        api.verify(migrationId, target)
      );
      if (result) {
        setVerification(result);
        setRunPhase("complete");
      } else {
        setRunPhase("not_started");
      }
    },
    [guard, migrationId, runId]
  );

  const loadRepairProposal = useCallback(async () => {
    if (!migrationId || !runId) return;
    const result = await guard("Diagnosing the failure", () =>
      api.proposeRepair(migrationId, runId)
    );
    if (result) setRepairProposal(result);
  }, [guard, migrationId, runId]);

  const loadEvidence = useCallback(async () => {
    if (!migrationId) return;
    const result = await guard("Assembling the evidence record", () =>
      api.evidence(migrationId, runId ?? undefined)
    );
    if (result) {
      setEvidence(result);
      setCommitted(result.commit !== null);
    }
  }, [guard, migrationId, runId]);

  const commit = useCallback(
    async (conflictPolicy?: string) => {
      if (!migrationId || !runId) return false;
      const result = await guard("Committing", () =>
        api.commit(migrationId, runId, conflictPolicy)
      );
      if (!result) return false;
      setCommitted(true);
      await loadEvidence();
      return true;
    },
    [guard, loadEvidence, migrationId, runId]
  );

  const checks = verification?.checks ?? [];
  const summary = verification?.summary ?? null;
  const hasResults = runPhase === "complete" && verification !== null;

  const state = useMemo(() => {
    if (committed) return "committed";
    if (!planVersion) return "draft";
    if (runPhase === "running") return "staging";
    if (!hasResults) return "plan_approved";
    return verification?.state ?? "plan_approved";
  }, [committed, planVersion, runPhase, hasResults, verification]);

  const commitAllowed = useMemo(
    () =>
      hasResults &&
      !committed &&
      summary !== null &&
      summary.failed === 0 &&
      summary.review === 0,
    [hasResults, committed, summary]
  );

  const value: MigrationStore = {
    health,
    backendReachable,
    migrations,
    migrationsLoading,
    migrationId,
    filename,
    runId,
    planVersion,
    proposal,
    runResult,
    verification,
    repairProposal,
    evidence,
    runPhase,
    hasResults,
    checks,
    summary,
    state,
    commitAllowed,
    committed,
    busy,
    error,
    clearError,
    refreshHealth,
    refreshMigrations,
    uploadFile,
    selectMigration,
    proposePlan,
    approvePlan,
    startRun,
    runVerification,
    loadRepairProposal,
    loadEvidence,
    commit,
    reset,
  };

  return <MigrationContext.Provider value={value}>{children}</MigrationContext.Provider>;
}

/**
 * The store when it exists, or null.
 *
 * The command palette is mounted globally, including on the public site where
 * there is no workspace provider. It offers migration commands when a
 * workspace is present and plain navigation when it is not, rather than
 * throwing.
 */
export function useMigrationOptional(): MigrationStore | null {
  return useContext<MigrationStore | null>(MigrationContext);
}

export function useMigration(): MigrationStore {
  const context = useContext<MigrationStore | null>(MigrationContext);
  if (!context) {
    throw new Error("useMigration must be used inside a MigrationProvider");
  }
  return context;
}
