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
    <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-6">
        <Logo href={routes.home} />

        <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
          {sections.map((section) => (
            <a
              key={section.href}
              href={section.href}
              className="rounded-md px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:bg-muted hover:text-ink"
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
