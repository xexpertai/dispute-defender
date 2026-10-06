import { describe, expect, it } from "vitest";
import { ReplayGateway } from "@/lib/agent/gateway";
import { runAgent } from "@/lib/agent/run";
import type { TraceEvent } from "@/lib/agent/trace";
import { MockCarrier } from "@/lib/carrier/mock";
import { assertCliAllowed, CliProvider, CliProviderForbidden, parseCliDraft } from "@/lib/llm/cli";
import { loadFixtures } from "@/lib/replay/fixtures";
import { SampleStore } from "@/lib/samples/store";

describe("DD_LLM=cli guard (dev only)", () => {
  it.each([
    [{ NODE_ENV: "production" }, true],
    [{ NODE_ENV: "development", RENDER: "true" }, true],
    [{ NODE_ENV: "development", DD_PUBLIC_DEMO: "1" }, true],
    [{ NODE_ENV: "development" }, false],
    [{ NODE_ENV: "test" }, false],
  ])("%j → forbidden %s", (env, forbidden) => {
    if (forbidden) expect(() => assertCliAllowed(env)).toThrow(CliProviderForbidden);
    else expect(() => assertCliAllowed(env)).not.toThrow();
  });

  it("parses the CLI's JSON envelope (result with stray prose)", () => {
    const stdout = JSON.stringify({ result: 'Here you go:\n{"strategy":"FIGHT","action":"none","offer_type":"none","amount":"","rationale":"r","claims":[],"seller_note_to_paypal":"n","buyer_message":{"language":"en","text":"","english_gloss":""}}' });
    expect(parseCliDraft(stdout)).toMatchObject({ strategy: "FIGHT", seller_note_to_paypal: "n" });
  });

  it("its drafts still go through server validation (unknown refs dropped)", async () => {
    const f = loadFixtures();
    const run = async () =>
      JSON.stringify({ result: JSON.stringify({ strategy: "FIGHT", action: "send_message", offer_type: "none", amount: "", rationale: "r", claims: [{ text: "Invented", source_refs: ["order:NOPE"] }, { text: "Real", source_refs: ["dispute:PP-R-MQR-10190375"] }], seller_note_to_paypal: "n", buyer_message: { language: "en", text: "hi", english_gloss: "" } }) });
    const events: TraceEvent[] = [];
    for await (const e of runAgent("PP-R-MQR-10190375", { gateway: new ReplayGateway(f), carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store), provider: new CliProvider(run) })) events.push(e);
    const d = events.find((e): e is Extract<TraceEvent, { type: "draft" }> => e.type === "draft")!;
    expect(d.draft?.claims.map((c) => c.text)).toEqual(["Real"]);
    expect(d.issues?.map((i) => i.code)).toContain("unknown_source");
  });
});
