"use client";

import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  FileCheck2,
  LayoutDashboard,
  ListOrdered,
  Menu,
  Plus,
  Settings,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { routes } from "@/lib/routes";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  exact: boolean;
}

const primaryItems: NavItem[] = [
  { label: "Overview", href: routes.workspace, icon: LayoutDashboard, exact: true },
  { label: "New migration", href: routes.newMigration, icon: Plus, exact: false },
  { label: "Migrations", href: routes.migrations, icon: ListOrdered, exact: false },
  { label: "Reports", href: routes.reports, icon: FileCheck2, exact: false },
];

const secondaryItems: NavItem[] = [
  { label: "Settings", href: routes.settings, icon: Settings, exact: false },
  { label: "Documentation", href: routes.docs, icon: BookOpen, exact: false },
];

function isActive(pathname: string, href: string, exact: boolean) {
  if (exact) return pathname === href;
  if (href === routes.migrations) {
    return pathname.startsWith(href) && pathname !== routes.newMigration;
  }
  return pathname.startsWith(href);
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  const renderItem = (item: NavItem) => {
    const active = isActive(pathname, item.href, item.exact);
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={[
            "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors duration-150",
            active
              ? "bg-brand-soft font-semibold text-brand"
              : "text-ink-soft hover:bg-muted hover:text-ink",
          ].join(" ")}
        >
          <item.icon size={15} aria-hidden />
          {item.label}
        </Link>
      </li>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <ul className="space-y-0.5">{primaryItems.map(renderItem)}</ul>
      <div className="my-4 h-px bg-line" aria-hidden />
      <ul className="space-y-0.5">{secondaryItems.map(renderItem)}</ul>
      <div className="mt-auto pt-6">
        <Link
          href={routes.home}
          onClick={onNavigate}
          className="group flex items-center gap-2 rounded-md px-2.5 py-2 text-xs text-ink-soft transition-colors hover:bg-muted hover:text-ink"
        >
          <ArrowLeft
            size={13}
            className="transition-transform duration-150 group-hover:-translate-x-0.5"
            aria-hidden
          />
          Back to home
        </Link>
      </div>
    </div>
  );
}

/**
 * The workspace navigation.
 *
 * One component owns both presentations: a fixed rail on large screens and a
 * drawer on small ones. Keeping the trigger and the panel together means the
 * open state never has to be threaded through the layout.
 */
export function WorkspaceNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <aside className="hidden w-[232px] shrink-0 border-r border-line bg-surface lg:flex lg:flex-col">
        <div className="px-4 py-4">
          <Logo href={routes.home} size={20} />
        </div>
        <div className="flex-1 px-3 pb-4">
          <NavList />
        </div>
      </aside>

      <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5 lg:hidden">
        <Logo href={routes.home} size={19} />
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={open}
          className="rounded-md p-2 text-ink-soft transition-colors hover:bg-muted hover:text-ink"
        >
          <Menu size={18} aria-hidden />
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-navy/25 lg:hidden"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Workspace navigation"
            className="flex h-full w-[264px] flex-col bg-surface"
            onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <Logo href={routes.home} size={20} />
              <button
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                className="rounded-md p-2 text-ink-soft transition-colors hover:bg-muted hover:text-ink"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="flex-1 px-3 py-4">
              <NavList onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
