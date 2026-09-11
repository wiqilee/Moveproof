import type { Config } from "tailwindcss";

/**
 * Colours resolve through CSS variables holding "R G B" triplets rather than
 * hex literals. Two reasons:
 *
 *   1. A single set of class names works in both themes. `bg-surface` is white
 *      in light and near black in dark, and no component has to know which.
 *   2. Opacity modifiers keep working. `bg-navy/90` needs the alpha channel to
 *      be composable, which a plain `var(--x)` colour cannot do.
 */
const withAlpha = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: withAlpha("--color-canvas"),
        surface: withAlpha("--color-surface"),
        muted: withAlpha("--color-muted"),
        ink: withAlpha("--color-ink"),
        "ink-soft": withAlpha("--color-ink-soft"),
        line: withAlpha("--color-line"),
        navy: withAlpha("--color-navy"),
        "on-navy": withAlpha("--color-on-navy"),
        brand: withAlpha("--color-brand"),
        "on-brand": withAlpha("--color-on-brand"),
        "brand-soft": withAlpha("--color-brand-soft"),
        ok: withAlpha("--color-ok"),
        "ok-soft": withAlpha("--color-ok-soft"),
        warn: withAlpha("--color-warn"),
        "warn-soft": withAlpha("--color-warn-soft"),
        bad: withAlpha("--color-bad"),
        "bad-soft": withAlpha("--color-bad-soft"),
        neutral: withAlpha("--color-neutral"),
        "neutral-soft": withAlpha("--color-neutral-soft"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        hero: ["3.25rem", { lineHeight: "1.05", letterSpacing: "-0.03em" }],
        "page-heading": ["1.9rem", { lineHeight: "1.2", letterSpacing: "-0.02em" }],
        "section-heading": ["1.25rem", { lineHeight: "1.3", letterSpacing: "-0.015em" }],
        table: ["0.8125rem", { lineHeight: "1.55" }],
      },
      borderRadius: {
        card: "12px",
        control: "9px",
      },
      boxShadow: {
        sm: "0 1px 2px 0 rgb(var(--shadow-rgb) / 0.06)",
        lift: "0 24px 48px -24px rgb(var(--shadow-rgb) / 0.28)",
        panel: "0 32px 64px -20px rgb(var(--shadow-rgb) / 0.35)",
      },
      keyframes: {
        "palette-in": {
          from: { opacity: "0", transform: "translateY(6px) scale(0.985)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "backdrop-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "palette-in": "palette-in 140ms cubic-bezier(0.16, 1, 0.3, 1)",
        "backdrop-in": "backdrop-in 120ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
