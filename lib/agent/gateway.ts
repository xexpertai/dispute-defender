import type { OrderLike, PayPalTrackerLike } from "../evidence/sources";
import type { DisputeRecord } from "../disputes/model";
import type { PayPalClient } from "../paypal/client";
import { redactObject } from "../redact";
import type { PayPalCallBadge } from "./trace";

/**
 * Read-only PayPal access for the agent and dashboard. Two implementations share one shape so
 * the UI and the trace look identical, but every badge says honestly where the data came from:
 *   ReplayGateway: recorded, redacted sandbox responses (no network)
 *   LiveGateway:   real sandbox GETs through the sandbox-forced PayPalClient
 * Writes (evidence, offers, messages) are not here: they need an approval record first (M3).
 */
export interface Fetched<T> {
  data: T;
  calls: PayPalCallBadge[];
}

export interface DisputeGateway {
  readonly mode: "live" | "replay";
  /** The app clock. Replay freezes it at the snapshot time so countdowns match the data. */
  now(): Date;
  listDisputes(): Promise<DisputeRecord[]>;
  getDispute(id: string): Promise<Fetched<DisputeRecord | null>>;
  findOrderByCapture(captureId: string): Promise<Fetched<OrderLike | null>>;
  getTrackers(captureId: string): Promise<Fetched<PayPalTrackerLike[]>>;
}

export const ENDPOINTS = {
  listDisputes: { method: "GET", endpoint: "/v1/customer/disputes", api: "Disputes" },
  getDispute: { method: "GET", endpoint: "/v1/customer/disputes/{id}", api: "Disputes" },
  getCapture: { method: "GET", endpoint: "/v2/payments/captures/{id}", api: "Payments" },
  getOrder: { method: "GET", endpoint: "/v2/checkout/orders/{id}", api: "Orders" },
  listTrackers: { method: "GET", endpoint: "/v1/shipping/trackers", api: "Tracking" },
} as const satisfies Record<string, Omit<PayPalCallBadge, "status">>;

type Ep = keyof typeof ENDPOINTS;

// ------------------------------------------------------------------------------------- replay

export interface ReplayData {
  disputes: Map<string, DisputeRecord>;
  ordersByCapture: Map<string, OrderLike>;
  trackersByCapture: Map<string, PayPalTrackerLike[]>;
  snapshotAt: string;
}

export class ReplayGateway implements DisputeGateway {
  readonly mode = "replay" as const;
  constructor(private readonly data: ReplayData) {}

  private call(ep: Ep, found: boolean): PayPalCallBadge {
    return { ...ENDPOINTS[ep], status: found ? 200 : 404, source: "replay" };
  }

  now() {
    return new Date(this.data.snapshotAt);
  }

  async listDisputes() {
    return [...this.data.disputes.values()];
  }

  async getDispute(id: string) {
    const d = this.data.disputes.get(id) ?? null;
    return { data: d, calls: [this.call("getDispute", Boolean(d))] };
  }

  async findOrderByCapture(captureId: string) {
    const o = this.data.ordersByCapture.get(captureId) ?? null;
    return { data: o, calls: [this.call("getCapture", Boolean(o)), ...(o ? [this.call("getOrder", true)] : [])] };
  }

  async getTrackers(captureId: string) {
    return { data: this.data.trackersByCapture.get(captureId) ?? [], calls: [this.call("listTrackers", true)] };
  }
}

// --------------------------------------------------------------------------------------- live

const RESOLVED_CACHE = new Map<string, DisputeRecord>();

export class LiveGateway implements DisputeGateway {
  readonly mode = "live" as const;
  constructor(
    private readonly client: PayPalClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  now() {
    return this.clock();
  }

  private async get<T>(ep: Ep, path: string): Promise<{ data: T | null; call: PayPalCallBadge }> {
    const started = Date.now();
    try {
      const res = await this.client.request<T>("GET", path);
      return { data: redactObject(res.data), call: { ...ENDPOINTS[ep], status: res.status, debugId: res.debugId, ms: Date.now() - started, source: "live" } };
    } catch (err) {
      const e = err as { status?: number; debugId?: string | null };
      if (e.status === 404) return { data: null, call: { ...ENDPOINTS[ep], status: 404, debugId: e.debugId ?? null, ms: Date.now() - started, source: "live" } };
      throw err;
    }
  }

  /**
   * The list endpoint returns summaries (no links, deadlines or outcome), so each dispute is re-read
   * with a details GET. Resolved disputes never change, so their details are cached per process.
   */
  async listDisputes() {
    const { data } = await this.get<{ items?: DisputeRecord[] }>("listDisputes", "/v1/customer/disputes?page_size=50");
    const items = data?.items ?? [];
    return Promise.all(
      items.map(async (d) => {
        const cached = RESOLVED_CACHE.get(d.dispute_id);
        if (cached) return cached;
        const full = (await this.getDispute(d.dispute_id)).data ?? d;
        if (full.status === "RESOLVED") RESOLVED_CACHE.set(d.dispute_id, full);
        return full;
      }),
    );
  }

  async getDispute(id: string) {
    const { data, call } = await this.get<DisputeRecord>("getDispute", `/v1/customer/disputes/${encodeURIComponent(id)}`);
    return { data, calls: [call] };
  }

  async findOrderByCapture(captureId: string) {
    const cap = await this.get<{ links?: { rel: string; href: string }[] }>("getCapture", `/v2/payments/captures/${encodeURIComponent(captureId)}`);
    const orderId = cap.data?.links?.find((l) => l.rel === "up")?.href.split("/").pop();
    if (!orderId) return { data: null, calls: [cap.call] };
    const order = await this.get<OrderLike>("getOrder", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    return { data: order.data, calls: [cap.call, order.call] };
  }

  async getTrackers(captureId: string) {
    const { data, call } = await this.get<{ trackers?: PayPalTrackerLike[] }>("listTrackers", `/v1/shipping/trackers?transaction_id=${encodeURIComponent(captureId)}`);
    return { data: data?.trackers ?? [], calls: [call] };
  }
}
