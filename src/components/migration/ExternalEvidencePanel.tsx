"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { api, describeError } from "@/data/api";
import type {
  ApiEvidenceQuestion,
  ApiEvidenceRequest,
  ApiExternalEvidence,
} from "@/lib/api-types";
import type { ErrorState } from "@/lib/migration-store";

/**
 * External evidence for one ambiguous field.
 *
 * This panel is advisory and says so in every state. It shows what was asked,
 * what left the system, and what came back, and it stops there. There is no
 * control here that applies a result, because a one-click path from a search
 * snippet to an executable transformation would put an external provider
 * inside the migration contract.
 *
 * The visual language is deliberately neutral. No green, no tick, no passed
 * styling: those belong to the verifier, and borrowing them would suggest
 * something has been confirmed when nothing has.
 */
export function ExternalEvidencePanel({
  migrationId,
  context,
  available,
  defaultQuestion,
}: {
  migrationId: string;
  context: Omit<ApiEvidenceRequest, "question">;
  /** Reported by /health. Absent credentials disable the action with a reason. */
  available: boolean;
  defaultQuestion?: string;
}) {
  const [questions, setQuestions] = useState<ApiEvidenceQuestion[]>([]);
  const [selected, setSelected] = useState(defaultQuestion ?? "");
  const [evidence, setEvidence] = useState<ApiExternalEvidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);

  useEffect(() => {
    if (!available) return;
    let active = true;
    api
      .evidenceQuestions()
      .then((result) => {
        if (!active) return;
        setQuestions(result.questions);
        setSelected((current) => current || result.questions[0]?.id || "");
      })
      .catch(() => {
        if (active) setQuestions([]);
      });
    return () => {
      active = false;
    };
  }, [available]);

  const run = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      setEvidence(
        await api.externalEvidence(migrationId, { ...context, question: selected })
      );
    } catch (caught) {
      // The review is untouched by a provider failure, so the panel reports it
      // and leaves everything else alone.
      setError(describeError(caught));
      setEvidence(null);
    } finally {
      setBusy(false);
    }
  };

  const chosen = questions.find((question) => question.id === selected);

  return (
    <section
      aria-label="External evidence"
      className="rounded-card border border-line bg-canvas/40"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold">
            External evidence
            <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
              Advisory
            </span>
          </h3>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-soft">
            The dataset shows what this field contains. It cannot say what the
            source system intended. Published documentation sometimes can.
          </p>
        </div>
      </header>

      <div className="px-5 py-4">
        {!available ? (
          <p className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-soft">
            <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
            External evidence is unavailable because no provider credential is
            configured on the backend. Every other part of this review works
            normally.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-0 flex-1">
                <span className="mb-1.5 block text-xs font-semibold text-ink-soft">
                  Question to investigate
                </span>
                <select
                  value={selected}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    setSelected(event.target.value)
                  }
                  className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm outline-none"
                >
                  {questions.map((question) => (
                    <option key={question.id} value={question.id}>
                      {question.label}
                    </option>
                  ))}
                </select>
              </label>

              <Button
                icon={busy ? RefreshCw : Search}
                onClick={() => void run()}
                className="transition-colors duration-200 hover:bg-brand hover:text-on-brand"
                disabled={busy || !selected}
              >
                {busy ? "Checking" : "Check external evidence"}
              </Button>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-ink-soft">
              Only the column name, its declared types and the chosen question
              are sent. No row values, names, email addresses or uploaded data
              leave this system.
            </p>

            {busy && (
              <p
                className="mt-4 flex items-center gap-2 text-sm text-ink-soft"
                role="status"
              >
                <Loader2 size={15} className="spin" aria-hidden />
                Searching published documentation for {context.source_column}
              </p>
            )}

            {error && (
              <div className="mt-4 rounded-card border border-warn/30 bg-warn-soft p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-warn">
                  <AlertTriangle size={15} aria-hidden />
                  {error.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                  {error.detail}
                </p>
                {error.retryable && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    icon={RefreshCw}
                    onClick={() => void run()}
                  >
                    Try again
                  </Button>
                )}
              </div>
            )}

            {evidence && !busy && (
              <div className="mt-5">
                <dl className="mb-4 space-y-1.5 border-b border-line pb-4 text-xs">
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-ink-soft">Question</dt>
                    <dd>{chosen?.label ?? evidence.question}</dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-ink-soft">Query sent</dt>
                    <dd className="min-w-0 break-words font-mono text-[11px]">
                      {evidence.sanitized_query}
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-ink-soft">Checked</dt>
                    <dd className="font-mono text-[11px]">
                      {evidence.checked_at} · {evidence.provider}
                    </dd>
                  </div>
                </dl>

                {evidence.status === "no_results" ? (
                  <p className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-soft">
                    <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
                    No published documentation was found for this question. That
                    is not evidence that the mapping is correct, only that this
                    search did not find anything.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {evidence.sources.map((source) => (
                      <li
                        key={source.url}
                        className="rounded-card border border-line bg-surface p-4"
                      >
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="group inline-flex items-start gap-1.5 text-sm font-medium hover:underline"
                        >
                          {source.title}
                          <ExternalLink
                            size={13}
                            className="mt-0.5 shrink-0 text-ink-soft"
                            aria-hidden
                          />
                        </a>
                        <p className="mt-1 font-mono text-[11px] text-ink-soft">
                          {source.domain}
                          {source.published_at ? ` · ${source.published_at}` : ""}
                        </p>
                        {source.excerpt && (
                          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
                            {source.excerpt}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <p className="mt-4 flex items-start gap-2.5 border-t border-line pt-4 text-xs leading-relaxed text-ink-soft">
                  <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                  {evidence.advisory_notice}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
