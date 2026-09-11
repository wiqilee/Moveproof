import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import type { Crumb } from "@/lib/routes";

/**
 * Back navigation with an explicit destination.
 *
 * This deliberately does not call router.back(). Someone who opened a deep
 * link directly, or arrived from an external page, would be sent somewhere
 * unrelated. An explicit href always lands inside the product.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft transition-colors hover:text-ink"
    >
      <ArrowLeft
        size={15}
        className="transition-transform duration-150 group-hover:-translate-x-0.5"
        aria-hidden
      />
      {label}
    </Link>
  );
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={crumb.label} className="flex items-center gap-1.5">
              {index > 0 && <ChevronRight size={11} className="text-line" aria-hidden />}
              {crumb.href && !last ? (
                <Link
                  href={crumb.href}
                  className="rounded text-ink-soft transition-colors hover:text-ink"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={last ? "font-medium text-ink" : "text-ink-soft"}
                  aria-current={last ? "page" : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
