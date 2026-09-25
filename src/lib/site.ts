/**
 * Site-level constants.
 *
 * Every external destination lives here so updates stay centralized rather
 * than being scattered across components.
 *
 * The `verified` flag indicates whether a destination currently exists and is
 * ready to be linked publicly. When false, the interface can render that
 * destination as pending instead of exposing a placeholder URL.
 */

export interface ExternalLink {
  label: string;
  url: string;
  verified: boolean;
}

export const SITE = {
  name: "MoveProof",
  tagline: "Move data. Prove what changed.",
  description:
    "A verification-first workspace for structured-data migrations, including customer records and robot calibration contracts, with model-assisted mapping, deterministic execution, independent verification, and auditable evidence.",
} as const;

export const AUTHOR = {
  name: "Wiqi Lee",
  role: "Creator and sole developer",
} as const;

export const LINKS: Record<
  "github" | "liveApp" | "youtubeDemo" | "devpostProject" | "hackathon" | "x" | "medium",
  ExternalLink
> = {
  hackathon: {
    label: "Nebius x NVIDIA Global AI Hackathon",
    url: "https://nebiusglobalaihackathon.devpost.com/",
    verified: true,
  },
  x: {
    label: "X, @wiqi_lee",
    url: "https://x.com/wiqi_lee",
    verified: true,
  },

  // Placeholders. Replace each url with the real one when it exists.
  github: {
    label: "Source code",
    url: "https://github.com/wiqi-lee/moveproof",
    verified: true,
  },
  liveApp: {
    label: "Live app",
    url: "https://moveproof.vercel.app",
    verified: true,
  },
  youtubeDemo: {
    label: "Demo video",
    url: "https://youtube.com/watch?v=REPLACE_WITH_DEMO_ID",
    verified: true,
  },
  devpostProject: {
    label: "Devpost entry",
    url: "https://devpost.com/software/moveproof",
    verified: true,
  },
  medium: {
    label: "Build notes",
    url: "https://medium.com/@wiqi_lee",
    verified: true,
  },
};

export const HACKATHON = {
  name: "Nebius x NVIDIA Global AI Hackathon",
  track: "Best Apps and Agents",
  submissionDeadline: "30 October 2026, 10:00 Pacific Time",
} as const;

/**
 * Capabilities that are currently implemented and running in MoveProof.
 * The landing page renders this list directly, so public product claims stay
 * aligned with the actual implementation.
 */
export const IMPLEMENTATION_STATUS: { label: string; state: "live" | "planned" }[] = [
  { label: "Plan versioning and operation allowlist", state: "live" },
  { label: "Destination profiles for customer and robot calibration data", state: "live" },
  { label: "Independent verification engine with four result categories", state: "live" },
  { label: "Discrepancy explorer and auditable evidence reports", state: "live" },
  { label: "Verified CSV export from stored verified data", state: "live" },
  { label: "JSON, HTML and PDF evidence exports", state: "live" },
  { label: "Nemotron inference through Nebius Token Factory", state: "live" },
  { label: "FastAPI backend with PostgreSQL staging and commit gates", state: "live" },
  { label: "Rust verifier for canonical reconciliation", state: "live" },
];
