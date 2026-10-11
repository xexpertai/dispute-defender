import type { Metadata } from "next";
import Link from "next/link";
import { currentMode, gatewayFor } from "@/lib/agent/deps";
import { MockCarrier } from "@/lib/carrier/mock";
import { summarize } from "@/lib/dashboard/guardian";
import { caseMatrix } from "@/lib/dashboard/matrix";
import { reasonLabel } from "@/lib/disputes/model";
import { money } from "@/lib/format";
import { fixtures } from "@/lib/replay/fixtures";
import { SampleStore } from "@/lib/samples/store";
import { STRENGTH_RULE } from "@/lib/strategy/checklist";
import { VERDICT_WORD, type VerdictKey } from "@/lib/strategy/verdict";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verify in 5 minutes · Dispute Defender" };

const REPO = "https://github.com/xexpertai/dispute-defender";
const TONE: Record<VerdictKey, string> = { FIGHT: "text-win", OFFER: "text-amber", REFUND: "text-loss", HOLD: "text-ink-2", WAIT: "text-amber" };

/** Safety gates every write passes, each with the test file that proves it (no network, no keys). */
const GATES: { gate: string; tests: string[] }[] = [
  { gate: "Sandbox only: forced in three places (env check, Agent Toolkit context, base-URL assertion). The toolkit's own default is live.", tests: ["sandbox-guard"] },
  { gate: "Only the actions PayPal lists on the dispute right now (HATEOAS). A missing link means the write is refused before any call.", tests: ["disputes", "considered-actions"] },
  { gate: "Nothing is sent without the seller's approval. The approval is stored first and used as PayPal-Request-Id, so a retry can't submit twice. Replay never sends.", tests: ["submit"] },
  { gate: "The server checker strikes AI claims with no record behind them, tracking numbers never gathered, offers above the amount, and policy outcomes stated as fact.", tests: ["draft-validate", "policy-claims", "checker"] },
  { gate: "Every proof and reason cites a record the agent actually gathered; the evidence-pack PDF refuses claims whose records aren't in it.", tests: ["proof-checklist", "submit"] },
  { gate: "Buyer names, emails, addresses and phones are redacted before the AI, the logs and the fixtures.", tests: ["redact", "fixtures-scan"] },
  { gate: "MCP: write tools are off unless DD_MCP_ALLOW_WRITES=1, HATEOAS-gated when on; keyless Replay returns the would-be request and sends nothing.", tests: ["mcp", "mcp-replay"] },
];

export default async function VerifyPage() {
  const mode = currentMode();
  const gateway = gatewayFor(mode);
  const disputes = await gateway.listDisputes();
  const s = summarize(disputes, gateway.now());
  const f = fixtures();
  const all = [...s.open, ...s.closed];
  const rows = await caseMatrix(
    all.map((r) => r.id),
    { gateway, carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store) },
  );
  const outcome = new Map(s.closed.map((r) => [r.id, r.outcome]));
  const rewindId = mode === "replay" ? [...f.rewinds.keys()][0] : undefined;
  const featured = rewindId ? `/disputes/${rewindId}?run=1&rewind=1` : rows[0] ? `/disputes/${rows[0].id}?run=1` : "/";
  const find = (pred: (r: (typeof rows)[number]) => boolean) => rows.find((r) => !r.closed && pred(r));
  const unprovable = find((r) => r.verdict === "REFUND" && r.have === 0);
  const buyerRight = find((r) => r.verdict === "REFUND" && r.against > 0);
  const hold = find((r) => r.verdict === "HOLD");
  const offer = find((r) => r.verdict === "OFFER");

  return (
    <div className="flex flex-col gap-8">
      <Link href="/" className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-ink-2 hover:text-ink">
        <span aria-hidden="true">←</span> All cases
      </Link>

      <header>
        <h1 className="font-display text-[1.9rem] leading-tight sm:text-[2.4rem]">Verify it in 5 minutes</h1>
        <p className="mt-2 max-w-prose text-sm text-ink-2">
          {mode === "replay"
            ? "Everything on this page runs on Replay: recorded, redacted responses from the real PayPal sandbox. No login, no keys, and nothing is sent. "
            : "Live sandbox mode. "}
          Carrier scans come from a mock carrier and store logs are sample data; both are labelled wherever they appear.
        </p>
      </header>

      {/* ------------------------------------------------------------ the evidence behind each call */}
      <section aria-labelledby="matrix-h" className="case p-4 sm:p-6">
        <h2 id="matrix-h" className="font-display text-[1.35rem] leading-tight">
          The evidence behind each call
        </h2>
        <p className="mt-1 max-w-prose text-xs text-muted">
          For each case: the PayPal reason code, how much of the proof that answers it is on file, the score arithmetic, and the fact that decided it. Fixed rules, no AI. Open a case to see every proof with its record.
        </p>
        <ul className="mt-3 flex flex-col divide-y divide-line sm:hidden">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-0.5 py-2.5 text-sm">
              <span className="flex items-baseline justify-between gap-2">
                <Link href={`/disputes/${r.id}${r.closed ? "" : "?run=1"}`} className="font-mono text-[0.72rem] underline decoration-line-strong underline-offset-2">
                  {r.id}
                </Link>
                <span className={`font-semibold ${TONE[r.verdict]}`}>
                  {VERDICT_WORD[r.verdict]}
                  {r.closed && <span className="font-normal text-muted"> · closed{outcome.get(r.id) ? `, ${outcome.get(r.id)}` : ""}</span>}
                </span>
              </span>
              <span className="text-xs text-ink-2">
                {reasonLabel(r.reason)} · {money(r.amount, r.currency)} · proof {r.have} of {r.of} · score <span className="whitespace-nowrap font-mono">{r.score}</span>
              </span>
              <span className="text-xs text-muted">{r.decidedBy}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-3 font-medium">Case</th>
                <th scope="col" className="py-2 pr-3 font-medium">Call</th>
                <th scope="col" className="py-2 pr-3 font-medium">Proof on file</th>
                <th scope="col" className="py-2 pr-3 font-medium">Score</th>
                <th scope="col" className="py-2 font-medium">Decided by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-2 pr-3">
                    <Link href={`/disputes/${r.id}${r.closed ? "" : "?run=1"}`} className="font-mono text-[0.72rem] underline decoration-line-strong underline-offset-2 hover:decoration-ink">
                      {r.id}
                    </Link>
                    <span className="block text-xs text-ink-2">
                      {reasonLabel(r.reason)} · {money(r.amount, r.currency)}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`font-semibold ${TONE[r.verdict]}`}>{VERDICT_WORD[r.verdict]}</span>
                    {r.closed && <span className="block text-xs text-muted">closed{outcome.get(r.id) ? ` · ${outcome.get(r.id)}` : ""} (hindsight)</span>}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {r.have} of {r.of}
                    {(r.against > 0 || r.pending > 0) && (
                      <span className="block text-xs text-muted">
                        {[r.against ? `${r.against} ${r.against === 1 ? "shows" : "show"} the opposite` : "", r.pending ? `${r.pending} not yet` : ""].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 font-mono text-[0.75rem] tabular-nums">{r.score}</td>
                  <td className="py-2 text-xs text-ink-2">{r.decidedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[0.7rem] text-muted">{STRENGTH_RULE}</p>
      </section>

      {/* ------------------------------------------------------------ the 5-minute path */}
      <section aria-labelledby="path-h" className="case p-4 sm:p-6">
        <h2 id="path-h" className="font-display text-[1.35rem] leading-tight">
          A 5-minute path
        </h2>
        <ol className="mt-3 flex flex-col gap-3 text-sm text-ink-2">
          <Step n={1} time="1 min">
            <Link href={featured} className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
              Watch the agent work the case from the video
            </Link>
            . Check that every reason and every row of <em>Proof for this claim</em> carries a source chip; tap one and it jumps to the record.
          </Step>
          <Step n={2} time="30 s">
            On that case, press <strong className="text-ink">Test our checker</strong>: two made-up claims are injected and the server strikes them out.
          </Step>
          <Step n={3} time="30 s">
            Open <strong className="text-ink">What PayPal receives</strong>: the exact request (endpoint and JSON) and the evidence-pack PDF, before anything is sent.
          </Step>
          <Step n={4} time="1 min">
            Cases where the agent does not just defend:{" "}
            {[
              unprovable && { r: unprovable, t: "can't prove delivery" },
              buyerRight && { r: buyerRight, t: "the buyer is right" },
              offer && { r: offer, t: "a fair offer" },
              hold && { r: hold, t: "hold, nothing to send yet" },
            ]
              .filter((x): x is { r: (typeof rows)[number]; t: string } => Boolean(x))
              .map((x, i, arr) => (
                <span key={x.r.id}>
                  <Link href={`/disputes/${x.r.id}?run=1`} className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                    {x.t}
                  </Link>
                  {i < arr.length - 1 ? " · " : "."}
                </span>
              ))}
          </Step>
          <Step n={5} time="1 min">
            Run the checks yourself (no keys, no network):
            <code className="mt-1 block overflow-x-auto rounded-md bg-surface-2 px-3 py-2 font-mono text-[0.75rem] text-ink">npm ci && npm test</code>
          </Step>
          <Step n={6} time="1 min">
            Ask any MCP client for the agent&apos;s judgement, keyless on the same Replay data:
            <code className="mt-1 block overflow-x-auto rounded-md bg-surface-2 px-3 py-2 font-mono text-[0.75rem] text-ink">npx @modelcontextprotocol/inspector npm run -s mcp:replay</code>
            then call <code className="font-mono text-[0.8rem]">assess_dispute</code>
            {unprovable ? (
              <>
                {" "}
                with <code className="font-mono text-[0.8rem]">{unprovable.id}</code>
              </>
            ) : null}
            : the verdict, the score arithmetic and the proof checklist, each with its record.
          </Step>
        </ol>
      </section>

      {/* ------------------------------------------------------------ safety gates */}
      <section aria-labelledby="gates-h" className="case p-4 sm:p-6">
        <h2 id="gates-h" className="font-display text-[1.35rem] leading-tight">
          Gates every write passes
        </h2>
        <p className="mt-1 text-xs text-muted">Each with the test file that proves it.</p>
        <ul className="mt-2 flex flex-col divide-y divide-line">
          {GATES.map((g) => (
            <li key={g.gate} className="flex flex-col gap-1 py-2.5 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <span className="text-ink-2">{g.gate}</span>
              <span className="flex shrink-0 flex-wrap gap-1.5">
                {g.tests.map((t) => (
                  <a key={t} href={`${REPO}/blob/main/tests/${t}.test.ts`} className="rounded border border-line px-1.5 py-0.5 font-mono text-[0.68rem] text-ink-2 hover:border-line-strong hover:text-ink">
                    tests/{t}.test.ts
                  </a>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Step({ n, time, children }: { n: number; time: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.75rem_1fr] gap-x-2.5">
      <span className="mt-0.5 grid size-6 place-items-center rounded-full border border-ink bg-ink font-mono text-[0.68rem] font-semibold text-bg" aria-hidden="true">
        {n}
      </span>
      <div className="min-w-0">
        <span className="mr-1.5 text-xs font-semibold text-muted">{time}</span>
        {children}
      </div>
    </li>
  );
}
