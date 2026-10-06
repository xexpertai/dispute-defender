"use client";

import Link from "next/link";

/** Shown if a page fails (e.g. the PayPal sandbox is unreachable in Live mode). Never shows secrets. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-start gap-3 rounded-2xl border border-line bg-surface p-6 shadow-card" role="alert">
      <h1 className="font-display text-[1.4rem]">Something went wrong</h1>
      <p className="text-sm text-ink-2">We couldn&apos;t load this page. If you&apos;re in Live mode, the PayPal sandbox may be slow or unavailable. Nothing was sent to PayPal.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={reset} className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-on-primary">
          Try again
        </button>
        <Link href="/" className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-sm font-semibold">
          All disputes
        </Link>
      </div>
    </div>
  );
}
