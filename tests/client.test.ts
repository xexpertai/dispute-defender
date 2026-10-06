import { describe, expect, it, vi } from "vitest";
import { PayPalApiError, PayPalClient } from "@/lib/paypal/client";
import { getPayPalConfig } from "@/lib/paypal/config";
import { scrub } from "@/lib/log/scrub";
import { fakeFetch, TOKEN_ROUTE } from "./helpers/fake-fetch";

const D = "https://api-m.sandbox.paypal.com/v1/customer/disputes";

describe("PayPalClient", () => {
  it("caches the OAuth token until shortly before expiry", async () => {
    let now = 1_000_000;
    const { fn, calls } = fakeFetch({ ...TOKEN_ROUTE, [`GET ${D}`]: () => ({ json: { items: [] } }) });
    const c = new PayPalClient(getPayPalConfig(), fn, () => now);
    await c.request("GET", "/v1/customer/disputes");
    await c.request("GET", "/v1/customer/disputes");
    expect(calls.filter((x) => x.url.endsWith("/oauth2/token"))).toHaveLength(1);
    now += 32400 * 1000; // past expiry
    await c.request("GET", "/v1/customer/disputes");
    expect(calls.filter((x) => x.url.endsWith("/oauth2/token"))).toHaveLength(2);
  });

  it("sets PayPal-Request-Id on POST (idempotency) and honours a supplied key", async () => {
    const { fn, calls } = fakeFetch({ ...TOKEN_ROUTE, [`POST ${D}/X/escalate`]: () => ({ json: {} }) });
    const c = new PayPalClient(getPayPalConfig(), fn);
    await c.request("POST", "/v1/customer/disputes/X/escalate", { json: { note: "n" } });
    await c.request("POST", "/v1/customer/disputes/X/escalate", { json: { note: "n" }, idempotencyKey: "fixed-key" });
    const posts = calls.filter((x) => x.url.endsWith("/escalate"));
    expect(posts[0].headers["PayPal-Request-Id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(posts[1].headers["PayPal-Request-Id"]).toBe("fixed-key");
    expect(posts[0].headers["Content-Type"]).toBe("application/json");
  });

  it("sends multipart with an application/json `input` part and file parts", async () => {
    const { fn, calls } = fakeFetch({ ...TOKEN_ROUTE, [`POST ${D}/X/provide-evidence`]: () => ({ json: {} }) });
    const c = new PayPalClient(getPayPalConfig(), fn);
    await c.request("POST", "/v1/customer/disputes/X/provide-evidence", {
      multipart: { input: { evidences: [{ evidence_type: "OTHER" }] }, files: [{ field: "evidence-file", filename: "pack.pdf", type: "application/pdf", data: new Uint8Array([37, 80, 68, 70]) }] },
    });
    const form = calls.at(-1)!.body as FormData;
    const input = form.get("input") as Blob;
    expect(input.type).toBe("application/json");
    expect(JSON.parse(await input.text())).toEqual({ evidences: [{ evidence_type: "OTHER" }] });
    const file = form.get("evidence-file") as File;
    expect(file.name).toBe("pack.pdf");
    expect(file.type).toBe("application/pdf");
  });

  it("raises PayPalApiError with issue + debug id", async () => {
    const { fn } = fakeFetch({
      ...TOKEN_ROUTE,
      [`POST ${D}/X/adjudicate`]: () => ({ status: 400, json: { name: "INVALID_REQUEST", details: [{ issue: "ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE" }] } }),
    });
    const c = new PayPalClient(getPayPalConfig(), fn);
    const err = await c.request("POST", "/v1/customer/disputes/X/adjudicate", { json: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err.issues).toEqual(["ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE"]);
    expect(err.debugId).toBe("dbg123");
  });

  it("never logs credentials or tokens", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { fn } = fakeFetch({ ...TOKEN_ROUTE, [`GET ${D}`]: () => ({ json: {} }) });
    const c = new PayPalClient(getPayPalConfig(), fn);
    await c.request("GET", "/v1/customer/disputes");
    const out = spy.mock.calls.flat().join("\n");
    spy.mockRestore();
    expect(out).not.toContain("test-client-secret-0000");
    expect(out).not.toContain("A21AA-fake-access-token-xyz");
    expect(scrub({ Authorization: "Bearer A21AA-fake-access-token-xyz", secret: "test-client-secret-0000" })).not.toMatch(/A21AA|test-client-secret/);
  });
});
