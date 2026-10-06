import type { DisputeGateway } from "../agent/gateway";
import { runAgent } from "../agent/run";
import type { CarrierAdapter } from "../evidence/sources";
import type { EvidenceItem } from "../evidence/types";
import { outcomeOf } from "../disputes/model";
import { FakeProvider } from "../llm/draft";
import type { StoreAdapter } from "../samples/store";
import type { Assessment } from "../strategy/rules";
import { factsFrom, type DisputeFacts } from "./patterns";

/** Gathers evidence + rules for every dispute (no AI, no writes) and reduces it to facts. */
export async function collectFacts(gateway: DisputeGateway, carrier: CarrierAdapter, store: StoreAdapter): Promise<DisputeFacts[]> {
  const out: DisputeFacts[] = [];
  for (const d of await gateway.listDisputes()) {
    let evidence: EvidenceItem[] = [];
    let assessment: Assessment | undefined;
    for await (const e of runAgent(d.dispute_id, { gateway, carrier, store, provider: new FakeProvider() })) {
      if (e.type === "evidence") evidence = e.items;
      if (e.type === "assessment") assessment = e.assessment;
    }
    if (assessment) out.push(factsFrom(d.dispute_id, outcomeOf(d), evidence, assessment));
  }
  return out;
}
