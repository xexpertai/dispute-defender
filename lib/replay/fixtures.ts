import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { OrderLike, PayPalTrackerLike } from "../evidence/sources";
import type { DisputeRecord } from "../disputes/model";
import type { CarrierSampleFile } from "../carrier/mock";
import type { StoreSampleFile } from "../samples/store";
import type { RecordedDraft } from "../llm/recorded";

/**
 * Replay data: recorded, redacted sandbox responses (fixtures/paypal/*) plus the demo store's
 * sample data (fixtures/samples/*). Read once per process.
 */
export interface FixtureSet {
  disputes: Map<string, DisputeRecord>;
  /** Orders v2, indexed by capture id (a dispute only knows its capture / seller transaction id). */
  ordersByCapture: Map<string, OrderLike>;
  trackersByCapture: Map<string, PayPalTrackerLike[]>;
  carrier: CarrierSampleFile;
  store: StoreSampleFile;
  /** Real Claude drafts captured once per fixture (fixtures/ai/drafts). */
  aiDrafts: Map<string, RecordedDraft>;
  /** Replay clock: the moment the newest dispute snapshot was recorded. Countdowns are frozen here. */
  snapshotAt: string;
}

type Meta = { _meta?: { recorded_at?: string } };

function readDir<T>(dir: string): (T & Meta)[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => cleanDisplay(JSON.parse(readFileSync(path.join(dir, f), "utf8"))) as T & Meta);
}

/**
 * Display cleanup for the earliest sandbox fixtures (design review): they carry internal test
 * prefixes ("Spike: Ceramic mug set", invoice "DD-SPIKE-…"). Replay strips the "Spike:" prefix and
 * shows those invoices as "KC-…" (the demo store's prefix), applied consistently to every string
 * and key, so references still match. No data is invented: only the test prefix changes.
 */
export function cleanDisplay<T>(value: T): T {
  const s = (x: string) =>
    x
      .replace(/\bSpike:\s*/g, "")
      .replace(/\s*\(spike\)/g, "")
      .replace(/\bDD-SPIKE-(\d+)/g, "KC-$1")
      .replace(/^DD-SPIKE$/, "KC");
  if (typeof value === "string") return s(value) as T;
  if (Array.isArray(value)) return value.map(cleanDisplay) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [s(k), cleanDisplay(v)])) as T;
  return value;
}

export function loadFixtures(root = path.join(process.cwd(), "fixtures")): FixtureSet {
  const disputes = readDir<DisputeRecord>(path.join(root, "paypal/disputes"));
  const orders = readDir<OrderLike>(path.join(root, "paypal/orders"));
  const trackers = readDir<{ trackers?: PayPalTrackerLike[] }>(path.join(root, "paypal/trackers"));

  const ordersByCapture = new Map<string, OrderLike>();
  for (const o of orders) for (const c of o.purchase_units?.[0]?.payments?.captures ?? []) ordersByCapture.set(c.id, o);

  const trackersByCapture = new Map<string, PayPalTrackerLike[]>();
  for (const t of trackers) for (const tr of t.trackers ?? []) trackersByCapture.set(tr.transaction_id, [...(trackersByCapture.get(tr.transaction_id) ?? []), tr]);

  const snapshotAt = disputes.map((d) => d._meta?.recorded_at ?? "").sort().at(-1) || new Date(0).toISOString();
  const json = <T>(p: string, fallback: T): T => (existsSync(p) ? cleanDisplay(JSON.parse(readFileSync(p, "utf8")) as T) : fallback);

  const aiDrafts = readDir<RecordedDraft>(path.join(root, "ai/drafts"));
  return {
    aiDrafts: new Map(aiDrafts.map((r) => [r.disputeId, r])),
    disputes: new Map(disputes.map((d) => [d.dispute_id, d])),
    ordersByCapture,
    trackersByCapture,
    carrier: json<CarrierSampleFile>(path.join(root, "samples/carrier.json"), { trackings: {} }),
    store: json<StoreSampleFile>(path.join(root, "samples/store.json"), { orders: {} }),
    snapshotAt,
  };
}

let cached: FixtureSet | null = null;
export function fixtures(): FixtureSet {
  return (cached ??= loadFixtures());
}

/** "Reset demo": reload the recorded fixtures from disk on next use. */
export function resetFixtures() {
  cached = null;
}
