import { MigrationProvider } from "@/lib/migration-store";
import { WorkspaceNav } from "@/components/workspace/Sidebar";
import { ConnectionBanner } from "@/components/workspace/ConnectionBanner";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <MigrationProvider>
      <div className="flex min-h-screen flex-col lg:flex-row">
        <WorkspaceNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <ConnectionBanner />
          {children}
        </div>
      </div>
    </MigrationProvider>
  );
}
