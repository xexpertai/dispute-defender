"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Shown in Replay: who this demo store is, that no login is needed, and a Reset button. */
export function DemoBanner() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function reset() {
    setState("busy");
    const r = await fetch("/api/demo/reset", { method: "POST", headers: { "x-dd-action": "1" } });
    setState(r.ok ? "done" : "error");
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-primary/25 bg-primary-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-ink">
        <span className="font-semibold">Demo store: Kiln &amp; Clay Studio.</span>{" "}
        <span className="text-ink-2">No login. Real PayPal sandbox data, replayed; nothing here is sent to PayPal.</span>
      </p>
      <button type="button" onClick={reset} disabled={state === "busy"} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-surface px-4 text-sm font-semibold text-primary hover:bg-primary-soft disabled:opacity-60">
        {state === "busy" ? "Resetting…" : state === "done" ? "Demo reset ✓" : state === "error" ? "Try again" : "Reset demo"}
      </button>
    </div>
  );
}
