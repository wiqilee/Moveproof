import Link from "next/link";
import type { LucideIcon } from "lucide-react";

/**
 * The shared empty state.
 *
 * Empty states in this product explain why there is nothing to show, because
 * "no results yet" and "no results" mean very different things in a tool whose
 * whole argument is that an unchecked property must never look like a passing
 * one.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="rounded-card border border-dashed border-line bg-surface px-6 py-10 text-center">
      {Icon && (
        <span className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Icon size={18} className="text-ink-soft" aria-hidden />
        </span>
      )}
      <p className="text-[15px] font-semibold tracking-tight">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">{body}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-5 inline-flex rounded-control bg-navy text-on-navy px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-navy/90"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
