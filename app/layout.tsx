import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { currentMode } from "@/lib/agent/deps";
import { fixtures } from "@/lib/replay/fixtures";
import { Brand } from "./_components/Brand";
import { ModeBadge } from "./_components/ModeBadge";
import { NavLinks } from "./_components/NavLinks";
import { ThemeToggle, themeBootScript } from "./_components/ThemeToggle";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Dispute Defender",
  description: "An honest AI agent that helps small sellers win, or wisely settle, PayPal disputes.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1220" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const mode = currentMode();
  const snapshotAt = mode === "replay" ? fixtures().snapshotAt : undefined;
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only z-50 rounded-md bg-primary px-4 py-3 text-on-primary focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
          Skip to content
        </a>
        <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-1.5 sm:px-6">
            <Brand />
            <div className="flex items-center gap-2">
              <ModeBadge mode={mode} snapshotAt={snapshotAt} />
              <ThemeToggle />
            </div>
          </div>
          <NavLinks />
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-5 sm:px-6 sm:pt-8">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto w-full max-w-6xl px-4 py-5 text-xs leading-relaxed text-muted sm:px-6">
            PayPal sandbox only. Replay shows recorded, redacted sandbox responses. Carrier scans come from a mock carrier and store logs are sample
            data; both are labelled wherever they appear. Nothing is sent to PayPal without your approval.
          </div>
        </footer>
      </body>
    </html>
  );
}
