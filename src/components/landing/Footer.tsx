import { Logo } from "@/components/ui/Logo";
import { GitHubIcon, MediumIcon, XIcon, YouTubeIcon } from "./SocialIcons";
import { AUTHOR, HACKATHON, LINKS } from "@/lib/site";
import type { ExternalLink } from "@/lib/site";
import { routes } from "@/lib/routes";

/**
 * A link that only becomes a link once its destination exists. Until then it
 * renders as muted text marked pending, so nothing in the footer leads a
 * visitor to a page that is not there.
 */
function MaybeLink({ link }: { link: ExternalLink }) {
  if (!link.verified) {
    return (
      <span className="inline-flex items-center gap-1.5 text-ink-soft/70">
        {link.label}
        <span className="rounded border border-line px-1 py-px text-[9px] font-semibold uppercase tracking-wider">
          Pending
        </span>
      </span>
    );
  }
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-ink-soft transition-colors hover:text-ink"
    >
      {link.label}
    </a>
  );
}

const socialIcons = [
  { link: LINKS.x, Icon: XIcon, label: "Wiqi Lee on X" },
  { link: LINKS.medium, Icon: MediumIcon, label: "Wiqi Lee on Medium" },
  { link: LINKS.youtubeDemo, Icon: YouTubeIcon, label: "Demo video on YouTube" },
  { link: LINKS.github, Icon: GitHubIcon, label: "Source code on GitHub" },
];

export function Footer() {
  return (
    <footer className="bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <Logo href={routes.home} />
            <p className="mt-3.5 max-w-xs text-sm leading-relaxed text-ink-soft">
              An AI assisted data migration workspace that verifies its own work and shows you the
              evidence.
            </p>
            <div className="mt-5 flex items-center gap-1">
              {socialIcons.map(({ link, Icon, label }) =>
                link.verified ? (
                  <a
                    key={label}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className="rounded-md p-2 text-ink-soft transition-colors hover:bg-muted hover:text-ink"
                  >
                    <Icon size={16} />
                  </a>
                ) : (
                  <span
                    key={label}
                    aria-label={`${label}, not published yet`}
                    className="p-2 text-line"
                  >
                    <Icon size={16} />
                  </span>
                )
              )}
            </div>
          </div>

          <div>
            <h3 className="text-[13px] font-semibold">Product</h3>
            <ul className="mt-3.5 space-y-2.5 text-sm">
              <li>
                <a href="#problem" className="text-ink-soft transition-colors hover:text-ink">
                  The problem
                </a>
              </li>
              <li>
                <a href="#how-it-works" className="text-ink-soft transition-colors hover:text-ink">
                  How it works
                </a>
              </li>
              <li>
                <a href="#technology" className="text-ink-soft transition-colors hover:text-ink">
                  Technology
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-[13px] font-semibold">Project</h3>
            <ul className="mt-3.5 space-y-2.5 text-sm">
              <li>
                <MaybeLink link={LINKS.github} />
              </li>
              <li>
                <MaybeLink link={LINKS.liveApp} />
              </li>
              <li>
                <MaybeLink link={LINKS.youtubeDemo} />
              </li>
              <li>
                <MaybeLink link={LINKS.devpostProject} />
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-[13px] font-semibold">Creator</h3>
            <p className="mt-3.5 text-sm text-ink-soft">{AUTHOR.name}</p>
            <p className="mt-1 text-xs text-ink-soft">{AUTHOR.role}</p>
            <ul className="mt-3 space-y-2.5 text-sm">
              <li>
                <MaybeLink link={LINKS.x} />
              </li>
              <li>
                <MaybeLink link={LINKS.medium} />
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-xs text-ink-soft sm:flex-row sm:items-center sm:justify-between">
          <p>MIT licensed. Copyright 2026 {AUTHOR.name}.</p>
          <p>
            Built for the{" "}
            <a
              href={LINKS.hackathon.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 transition-colors hover:text-ink"
            >
              {HACKATHON.name}
            </a>
            , {HACKATHON.track} track.
          </p>
        </div>
      </div>
    </footer>
  );
}
