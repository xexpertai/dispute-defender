import type { DisputeRecord } from "../disputes/model";
import type { PayPalResponse, RequestOptions } from "../paypal/client";

/**
 * A stand-in for PayPalClient that answers from the Replay fixtures (recorded, redacted PayPal sandbox
 * responses), so the MCP server runs with no keys and no network (`npm run mcp:replay`).
 *  - GET list / get dispute: served from the fixtures.
 *  - POST (a write tool): never sent. The call is captured and returned as the would-be request.
 */
export interface CapturedRequest {
  method: string;
  endpoint: string;
  body: unknown;
}

export class ReplayPayPalClient {
  /** Writes the tools tried to make, in order (never sent anywhere). */
  readonly captured: CapturedRequest[] = [];

  constructor(private readonly disputes: Map<string, DisputeRecord>) {}

  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<PayPalResponse<T>> {
    if (method === "POST") {
      this.captured.push({ method, endpoint: path, body: opts.multipart ? { input: opts.multipart.input, files: (opts.multipart.files ?? []).map((f) => f.filename) } : (opts.json ?? null) });
      return { status: 0, debugId: null, data: {} as T };
    }
    if (method === "GET" && path.startsWith("/v1/customer/disputes?")) {
      const state = new URL(path, "https://replay.invalid").searchParams.get("dispute_state");
      const items = [...this.disputes.values()].filter((d) => !state || d.status === state);
      return { status: 200, debugId: null, data: { items } as T };
    }
    const m = /^\/v1\/customer\/disputes\/([^/?]+)$/.exec(path);
    if (method === "GET" && m) {
      const d = this.disputes.get(m[1]);
      if (!d) throw Object.assign(new Error(`Dispute ${m[1]} is not in the Replay fixtures (try list_disputes).`), { status: 404 });
      return { status: 200, debugId: null, data: d as T };
    }
    throw Object.assign(new Error(`Not available in Replay: ${method} ${path}`), { status: 404 });
  }
}
