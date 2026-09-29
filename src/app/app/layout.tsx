import { MigrationProvider } from "@/lib/migration-store";
import { WorkspaceNav } from "@/components/workspace/Sidebar";
import { ConnectionBanner } from "@/components/workspace/ConnectionBanner";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <MigrationProvider>
      {/* The canvas carries a very faint measurement grid, the same one behind
          the calibration rig, so the workspace and the landing page share a
          surface language. Panels sit on top of it and read as raised. */}
      <div className="grid-surface flex min-h-screen flex-col bg-canvas lg:flex-row">
        <WorkspaceNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <ConnectionBanner />
          {children}
        </div>
      </div>
    </MigrationProvider>
  );
}
