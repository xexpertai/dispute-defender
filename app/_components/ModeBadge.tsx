import { utcStamp } from "@/lib/format";

/** Honest data-source label shown on every screen. */
export function ModeBadge({ mode, snapshotAt }: { mode: "live" | "replay"; snapshotAt?: string }) {
  if (mode === "live") {
    return (
      <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-win/40 bg-win-soft px-3 text-xs font-semibold text-win" title="Reading the PayPal sandbox right now">
        <span className="size-2 rounded-full bg-win pulse" aria-hidden="true" />
        Live sandbox
      </span>
    );
  }
  return (
    <span
      className="inline-flex min-h-8 items-center gap-2 whitespace-nowrap rounded-full border border-line-strong bg-surface px-2.5 text-xs text-ink-2 sm:px-3"
      title="Recorded, redacted PayPal sandbox responses. No live calls are made."
    >
      <span className="stamp text-ink" style={{ fontSize: "0.6rem" }}>Replay</span>
      <span className="hidden sm:inline">sandbox snapshot {utcStamp(snapshotAt)}</span>
      <span className="sr-only sm:hidden">sandbox snapshot {utcStamp(snapshotAt)}</span>
    </span>
  );
}
