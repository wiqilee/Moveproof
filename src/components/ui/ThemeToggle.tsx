"use client";

import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import type { ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * A three way theme control.
 *
 * System is a real option rather than a starting guess: choosing it means the
 * interface keeps following the operating system when that changes.
 */
export function ThemeToggle({ variant = "compact" }: { variant?: "compact" | "full" }) {
  const { preference, resolved, setPreference } = useTheme();
  const [open, setOpen] = useState(false);

  if (variant === "full") {
    return (
      <div
        role="radiogroup"
        aria-label="Theme"
        className="inline-flex rounded-control border border-line bg-surface p-0.5"
      >
        {OPTIONS.map((option) => {
          const selected = preference === option.value;
          return (
            <button
              key={option.value}
              role="radio"
              aria-checked={selected}
              onClick={() => setPreference(option.value)}
              className={[
                "inline-flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[13px] font-medium",
                "transition-[color,background-color,border-color] duration-200",
                selected
                  ? "border-brand/30 bg-brand-soft text-ink"
                  : "border-transparent text-ink-soft hover:border-brand/40 hover:bg-brand-soft/50 hover:text-ink",
              ].join(" ")}
            >
              <option.icon size={14} aria-hidden />
              {option.label}
            </button>
          );
        })}
      </div>
    );
  }

  const Current = resolved === "dark" ? Moon : Sun;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((current) => !current)}
        aria-label={`Theme, currently ${preference}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded-control border border-line bg-surface p-2 text-ink-soft transition-colors hover:bg-muted hover:text-ink"
      >
        <Current size={15} aria-hidden />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            role="presentation"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            aria-label="Theme"
            className="absolute right-0 z-50 mt-1.5 w-40 overflow-hidden rounded-card border border-line bg-surface py-1 shadow-lift"
          >
            {OPTIONS.map((option) => (
              <button
                key={option.value}
                role="menuitemradio"
                aria-checked={preference === option.value}
                onClick={() => {
                  setPreference(option.value);
                  setOpen(false);
                }}
                className={[
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors",
                  preference === option.value
                    ? "bg-brand-soft font-medium text-brand"
                    : "text-ink-soft hover:bg-muted hover:text-ink",
                ].join(" ")}
              >
                <option.icon size={14} aria-hidden />
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
