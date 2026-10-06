"use client";

import { useState } from "react";
import { proofHeadline, type ApiProof } from "@/lib/paypal/proof";
import { utcStamp } from "@/lib/format";

/**
 * The proof panel: the actual PayPal API response fields (no personal data), so anyone can see the
 * outcome came from PayPal's Disputes API, and cross-check it by dispute id and debug_id.
 */
export function ApiResponsePanel({ proof, title = "PayPal API response" }: { proof: ApiProof; title?: string }) {
  const live = proof.source === "live";
  const rows: [string, string][] = [
    ["Request", `${proof.method} ${proof.endpoint}`],
    ["HTTP status", String(proof.httpStatus)],
    ["Dispute ID", proof.disputeId],
    ...(proof.status || proof.outcome ? ([["Status", proofHeadline(proof)]] as [string, string][]) : []),
    ...(proof.debugId ? ([["PayPal debug_id", proof.debugId]] as [string, string][]) : []),
    ["Received", utcStamp(proof.fetchedAt)],
  ];
  return (
    <section aria-label={title} className="rise rounded-xl border border-pp/40 bg-pp-soft/50 p-3" data-proof>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-pp">{title}</h3>
        <span className={`stamp ${live ? "text-win" : "text-ink-2"}`} style={{ fontSize: "0.62rem" }}>
          {live ? "Live · PayPal sandbox" : "Replay · recorded"}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[0.75rem]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className={`break-all ${k === "Status" ? "font-semibold text-ink" : "text-ink-2"}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Fetches the dispute again from PayPal (Live) and shows the response panel. */
export function VerifyWithPayPal({ disputeId, label = "Verify with PayPal" }: { disputeId: string; label?: string }) {
  const [proof, setProof] = useState<ApiProof | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  async function verify() {
    setState("busy");
    try {
      const r = await fetch(`/api/disputes/${disputeId}/proof`);
      if (!r.ok) throw new Error(String(r.status));
      setProof((await r.json()) as ApiProof);
      setState("idle");
    } catch {
      setState("error");
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={verify} disabled={state === "busy"} className="inline-flex min-h-11 w-fit items-center rounded-full border border-pp/40 px-4 text-sm font-semibold text-pp hover:bg-pp-soft disabled:opacity-60">
        {state === "busy" ? "Asking PayPal…" : label}
      </button>
      {state === "error" && <p className="text-xs text-loss">PayPal didn&apos;t answer. Try again.</p>}
      {proof && <ApiResponsePanel proof={proof} />}
    </div>
  );
}
