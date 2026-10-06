import { randomUUID } from "node:crypto";
import { assertSandboxUrl, getPayPalConfig, type PayPalConfig } from "./config";
import { log, registerSecret } from "../log/scrub";

/** Minimal PayPal REST client: sandbox-only, token cache, idempotency, typed errors. */

export interface PayPalResponse<T = unknown> {
  status: number;
  data: T;
  debugId: string | null;
}

export class PayPalApiError extends Error {
  constructor(
    readonly status: number,
    readonly debugId: string | null,
    readonly paypalName: string | undefined,
    readonly issues: string[],
    readonly body: unknown,
  ) {
    super(`PayPal ${status} ${paypalName ?? ""} ${issues.join(",")}`.trim());
    this.name = "PayPalApiError";
  }
}

export interface RequestOptions {
  /** JSON body (sent as application/json). */
  json?: unknown;
  /** Multipart body: `input` JSON part plus optional files (Disputes API style). */
  multipart?: { input: unknown; files?: { field: string; filename: string; type: string; data: Uint8Array }[] };
  headers?: Record<string, string>;
  /** Sets PayPal-Request-Id; defaults to a random UUID for POSTs. */
  idempotencyKey?: string;
}

type FetchFn = typeof fetch;

export class PayPalClient {
  private token: { value: string; expiresAt: number; scopes: string[] } | null = null;

  constructor(
    private readonly config: PayPalConfig = getPayPalConfig(),
    private readonly fetchFn: FetchFn = fetch,
    private readonly now: () => number = Date.now,
  ) {
    assertSandboxUrl(config.baseUrl);
    registerSecret(config.clientSecret);
    registerSecret(config.clientId);
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const url = `${this.config.baseUrl}/v1/oauth2/token`;
    assertSandboxUrl(url);
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const res = await this.fetchFn(url, {
      method: "POST",
      body: "grant_type=client_credentials",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!res.ok) throw new PayPalApiError(res.status, res.headers.get("paypal-debug-id"), "OAUTH_FAILED", [], null);
    const body = (await res.json()) as { access_token: string; expires_in: number; scope?: string };
    registerSecret(body.access_token);
    this.token = {
      value: body.access_token,
      expiresAt: this.now() + body.expires_in * 1000,
      scopes: (body.scope ?? "").split(" ").filter(Boolean),
    };
    return this.token.value;
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<PayPalResponse<T>> {
    const url = `${this.config.baseUrl}${path}`;
    assertSandboxUrl(url);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.getAccessToken()}`,
      ...opts.headers,
    };
    if (method === "POST") headers["PayPal-Request-Id"] = opts.idempotencyKey ?? randomUUID();

    let body: BodyInit | undefined;
    if (opts.multipart) {
      const form = new FormData();
      form.append("input", new Blob([JSON.stringify(opts.multipart.input)], { type: "application/json" }));
      for (const f of opts.multipart.files ?? []) {
        form.append(f.field, new Blob([f.data as BlobPart], { type: f.type }), f.filename);
      }
      body = form; // fetch sets the multipart boundary header
    } else if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    }

    const started = this.now();
    const res = await this.fetchFn(url, { method, headers, body });
    const debugId = res.headers.get("paypal-debug-id");
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    log.info(`[paypal] ${method} ${path} -> ${res.status} (${this.now() - started}ms) debug_id=${debugId ?? "-"}`);
    if (!res.ok) {
      const err = (data ?? {}) as { name?: string; details?: { issue?: string }[] };
      const issues = (err.details ?? []).map((d) => d.issue).filter((i): i is string => Boolean(i));
      throw new PayPalApiError(res.status, debugId, err.name, issues, data);
    }
    return { status: res.status, data: data as T, debugId };
  }
}

let shared: PayPalClient | null = null;
/** Process-wide client (server only). */
export function getPayPalClient(): PayPalClient {
  shared ??= new PayPalClient();
  return shared;
}
