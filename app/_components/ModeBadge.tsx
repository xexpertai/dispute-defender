import { utcStamp } from "@/lib/format";

/** Honest data-source label shown on every screen. Short by default; the full timestamp is in the tooltip. */
export function ModeBadge({ mode, snapshotAt }: { mode: "live" | "replay"; snapshotAt?: string }) {
  if (mode === "live") {
    return (
      <span className="inline-flex min-h-8 items-center gap-2 whitespace-nowrap rounded-full border border-win/40 bg-win-soft px-3 text-xs font-semibold text-win" title="Reading the PayPal sandbox right now">
        <span className="size-2 rounded-full bg-win pulse" aria-hidden="true" />
        LIVE · PayPal sandbox
      </span>
    );
  }
  const day = utcStamp(snapshotAt).split(",")[0];
  return (
    <span
      className="inline-flex min-h-8 items-center gap-2 whitespace-nowrap rounded-full border border-line-strong bg-surface px-2.5 text-xs text-ink-2"
      title={`Replay of recorded, redacted PayPal sandbox responses (snapshot ${utcStamp(snapshotAt)}). No live calls are made.`}
    >
      <span className="stamp text-ink" style={{ fontSize: "0.6rem", padding: "0 0.35rem" }}>
        Replay
      </span>
      <span className="hidden sm:inline">{day} sandbox</span>
      <span className="sr-only sm:hidden">sandbox snapshot {utcStamp(snapshotAt)}</span>
    </span>
  );
}
