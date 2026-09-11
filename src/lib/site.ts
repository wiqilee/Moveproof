/**
 * Site level constants.
 *
 * Every external destination lives here, so replacing a placeholder is a
 * one line edit in one file rather than a search across components.
 *
 * The URLs below are placeholders. Swap each one for the real destination
 * before submitting, and the navigation bar, the footer and the social icons
 * all pick up the change automatically.
 *
 * The `verified` flag exists for the case where a destination genuinely does
 * not exist yet: set it to false and that entry renders as muted text marked
 * pending instead of as a link. Everything is true by default.
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
    "An AI assisted data migration workspace. Turn messy spreadsheets into structured database records with AI assisted mapping, independent verification and a clear audit trail.",
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
 * What is actually running today, as opposed to what the architecture is
 * designed for. The landing page renders this list directly so the two can
 * never drift apart.
 */
export const IMPLEMENTATION_STATUS: { label: string; state: "live" | "planned" }[] = [
  { label: "Plan versioning and the operation allowlist", state: "live" },
  { label: "Independent verification engine, four result categories", state: "live" },
  { label: "Discrepancy explorer and evidence report", state: "live" },
  { label: "JSON export from the canonical evidence object", state: "live" },
  { label: "Nemotron inference through Nebius Token Factory", state: "planned" },
  { label: "FastAPI backend and PostgreSQL staging", state: "planned" },
  { label: "Server side PDF generation", state: "planned" },
];
