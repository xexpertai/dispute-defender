import type { DisputeRecord } from "../disputes/model";
import type { RecordedDraft } from "../llm/recorded";

/**
 * Rewind a recorded dispute to an earlier moment (fixtures/paypal/rewind/<id>.json).
 *
 * Why: a case we worked live in the sandbox (the one in the video) has since been decided, so its
 * recording is RESOLVED. Replay can show it as the agent saw it before the decision by dropping every
 * event at or after `before` and restoring the status and links PayPal showed then. Nothing else in
 * the recorded response changes, and the UI labels the view as rewound.
 */
export interface RewindSpec {
  _meta?: Record<string, string>;
  dispute_id: string;
  /** ISO time: events at or after this are dropped. */
  before: string;
  status: string;
  dispute_state?: string;
  /** HATEOAS rels PayPal listed at that moment (the `self` link is kept from the recording). */
  rels: string[];
  /** The capture's status at that moment (e.g. PENDING / BUYER_COMPLAINT while PayPal held the funds). */
  capture?: { id: string; status: string; status_details?: { reason?: string } };
  /** The real Claude draft recorded on the case at that moment, replayed at $0. */
  aiDraft?: RecordedDraft;
}

type Capture = { id?: string; status?: string; status_details?: unknown; update_time?: string };
type OrderShape = { purchase_units?: { payments?: { captures?: Capture[] } }[] };

/** The order as read at the rewind moment: only the named capture's status changes. */
export function rewindOrder<T>(order: T, spec: RewindSpec): T {
  if (!spec.capture) return order;
  const o = structuredClone(order) as T & OrderShape;
  for (const pu of o.purchase_units ?? [])
    for (const c of pu.payments?.captures ?? [])
      if (c.id === spec.capture.id) {
        c.status = spec.capture.status;
        if (spec.capture.status_details) c.status_details = spec.capture.status_details;
        else delete c.status_details;
        if (c.update_time && c.update_time >= spec.before) delete c.update_time;
      }
  return o;
}

const before = (at: string | undefined, cutoff: string) => !at || at < cutoff;

export function rewindDispute(rec: DisputeRecord, spec: RewindSpec): DisputeRecord {
  const r = structuredClone(rec) as DisputeRecord & Record<string, unknown>;
  const cutoff = spec.before;
  const keep = <T,>(key: string, timeOf: (x: T) => string | undefined) => {
    const list = r[key] as T[] | null | undefined;
    if (!Array.isArray(list)) return;
    const kept = list.filter((x) => before(timeOf(x), cutoff));
    r[key] = kept.length ? kept : null;
  };
  keep<{ adjudication_time?: string }>("adjudications", (x) => x.adjudication_time);
  keep<{ initiated_time?: string }>("fund_movements", (x) => x.initiated_time);
  keep<{ provided_time?: string }>("supporting_info", (x) => x.provided_time);
  keep<{ date?: string }>("evidences", (x) => x.date);
  keep<{ time_posted?: string }>("messages", (x) => x.time_posted);
  delete r.dispute_outcome;
  delete r.update_time;
  r.status = spec.status;
  if (spec.dispute_state) r.dispute_state = spec.dispute_state;
  const self = (rec.links ?? []).find((l) => l.rel === "self");
  const base = self?.href ?? `https://api-m.sandbox.paypal.com/v1/customer/disputes/${rec.dispute_id}`;
  r.links = [...(self ? [self] : []), ...spec.rels.map((rel) => ({ href: `${base}/${rel.replace(/_/g, "-")}`, rel, method: "POST" }))];
  r._meta = { ...((rec as { _meta?: object })._meta ?? {}), rewound_to: cutoff } as never;
  return r;
}
