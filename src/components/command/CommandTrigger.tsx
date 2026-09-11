"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useCommandPalette } from "./CommandPaletteProvider";

/**
 * The visible way in.
 *
 * A keyboard shortcut alone leaves the palette invisible to anyone on a
 * phone, so there is a real button. It opens the same single palette the
 * shortcut does, through the provider, rather than a second copy.
 */
export function CommandTrigger() {
  const { setOpen } = useCommandPalette();
  const [modifier, setModifier] = useState("Ctrl");

  useEffect(() => {
    const platform =
      (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform ??
      "";
    setModifier(/Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘" : "Ctrl");
  }, []);

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open the command palette"
      aria-keyshortcuts="Meta+K Control+K"
      className="flex items-center gap-2 rounded-control border border-line bg-surface px-2.5 py-2 text-ink-soft transition-colors hover:bg-muted hover:text-ink sm:px-3"
    >
      <Search size={15} aria-hidden />
      <span className="hidden text-[13px] sm:inline">Search</span>
      <kbd className="hidden rounded border border-line px-1.5 py-0.5 font-mono text-[10px] lg:inline">
        {modifier} K
      </kbd>
    </button>
  );
}
