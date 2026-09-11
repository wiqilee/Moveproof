import { AlertTriangle, Ban, CheckCircle2, Circle, Info, PauseCircle, XCircle } from "lucide-react";
import type { StatusPresentation } from "@/domain/status";

const iconMap = {
  check: CheckCircle2,
  cross: XCircle,
  alert: AlertTriangle,
  info: Info,
  pause: PauseCircle,
  ban: Ban,
  circle: Circle,
} as const;

/**
 * Renders a status with three signals at once: a colour, an icon shape and a
 * text label. Someone who cannot distinguish the hues still reads the state,
 * and the colours follow the active theme because they are classes rather
 * than inline hex.
 */
export function StatusPill({ presentation }: { presentation: StatusPresentation }) {
  const Icon = iconMap[presentation.icon];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${presentation.className}`}
    >
      <Icon size={13} strokeWidth={2.5} aria-hidden />
      {presentation.label}
    </span>
  );
}
