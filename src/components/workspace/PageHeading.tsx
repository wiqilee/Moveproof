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
    <header className="mb-8">
      {back && (
        <div className="mb-4">
          <BackLink href={back.href} label={back.label} />
        </div>
      )}
      {/* Actions drop below the title on a narrow screen rather than being
          squeezed beside it. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
          <h1 className="text-[1.6rem] font-semibold tracking-[-0.02em] sm:text-[1.9rem]">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {/* A hairline closes the heading, so every workspace screen starts the
          same way and the content below has a clear beginning. */}
      <div className="rule-fade mt-6" aria-hidden />
    </header>
  );
}
