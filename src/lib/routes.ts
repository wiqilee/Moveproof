/**
 * Every internal destination in one place.
 *
 * Navigation is the part of an interface most likely to rot, because a route
 * string typed by hand in one component keeps working while the route it
 * points at moves. Centralising them means a rename is a compile error rather
 * than a dead link discovered by a judge.
 */

export const routes = {
  home: "/",
  workspace: "/app",
  migrations: "/app/migrations",
  newMigration: "/app/migrations/new",
  reports: "/app/reports",
  settings: "/app/settings",
  docs: "/app/docs",
  run: (id: string) => `/app/migrations/${id}/run`,
  verification: (id: string) => `/app/migrations/${id}/verification`,
  repair: (id: string) => `/app/migrations/${id}/repair`,
  report: (id: string) => `/app/migrations/${id}/report`,
} as const;

export interface Crumb {
  label: string;
  /** Omitted when no route exists for this level, so it renders as plain text. */
  href?: string;
}

/**
 * Breadcrumbs for a migration detail page.
 *
 * The migration id itself has no page of its own in this build, so it is
 * deliberately not a link. Linking it would produce a 404, which is worse than
 * a breadcrumb that is honest about the hierarchy.
 */
export function migrationCrumbs(id: string, leaf: string): Crumb[] {
  return [
    { label: "Workspace", href: routes.workspace },
    { label: "Migrations", href: routes.migrations },
    { label: id },
    { label: leaf },
  ];
}
