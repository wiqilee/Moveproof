import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider, THEME_SCRIPT } from "@/lib/theme";
import { CommandPaletteProvider } from "@/components/command/CommandPaletteProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MoveProof, move data and prove what changed",
  description:
    "An AI assisted data migration workspace. Turn messy spreadsheets into structured database records with AI assisted mapping, independent verification and a clear audit trail.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "MoveProof",
    description: "Move data. Prove what changed.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint, so the page never
            flashes the wrong one. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <CommandPaletteProvider>{children}</CommandPaletteProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
