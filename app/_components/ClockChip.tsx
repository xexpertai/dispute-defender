import { formatCountdown, type GuardianRow } from "@/lib/dashboard/guardian";
import { utcStamp } from "@/lib/format";

const OWNER_ICON: Record<GuardianRow["clock"]["owner"], string> = { seller: "●", buyer: "◐", paypal: "◇", closed: "■" };

/** Who is on the clock, and how long they have. Urgent only when the move is yours. */
export function ClockChip({ clock, hoursLeft, bucket, frozen }: Pick<GuardianRow, "clock" | "hoursLeft" | "bucket"> & { frozen?: boolean }) {
  const urgent = clock.owner === "seller" && (bucket === "overdue" || bucket === "due_48h");
  const tone =
    clock.owner === "closed"
      ? "border-line text-muted"
      : urgent
        ? "border-amber/50 bg-amber-soft text-amber"
        : clock.owner === "seller"
          ? "border-ink/30 bg-surface text-ink"
          : "border-line-strong bg-surface-2 text-ink-2";
  const time = clock.owner === "closed" ? null : hoursLeft === null ? "no deadline" : formatCountdown(hoursLeft);
  return (
    <span
      className={`inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium ${tone}`}
      title={clock.dueAt ? `Due ${utcStamp(clock.dueAt)}${frozen ? " · countdown frozen at the Replay snapshot" : ""}` : undefined}
    >
      <span aria-hidden="true" className={urgent ? "pulse rounded-full" : ""}>
        {OWNER_ICON[clock.owner]}
      </span>
      <span>{clock.label}</span>
      {time && <span className="font-mono tabular-nums opacity-80">· {time}</span>}
    </span>
  );
}
