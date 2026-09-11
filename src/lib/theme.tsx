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

/**
 * Theme handling.
 *
 * Three settings, not two. "system" follows the operating system and keeps
 * following it, which is different from having picked whatever the system
 * happened to be at the time.
 *
 * The applied class is set on <html> before first paint by the inline script
 * in the root layout, so there is no flash of the wrong theme on load. This
 * provider only keeps React in step with what that script already did.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "moveproof.theme";

interface ThemeStore {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeStore | null>(null);

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStored(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // A browser with storage disabled still gets a working theme, just not a
    // remembered one.
  }
  return "system";
}

function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const stored = readStored();
    setPreferenceState(stored);
    const next = stored === "system" ? systemTheme() : stored;
    setResolved(next);
    applyTheme(next);
  }, []);

  // Keep following the system while the preference is "system".
  useEffect(() => {
    if (preference !== "system" || typeof window === "undefined") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next = query.matches ? "dark" : "light";
      setResolved(next);
      applyTheme(next);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Not remembering the choice is acceptable. Ignoring it would not be.
    }
    const applied = next === "system" ? systemTheme() : next;
    setResolved(applied);
    applyTheme(applied);
  }, []);

  const toggle = useCallback(() => {
    setPreference(resolved === "dark" ? "light" : "dark");
  }, [resolved, setPreference]);

  const value = useMemo(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, setPreference, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeStore {
  const context = useContext<ThemeStore | null>(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside a ThemeProvider");
  }
  return context;
}

/**
 * Runs before React hydrates, so the correct theme is painted on the first
 * frame. Kept deliberately tiny and defensive: a thrown error here would
 * block rendering entirely.
 */
export const THEME_SCRIPT = `(function(){try{
var k=${JSON.stringify(THEME_STORAGE_KEY)};
var s=localStorage.getItem(k);
var d=s==="dark"||((s==="system"||!s)&&window.matchMedia("(prefers-color-scheme: dark)").matches);
var r=document.documentElement;
r.classList.toggle("dark",d);
r.style.colorScheme=d?"dark":"light";
}catch(e){}})();`;
