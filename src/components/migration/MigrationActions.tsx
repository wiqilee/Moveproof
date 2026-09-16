"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

/** Menu geometry, in pixels. Kept here so measurement and render agree. */
const MENU_WIDTH = 224;
const MENU_MAX_HEIGHT = 160;

interface MenuPosition {
  left: number;
  /** Viewport y of the menu edge nearest the trigger. */
  top: number;
  /** True when the menu opens upwards because there is no room below. */
  flip: boolean;
}

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
  const [position, setPosition] = useState<MenuPosition | null>(null);
  // document.body is unavailable during server rendering, so the portal waits
  // for the client.
  const [mounted, setMounted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  /**
   * Measure the trigger and place the menu against it in viewport
   * coordinates.
   *
   * The menu is rendered into document.body, so it sits outside every card,
   * table and scroll container in the page. That is the whole point: an
   * ancestor with overflow:hidden clips a positioned descendant no matter
   * what its z-index is, and both list pages have one.
   *
   * Right-aligned to the trigger, flipped above it when there is not enough
   * room below, and clamped to the viewport so it can never hang off the
   * left edge on a narrow screen.
   */
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const below = window.innerHeight - rect.bottom;
    const flip = below < MENU_MAX_HEIGHT + margin && rect.top > below;

    const left = Math.max(
      margin,
      Math.min(
        rect.right - MENU_WIDTH,
        window.innerWidth - MENU_WIDTH - margin
      )
    );

    setPosition({
      left,
      top: flip ? rect.top - margin : rect.bottom + margin,
      flip,
    });
  }, []);

  useEffect(() => setMounted(true), []);

  // Measure before paint, so the menu never appears at the wrong place for a
  // frame and then jumps.
  useEffect(() => {
    if (menuOpen) place();
    else setPosition(null);
  }, [menuOpen, place]);

  // A menu anchored to a rect goes stale the moment the page moves under it.
  // Reposition on scroll and resize rather than leaving it floating beside
  // nothing. `true` captures scrolls on inner containers as well as the
  // window.
  useEffect(() => {
    if (!menuOpen) return;
    const reposition = () => place();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [menuOpen, place]);

  // Escape closes, and focus returns to the trigger rather than being lost at
  // the top of the document.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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

  const menu =
    menuOpen && position ? (
      <>
        {/* Outside-click. Rendered in the portal too, so it covers the whole
            viewport regardless of where the trigger sits. */}
        <div
          className="fixed inset-0 z-[90]"
          role="presentation"
          onClick={() => setMenuOpen(false)}
        />
        <div
          ref={menuRef}
          role="menu"
          aria-label="Migration actions"
          style={{
            position: "fixed",
            left: position.left,
            top: position.flip ? undefined : position.top,
            bottom: position.flip ? window.innerHeight - position.top : undefined,
            width: MENU_WIDTH,
            maxHeight: MENU_MAX_HEIGHT,
          }}
          className="z-[95] overflow-hidden rounded-card border border-line bg-surface py-1 shadow-lift"
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
    ) : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
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

      {mounted && menu ? createPortal(menu, document.body) : null}

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
