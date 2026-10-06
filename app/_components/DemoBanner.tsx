"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** One-line strip in Replay: which demo store this is, what Replay means, and Reset. */
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
    <div className="-mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-dashed border-line-strong pb-2 text-[0.8rem] text-ink-2">
      <p>
        <span className="font-semibold text-ink">Demo store · Kiln &amp; Clay Studio</span> · replayed PayPal sandbox data · nothing is sent from this demo
      </p>
      <button type="button" onClick={reset} disabled={state === "busy"} className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink disabled:opacity-60">
        {state === "busy" ? "Resetting…" : state === "done" ? "Demo reset ✓" : state === "error" ? "Try again" : "Reset demo"}
      </button>
    </div>
  );
}
