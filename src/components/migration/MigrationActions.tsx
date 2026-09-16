"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api, describeError } from "@/data/api";
import type { ErrorState } from "@/lib/migration-store";

/**
 * Deleting a migration, and rolling one back first when it has committed.
 *
 * Deliberately the only destructive control in the product, and deliberately
 * behind a menu. A red button sitting beside Commit would compete with the
 * action an operator actually came to perform.
 *
 * The two cases are named differently because they do different things. An
 * uncommitted migration exists only inside MoveProof. A committed one has
 * written rows into a table other systems read, and removing those is a
 * separate event that the operator has to be told about before agreeing.
 */

export interface DeletableMigration {
  id: string;
  filename: string;
  committed: boolean;
}

export function MigrationActions({
  migration,
  onDone,
  onError,
}: {
  migration: DeletableMigration;
  /** Called after the record is gone, so the caller can refresh or navigate. */
  onDone: (summary: { rowsRemoved: number | null }) => void;
  onError: (error: ErrorState) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const committed = migration.committed;

  const run = async () => {
    setBusy(true);
    let rowsRemoved: number | null = null;
    try {
      // Rollback first, and only continue if it succeeded. Deleting the
      // migration record while its rows are still in the destination would
      // orphan them: nothing left would know where they came from or that
      // they were ever meant to be removed.
      if (committed) {
        const rolled = await api.rollback(migration.id);
        rowsRemoved = rolled.rows_removed;
      }
      await api.deleteMigration(migration.id);
      setConfirming(false);
      setMenuOpen(false);
      onDone({ rowsRemoved });
    } catch (error) {
      // The dialog stays open with the failure shown by the caller, so the
      // operator can see what went wrong rather than watching the row vanish.
      onError(describeError(error));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-label={`Actions for ${migration.filename}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="rounded-md p-1.5 text-ink-soft transition-colors hover:bg-muted hover:text-ink"
      >
        {busy ? (
          <Loader2 size={16} className="spin" aria-hidden />
        ) : (
          <MoreHorizontal size={16} aria-hidden />
        )}
      </button>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            role="presentation"
            onClick={() => setMenuOpen(false)}
          />
          <div
            role="menu"
            aria-label="Migration actions"
            className="absolute right-0 z-50 mt-1.5 w-56 overflow-hidden rounded-card border border-line bg-surface py-1 shadow-lift"
          >
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setConfirming(true);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-bad transition-colors hover:bg-bad-soft"
            >
              {committed ? <RotateCcw size={14} aria-hidden /> : <Trash2 size={14} aria-hidden />}
              {committed ? "Rollback and delete" : "Delete migration"}
            </button>
            {committed && (
              <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-soft">
                This migration has written rows to the destination.
              </p>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirming}
        busy={busy}
        title={committed ? "Rollback and delete migration?" : "Delete migration?"}
        body={
          committed
            ? "This migration has already written rows to the destination. Continuing will remove this migration's committed rows from the destination and then delete the migration record and its derived data."
            : "This will permanently remove this migration and everything derived from it, including the stored original file, its plan versions, staged rows and evidence."
        }
        confirmLabel={committed ? "Rollback and delete" : "Delete migration"}
        cancelLabel="Cancel"
        onConfirm={() => void run()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
