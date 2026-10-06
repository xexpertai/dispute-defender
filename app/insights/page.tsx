import Link from "next/link";
import { getInsights } from "@/lib/insights/service";
import { utcStamp } from "@/lib/format";

export const dynamic = "force-dynamic";

const SEVERITY = {
  high: "text-loss",
  medium: "text-amber",
  low: "text-ink-2",
};

export default async function InsightsPage() {
  const v = await getInsights();
  const n = new Map(v.patterns.map((p, i) => [p.id, i + 1]));
  const a = v.actions;

  return (
    <div className="flex flex-col gap-8">
      <Link href="/" className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-ink-2 hover:text-ink">
        <span aria-hidden="true">←</span> All cases
      </Link>

      <header>
        <h1 className="font-display text-[1.9rem] leading-tight sm:text-[2.4rem]">Prevent the next dispute</h1>
        <p className="mt-2 max-w-prose text-sm text-ink-2">
          Patterns across your {v.disputes} {v.disputes === 1 ? "case" : "cases"}, found by fixed rules. Each lists the cases it comes from. The suggestions cite these patterns, and any number in them is checked against the data. You decide what to change.
        </p>
      </header>

      {v.patterns.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong p-6 text-sm text-muted">No patterns yet. Insights appear once you have a few disputes.</p>
      ) : (
        <div className="grid gap-x-6 gap-y-10 lg:grid-cols-12">
          <section aria-labelledby="actions-h" className="case-wrap rise lg:col-span-5 lg:self-start">
            <div className="case p-5 sm:p-6">
              <span className="case-tab">What to change</span>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="actions-h" className="font-display text-[1.25rem]">
                  Suggested changes
                </h2>
                {a.origin === "template" ? <span className="stamp text-ink-2">Template</span> : <span className="stamp text-ai">{a.origin === "ai-recorded" ? "AI · recorded" : "AI-written"}</span>}
              </div>
              <p className="mt-1 text-xs text-muted" title={a.model ? `${a.model}${a.recordedAt ? ` · recorded ${utcStamp(a.recordedAt)}` : ""}` : undefined}>
                {a.origin === "ai-recorded"
                  ? "One real Claude call for the whole portfolio, recorded and replayed at no cost."
                  : a.origin === "ai"
                    ? "One Claude call for the whole portfolio, cached until your cases change."
                    : "Suggestions from the rules; no AI was used."}
              </p>
              <ol className="mt-4 flex flex-col divide-y divide-line">
                {a.actions.map((x, i) => (
                  <li key={i} className="py-3">
                    <p className="flex items-start gap-2 font-semibold">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs text-on-primary">{i + 1}</span>
                      {x.title}
                    </p>
                    <p className="mt-1 pl-8 text-sm text-ink-2">{x.why}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 pl-8 text-xs">
                      {x.insightIds.map((id) => (
                        <a key={id} href={`#p-${id}`} className="inline-flex min-h-11 items-center font-semibold text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">
                          ↳ Pattern {n.get(id)}
                        </a>
                      ))}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section aria-labelledby="patterns-h" className="flex flex-col gap-3 lg:col-span-7">
            <h2 id="patterns-h" className="font-display text-[1.25rem]">
              Patterns in your cases
            </h2>
            {v.patterns.map((p, i) => (
              <article key={p.id} id={`p-${p.id}`} className="ev-item rise case p-4 sm:p-5">
                <p className="text-xs text-muted">
                  Pattern {i + 1} · <span className={`font-semibold ${SEVERITY[p.severity]}`}>{p.severity === "high" ? "high impact" : p.severity === "medium" ? "medium impact" : "low impact"}</span>
                </p>
                <h3 className="mt-0.5 font-semibold">{p.title}</h3>
                <p className="mt-1 text-sm text-ink-2">{p.detail}</p>
                <div className="mt-2 flex items-center gap-2" aria-hidden="true">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <span className="block h-full rounded-full bg-ink/70" style={{ width: `${Math.round((p.count / Math.max(1, p.total)) * 100)}%` }} />
                  </span>
                  <span className="font-mono text-[0.7rem] text-muted">
                    {p.count}/{p.total}
                  </span>
                </div>
                <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  Cases:
                  {p.disputeIds.map((id) => (
                    <Link key={id} href={`/disputes/${id}`} className="inline-flex min-h-11 items-center font-mono text-[0.72rem] text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
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
