import Link from "next/link";
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
      <Link href="/" className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-ink-2 hover:text-ink">
        <span aria-hidden="true">←</span> All disputes
      </Link>

      <header className="rise relative overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
          <span className="text-ink-2">{d.dispute_id}</span>
          <span>·</span>
          <span>{row.stage}</span>
          <span>·</span>
          <span>opened {utcStamp(d.create_time)}</span>
        </div>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-[2rem] leading-[0.95] sm:text-[2.5rem]">{reasonLabel(d.reason)}</h1>
            <p className="mt-2 font-display text-[1.6rem] leading-none tabular-nums text-ink-2 sm:text-[2rem]">
              {money(row.amount, row.currency)} <span className="text-[1rem] font-medium tracking-normal text-muted">disputed</span>
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            {closed ? (
              <span className={`stamp stamp-tilt text-base ${row.outcome === "won" ? "text-win" : row.outcome === "lost" ? "text-loss" : "text-ink-2"}`} style={{ fontSize: "0.95rem", padding: "0.3rem 0.7rem" }}>
                {row.outcome === "won" ? "Won" : row.outcome === "lost" ? `Lost · ${money(row.refunded ?? row.amount, row.currency)} refunded` : "Settled"}
              </span>
            ) : (
              <ClockChip clock={row.clock} hoursLeft={row.hoursLeft} bucket={row.bucket} frozen={mode === "replay"} />
            )}
            {d.dispute_outcome?.outcome_code && <span className="font-mono text-[0.68rem] text-muted">{d.dispute_outcome.outcome_code}</span>}
          </div>
        </div>

        <div className="perf mt-5" aria-hidden="true" />
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[0.7rem] uppercase tracking-wider text-muted">PayPal allows now</span>
          {row.actions.length ? (
            row.actions.map((a) => (
              <span key={a} className="rounded-md border border-pp/30 bg-pp-soft px-1.5 py-0.5 font-mono text-[0.7rem] text-pp">
                {ACTION_LABEL[a] ?? a}
              </span>
            ))
          ) : (
            <span className="text-xs text-muted">{closed ? "nothing (case closed)" : "nothing right now"}</span>
          )}
        </div>
        {messages.length > 0 && (
          <div className="mt-4">
            <p className="text-[0.7rem] uppercase tracking-wider text-muted">Messages on this case</p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {messages.map((m, i) => (
                <li key={i} className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
                  <span className="mr-2 font-mono text-[0.68rem] uppercase text-muted">
                    {m.posted_by === "SELLER" ? "You" : m.posted_by === "BUYER" ? "Buyer" : "PayPal"} · {utcStamp(m.time_posted)}
                  </span>
                  {redactText(m.content ?? "")}
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>

      {submissions.length > 0 && (
        <section aria-labelledby="sub-h" className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
          <h2 id="sub-h" className="font-display text-[1.15rem] leading-none">
            Sent to PayPal
          </h2>
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {submissions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm">
                <span className={`stamp ${s.statusCode && s.statusCode < 300 ? "text-win" : "text-loss"}`}>{s.statusCode ?? "ERR"}</span>
                <span className="font-mono text-xs text-pp">POST {s.endpoint}</span>
                <span className="text-xs text-muted">
                  {s.origin === "ai" ? "AI-written" : "TEMPLATE"} · approved and sent {utcStamp(s.createdAt)}
                  {s.debugId && ` · debug_id ${s.debugId}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mode === "live" && (rels.includes("adjudicate") || rels.includes("require_evidence")) && (
        <SandboxSim disputeId={d.dispute_id} canAdjudicate={rels.includes("adjudicate")} canRequireEvidence={rels.includes("require_evidence")} />
      )}

      <AgentTrace disputeId={d.dispute_id} mode={mode} autoStart={sp.run === "1"} pace={pace} closed={closed} aiAvailable={aiEnabled()} />
    </div>
  );
}
