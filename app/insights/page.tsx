import Link from "next/link";
import { getInsights } from "@/lib/insights/service";
import { utcStamp } from "@/lib/format";

export const dynamic = "force-dynamic";

const SEVERITY = {
  high: "border-loss/40 bg-loss-soft text-loss",
  medium: "border-amber/40 bg-amber-soft text-amber",
  low: "border-line-strong bg-surface-2 text-ink-2",
};

export default async function InsightsPage() {
  const v = await getInsights();
  const byId = new Map(v.patterns.map((p) => [p.id, p]));
  const a = v.actions;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/" className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-ink-2 hover:text-ink">
        <span aria-hidden="true">←</span> All disputes
      </Link>

      <header className="rise rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
        <p className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted">Prevention insights</p>
        <h1 className="mt-2 font-display text-[1.9rem] leading-tight sm:text-[2.4rem]">Prevent the next dispute</h1>
        <p className="mt-2 max-w-prose text-sm text-ink-2">
          Patterns found across your {v.disputes} {v.disputes === 1 ? "dispute" : "disputes"} by deterministic rules. Each one lists the cases it comes from. The suggested actions cite these patterns, and any number in them is checked against the data.
        </p>
      </header>

      {v.patterns.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong p-6 text-sm text-muted">No patterns yet. Insights appear once you have a few disputes.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-12">
          <section aria-labelledby="actions-h" className="rise rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6 lg:col-span-5 lg:self-start">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="actions-h" className="font-display text-[1.3rem]">
                What to change
              </h2>
              {a.origin === "template" ? (
                <span className="stamp text-ink-2">Template</span>
              ) : (
                <span className="stamp text-ai">{a.origin === "ai-recorded" ? "AI-written · recorded" : "AI-written"}</span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted">
              {a.origin === "ai-recorded"
                ? `One real ${a.model} call for the whole portfolio, recorded ${utcStamp(a.recordedAt)}; replayed at $0.`
                : a.origin === "ai"
                  ? `One ${a.model} call for the whole portfolio, cached until your disputes change.`
                  : "Suggestions from the rules; no AI was used."}
            </p>
            <ol className="mt-4 flex flex-col gap-3">
              {a.actions.map((x, i) => (
                <li key={i} className="rounded-xl border border-line p-3">
                  <p className="flex items-start gap-2 font-semibold">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs text-on-primary">{i + 1}</span>
                    {x.title}
                  </p>
                  <p className="mt-1 pl-8 text-sm text-ink-2">{x.why}</p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-8 text-xs text-muted">
                    Based on
                    {x.insightIds.map((id) => (
                      <a key={id} href={`#p-${id}`} className="inline-flex min-h-11 items-center">
                        <span className="rounded-md border border-line bg-surface-2 px-2 py-1 text-ink-2 hover:border-line-strong">{byId.get(id)?.title ?? id}</span>
                      </a>
                    ))}
                    <span className="ml-auto rounded-md bg-surface-2 px-1.5 py-0.5">effort: {x.effort}</span>
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="patterns-h" className="flex flex-col gap-3 lg:col-span-7">
            <h2 id="patterns-h" className="font-display text-[1.3rem]">
              Patterns in your disputes
            </h2>
            {v.patterns.map((p) => (
              <article key={p.id} id={`p-${p.id}`} className="ev-item rise rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide ${SEVERITY[p.severity]}`}>{p.severity}</span>
                  <h3 className="font-semibold">{p.title}</h3>
                </div>
                <p className="mt-1.5 text-sm text-ink-2">{p.detail}</p>
                <div className="mt-2 flex items-center gap-2" aria-hidden="true">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round((p.count / Math.max(1, p.total)) * 100)}%` }} />
                  </span>
                  <span className="font-mono text-[0.7rem] text-muted">
                    {p.count}/{p.total}
                  </span>
                </div>
                <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                  Cases:
                  {p.disputeIds.map((id) => (
                    <Link key={id} href={`/disputes/${id}`} className="inline-flex min-h-11 items-center font-mono text-[0.72rem] text-primary hover:underline">
                      {id}
                    </Link>
                  ))}
                </p>
              </article>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
