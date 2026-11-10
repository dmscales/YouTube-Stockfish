import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Draft Check",
  description: "Simulate how audiences might react to a YouTube Short before you upload it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span aria-hidden className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-ink text-sm">▶</span>
              Draft Check
            </Link>
            <nav className="order-last flex w-full gap-4 text-sm text-ink-2 sm:order-none sm:w-auto">
              <Link href="/" className="hover:text-ink">Videos</Link>
              <Link href="/compare" className="hover:text-ink">Compare edits</Link>
              <Link href="/model" className="hover:text-ink">Model accuracy</Link>
            </nav>
            <Link href="/upload" className="btn btn-primary ml-auto">Analyze a draft</Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted">
          Predictions are model estimates for a simulated audience, not YouTube analytics.
        </footer>
      </body>
    </html>
  );
}
