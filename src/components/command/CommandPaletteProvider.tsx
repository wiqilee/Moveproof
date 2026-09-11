"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CommandPalette } from "./CommandPalette";

/**
 * The command palette, mounted once for the whole application.
 *
 * Two things were wrong with the earlier arrangement and both are fixed here.
 *
 * **It only existed in the workspace.** The palette lived inside the workspace
 * top bar, so the keyboard listener was never installed on the public site and
 * `⌘ K` did nothing there. The provider now sits in the root layout, so one
 * listener and one implementation serve every route.
 *
 * **It was trapped inside its own parent.** The top bar carries
 * `backdrop-blur`, and an element with a backdrop filter becomes the
 * containing block for `position: fixed` descendants. The overlay was
 * therefore confined to the height of the top bar instead of covering the
 * viewport. Rendering through a portal attached to `document.body` puts it
 * outside every transformed, filtered or clipped ancestor, which no z-index
 * could have achieved on its own.
 */

interface PaletteStore {
  open: boolean;
  setOpen: (next: boolean) => void;
  toggle: () => void;
}

const PaletteContext = createContext<PaletteStore | null>(null);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [mounted, setMounted] = useState(false);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const setOpen = useCallback((next: boolean) => {
    if (next) {
      restoreFocusTo.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setOpenState(next);
  }, []);

  const toggle = useCallback(() => {
    setOpenState((current) => {
      if (!current) {
        restoreFocusTo.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      return !current;
    });
  }, []);

  const close = useCallback(() => {
    setOpenState(false);
    // Focus goes back where it came from, so a keyboard user is not dropped at
    // the top of the document.
    window.setTimeout(() => restoreFocusTo.current?.focus(), 0);
  }, []);

  // One listener, installed at the root, for every route.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if ((event.metaKey || event.ctrlKey) && key === "k") {
        // Chrome and Firefox both bind this to the address bar, so the default
        // has to be prevented for the palette to open at all.
        event.preventDefault();
        event.stopPropagation();
        toggle();
        return;
      }

      if (key === "escape") {
        setOpenState((current) => {
          if (current) {
            event.preventDefault();
            window.setTimeout(() => restoreFocusTo.current?.focus(), 0);
            return false;
          }
          return current;
        });
        return;
      }

      // A bare slash is a convenience, and must never steal a keystroke from
      // someone filling in a field.
      if (key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        restoreFocusTo.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setOpenState(true);
      }
    };

    // Capture phase, so the shortcut works even when focus sits inside a
    // component that stops propagation.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [toggle]);

  // The page behind a modal must not scroll.
  useEffect(() => {
    if (open) {
      document.body.dataset.scrollLocked = "true";
    } else {
      delete document.body.dataset.scrollLocked;
    }
    return () => {
      delete document.body.dataset.scrollLocked;
    };
  }, [open]);

  const value = useMemo(() => ({ open, setOpen, toggle }), [open, setOpen, toggle]);

  return (
    <PaletteContext.Provider value={value}>
      {children}
      {mounted && open
        ? createPortal(<CommandPalette onClose={close} />, document.body)
        : null}
    </PaletteContext.Provider>
  );
}

export function useCommandPalette(): PaletteStore {
  const context = useContext<PaletteStore | null>(PaletteContext);
  if (!context) {
    throw new Error("useCommandPalette must be used inside a CommandPaletteProvider");
  }
  return context;
}
