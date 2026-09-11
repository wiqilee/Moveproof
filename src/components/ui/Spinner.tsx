import { Loader2 } from "lucide-react";

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-2 text-sm text-ink-soft" role="status">
      <Loader2 size={15} className="spin" aria-hidden />
      {label}
    </div>
  );
}
