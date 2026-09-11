"use client";

import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";

/**
 * A small confirmation dialog for destructive navigation.
 *
 * It offers only the choices that actually exist. Draft saving is not
 * implemented, so it is not offered: an option that quietly does nothing is
 * worse than no option at all.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy/25 p-4 sm:items-center"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="w-full max-w-md rounded-card border border-line bg-surface p-6 shadow-lift"
        onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        <p id="confirm-body" className="mt-2 text-sm leading-relaxed text-ink-soft">
          {body}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button
            onClick={onCancel}
            className="rounded-control border border-line bg-surface px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="rounded-control bg-bad px-4 py-2.5 text-sm font-semibold text-surface transition-colors hover:bg-bad/90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
