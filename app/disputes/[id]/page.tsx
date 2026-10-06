import { notFound } from "next/navigation";
import { aiEnabled, currentMode, gatewayFor } from "@/lib/agent/deps";
import { toRow } from "@/lib/dashboard/guardian";
import { reasonLabel } from "@/lib/disputes/model";
import { availableActions } from "@/lib/paypal/links";
import { submissionsForDispute } from "@/lib/store/drafts";
import { sharedDb } from "@/lib/store/shared";
import { money, utcStamp } from "@/lib/format";
import { redactText } from "@/lib/redact";
import { AgentTrace } from "../../_components/AgentTrace";
import { ClockChip } from "../../_components/ClockChip";
import { SandboxSim } from "../../_components/SandboxSim";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  send_message: "Message buyer",
  make_offer: "Make offer",
  escalate: "Escalate",
  provide_evidence: "Provide evidence",
  accept_claim: "Accept claim",
  acknowledge_return_item: "Acknowledge return",
  provide_supporting_info: "Supporting info",
  appeal: "Appeal",
};

export default async function DisputePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^PP-[A-Z0-9-]{3,40}$/.test(id)) notFound();
  const mode = currentMode();
  const gateway = gatewayFor(mode);
  const { data: d } = await gateway.getDispute(id);
  if (!d) notFound();

  const row = toRow(d, gateway.now());
  const closed = row.outcome !== "open";
  const pace = typeof sp.pace === "string" && /^\d(\.\d)?$/.test(sp.pace) ? sp.pace : undefined;
  const messages = d.messages ?? [];
  const rels = availableActions(d);
  const submissions = submissionsForDispute(sharedDb(), d.dispute_id);

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <header className="case-wrap rise">
        <div className="case px-4 pb-1 pt-3 sm:px-5">
          <span className="case-tab">{d.dispute_id}</span>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-baseline gap-x-3 font-display text-[1.5rem] leading-tight sm:text-[1.8rem]">
                {reasonLabel(d.reason)}
                <span className="text-ink-2">{money(row.amount, row.currency)}</span>
              </h1>
              <p className="mt-0.5 text-sm text-muted">
                {row.stage} · opened {utcStamp(d.create_time)}
              </p>
            </div>
            <div className="flex flex-col items-start gap-1 sm:items-end">
              {closed ? (
                <span className={`stamp stamp-tilt ${row.outcome === "won" ? "text-win" : row.outcome === "lost" ? "text-loss" : "text-ink-2"}`} style={{ fontSize: "1rem", padding: "0.25rem 0.7rem" }}>
                  {row.outcome === "won" ? "Won" : row.outcome === "lost" ? `Lost · ${money(row.refunded ?? row.amount, row.currency)} refunded` : "Settled"}
                </span>
              ) : (
                <ClockChip clock={row.clock} hoursLeft={row.hoursLeft} bucket={row.bucket} frozen={mode === "replay"} />
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-dashed border-line-strong pt-2">
            <span className="mr-1 text-xs text-muted">PayPal allows now:</span>
            {row.actions.length ? (
              row.actions.map((a) => (
                <span key={a} className="rounded border border-pp/30 bg-pp-soft px-1.5 py-0.5 text-[0.72rem] font-medium text-pp">
                  {ACTION_LABEL[a] ?? a}
                </span>
              ))
            ) : (
              <span className="text-xs text-muted">{closed ? "nothing (case closed)" : "nothing right now"}</span>
            )}
            {messages.length > 0 && (
              <details className="text-sm sm:ml-auto [&[open]]:basis-full">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-semibold text-ink-2">Messages on this case ({messages.length})</summary>
                <ul className="mt-1 flex flex-col gap-1.5">
                  {messages.map((m, i) => (
                    <li key={i} className="rounded-lg bg-surface-2 px-3 py-2">
                      <span className="mr-2 text-xs text-muted">
                        {m.posted_by === "SELLER" ? "You" : m.posted_by === "BUYER" ? "Buyer" : "PayPal"} · {utcStamp(m.time_posted)}
                      </span>
                      {redactText(m.content ?? "")}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      </header>

      {mode === "live" && (rels.includes("adjudicate") || rels.includes("require_evidence")) && (
        <SandboxSim disputeId={d.dispute_id} canAdjudicate={rels.includes("adjudicate")} canRequireEvidence={rels.includes("require_evidence")} />
      )}

      <AgentTrace disputeId={d.dispute_id} mode={mode} autoStart={sp.run === "1"} pace={pace} closed={closed} aiAvailable={aiEnabled()} />

      {submissions.length > 0 && (
        <section aria-labelledby="sub-h" className="rounded-xl border border-dashed border-line-strong bg-surface-2/60 p-4 sm:p-5">
          <h2 id="sub-h" className="font-display text-[1.15rem] leading-none">
            {mode === "replay" ? "History: earlier sandbox submissions" : "Sent to PayPal"}
          </h2>
          {mode === "replay" && <p className="mt-1 text-xs text-muted">Made in the live PayPal sandbox while this case was being recorded, before this Replay. Nothing is sent from the Replay.</p>}
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {submissions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm">
                <span className={`stamp ${s.statusCode && s.statusCode < 300 ? "text-win" : "text-loss"}`}>{s.statusCode ?? "ERR"}</span>
                <span className="font-mono text-xs text-pp">POST {s.endpoint}</span>
                <span className="text-xs text-muted">
                  {s.origin === "ai" ? "AI-written" : "TEMPLATE"} · approved and sent {utcStamp(s.createdAt)}
                </span>
                {s.debugId && (
                  <details className="text-xs text-muted">
                    <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">Show details</summary>
                    <span className="font-mono">PayPal debug_id {s.debugId}</span>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
