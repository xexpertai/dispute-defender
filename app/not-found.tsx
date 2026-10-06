import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-start gap-3 rounded-2xl border border-line bg-surface p-6 shadow-card">
      <p className="font-mono text-xs text-muted">404</p>
      <h1 className="font-display text-[1.4rem]">We couldn&apos;t find that dispute</h1>
      <p className="text-sm text-ink-2">It may belong to another PayPal account, or the link is mistyped.</p>
      <Link href="/" className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-on-primary">
        Back to all disputes
      </Link>
    </div>
  );
}
