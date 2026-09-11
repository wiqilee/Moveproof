import type { CheckStatus, MappingStatus, MigrationState } from "./types";

/**
 * Presentation rules for every status in the product.
 *
 * Colour is expressed as Tailwind classes rather than hex literals, so a
 * status adapts to the theme without any component knowing which theme is
 * active. Inline hex would have frozen these to the light palette.
 *
 * Colour alone never carries meaning. Each entry pairs a colour with an icon
 * shape and a text label, so the state is readable to anyone who cannot
 * distinguish the hues.
 */

export interface StatusPresentation {
  label: string;
  className: string;
  /** For a figure rendered on its own, where a background would be noise. */
  textClass: string;
  icon: "check" | "cross" | "alert" | "info" | "pause" | "ban" | "circle";
}

export const checkStatusPresentation: Record<CheckStatus, StatusPresentation> = {
  passed: {
    label: "Passed",
    className: "text-ok bg-ok-soft",
    textClass: "text-ok",
    icon: "check",
  },
  failed: {
    label: "Failed",
    className: "text-bad bg-bad-soft",
    textClass: "text-bad",
    icon: "cross",
  },
  review: {
    label: "Review required",
    className: "text-warn bg-warn-soft",
    textClass: "text-warn",
    icon: "alert",
  },
  not_verified: {
    label: "Not verified",
    className: "text-neutral bg-neutral-soft",
    textClass: "text-neutral",
    icon: "info",
  },
};

export const mappingStatusPresentation: Record<MappingStatus, StatusPresentation> = {
  proposed: {
    label: "Proposed",
    className: "text-brand bg-brand-soft",
    textClass: "text-brand",
    icon: "circle",
  },
  review: {
    label: "Review required",
    className: "text-warn bg-warn-soft",
    textClass: "text-warn",
    icon: "alert",
  },
  approved: {
    label: "Approved",
    className: "text-navy bg-brand-soft",
    textClass: "text-navy",
    icon: "check",
  },
};

export const migrationStatePresentation: Record<MigrationState, StatusPresentation> = {
  draft: {
    label: "Draft",
    className: "text-neutral bg-neutral-soft",
    textClass: "text-neutral",
    icon: "circle",
  },
  plan_approved: {
    label: "Plan approved",
    className: "text-navy bg-brand-soft",
    textClass: "text-navy",
    icon: "check",
  },
  staging: {
    label: "Staging",
    className: "text-brand bg-brand-soft",
    textClass: "text-brand",
    icon: "circle",
  },
  verification_failed: {
    label: "Verification failed",
    className: "text-bad bg-bad-soft",
    textClass: "text-bad",
    icon: "cross",
  },
  review_required: {
    label: "Review required",
    className: "text-warn bg-warn-soft",
    textClass: "text-warn",
    icon: "alert",
  },
  ready_to_commit: {
    label: "Ready to commit",
    className: "text-ok bg-ok-soft",
    textClass: "text-ok",
    icon: "check",
  },
  committed: {
    label: "Committed",
    className: "text-ok bg-ok-soft",
    textClass: "text-ok",
    icon: "check",
  },
  rolled_back: {
    label: "Rolled back",
    className: "text-neutral bg-neutral-soft",
    textClass: "text-neutral",
    icon: "ban",
  },
};

/**
 * Legal transitions between migration states.
 *
 * The only path into `committed` runs through `ready_to_commit`, which is
 * reachable only when no check has failed and none awaits review. The
 * authority for this is the backend; this copy exists so the interface can
 * describe a state without inventing one.
 */
export const allowedTransitions: Record<MigrationState, MigrationState[]> = {
  draft: ["plan_approved"],
  plan_approved: ["staging"],
  staging: ["verification_failed", "review_required", "ready_to_commit"],
  verification_failed: ["plan_approved", "staging"],
  review_required: ["ready_to_commit", "verification_failed", "plan_approved"],
  ready_to_commit: ["committed", "review_required", "verification_failed"],
  committed: ["rolled_back"],
  rolled_back: [],
};

export function canTransition(from: MigrationState, to: MigrationState): boolean {
  return allowedTransitions[from].includes(to);
}
