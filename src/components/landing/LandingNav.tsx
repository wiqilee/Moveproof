import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { GitHubIcon } from "./SocialIcons";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { LINKS } from "@/lib/site";
import { routes } from "@/lib/routes";

const sections = [
  { label: "Problem", href: "#problem" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Approach", href: "#approach" },
  { label: "Technology", href: "#technology" },
];

export function LandingNav() {
  return (
    // Translucent and taller, with the hairline only at the very bottom, so
    // the bar reads as the page's own edge rather than a separate strip.
    // A floating inset bar rather than a full-width strip: it sits on the
    // page instead of capping it, which is what makes the canvas read as
    // continuous behind it.
    <header className="sticky top-0 z-30 px-3 pt-3 sm:px-5 sm:pt-4">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between rounded-card border border-line bg-surface/80 px-3 backdrop-blur-xl sm:px-4" style={{ boxShadow: "var(--elev-2)" }}>
        <Logo href={routes.home} />

        <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
          {sections.map((section) => (
            <a
              key={section.href}
              href={section.href}
              className="rounded-control px-3 py-2 text-[13px] text-ink-soft transition-colors hover:bg-muted hover:text-ink"
            >
              {section.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {LINKS.github.verified && (
            <a
              href={LINKS.github.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View the source on GitHub"
              className="rounded-md p-2 text-ink-soft transition-colors hover:bg-muted hover:text-ink"
            >
              <GitHubIcon />
            </a>
          )}
          <Link
            href={routes.workspace}
            className="rounded-control bg-navy text-on-navy px-3.5 py-2 text-[13px] font-semibold shadow-sm transition-colors hover:bg-navy/90 active:translate-y-px"
          >
            Open workspace
          </Link>
        </div>
      </div>
    </header>
  );
}
