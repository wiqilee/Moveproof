import type { ReactNode } from "react";
import { BackLink } from "@/components/ui/Navigation";

export function PageHeading({
  title,
  description,
  action,
  back,
  eyebrow,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Explicit destination, never router.back(), so deep links stay safe. */
  back?: { href: string; label: string };
  eyebrow?: string;
}) {
  return (
    <header className="mb-7">
      {back && (
        <div className="mb-4">
          <BackLink href={back.href} label={back.label} />
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-soft">
              {eyebrow}
            </p>
          )}
          <h1 className="text-[1.6rem] font-semibold tracking-[-0.02em] sm:text-[1.9rem]">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">{description}</p>
          )}
        </div>
        {action}
      </div>
    </header>
  );
}
