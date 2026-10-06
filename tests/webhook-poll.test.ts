import { describe, expect, it } from "vitest";
import { ReplayGateway } from "@/lib/agent/gateway";
import { pollOnce } from "@/lib/agent/poller";
import { disputeIdOf, verifyWebhook } from "@/lib/paypal/webhooks";
import { loadFixtures } from "@/lib/replay/fixtures";
import { openDb } from "@/lib/store/db";
import { upsertDispute } from "@/lib/store/repo";

const headers = (over: Record<string, string | null> = {}) => {
  const h = new Headers({
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    "paypal-transmission-id": "tid",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-10-06T10:00:00Z",
  });
  for (const [k, v] of Object.entries(over)) {
    if (v === null) h.delete(k);
    else h.set(k, v);
  }
  return h;
};

describe("webhook verification", () => {
  const event = { id: "WH-1", event_type: "CUSTOMER.DISPUTE.UPDATED", resource: { dispute_id: "PP-R-MQR-10190375" } };

  it("asks PayPal to verify with every transmission header and the webhook id", async () => {
    const sent: unknown[] = [];
    const client = { request: async (_m: string, _p: string, o: { json?: unknown }) => (sent.push(o.json), { status: 200, debugId: null, data: { verification_status: "SUCCESS" } }) };
    expect(await verifyWebhook(client as never, headers(), event, "WH-ID")).toBe(true);
    expect(sent[0]).toMatchObject({ auth_algo: "SHA256withRSA", transmission_id: "tid", webhook_id: "WH-ID", webhook_event: event });
  });

  it("fails closed on FAILURE or missing headers (no PayPal call)", async () => {
    let calls = 0;
    const client = { request: async () => (calls++, { status: 200, debugId: null, data: { verification_status: "FAILURE" } }) };
    expect(await verifyWebhook(client as never, headers(), event, "WH-ID")).toBe(false);
    expect(await verifyWebhook(client as never, headers({ "paypal-transmission-sig": null }), event, "WH-ID")).toBe(false);
    expect(calls).toBe(1);
  });

  it.each([
    ["CUSTOMER.DISPUTE.CREATED", "PP-1"],
    ["CUSTOMER.DISPUTE.RESOLVED", "PP-1"],
    ["PAYMENT.CAPTURE.COMPLETED", undefined],
  ])("%s → dispute %s", (type, id) => {
    expect(disputeIdOf({ event_type: type, resource: { dispute_id: "PP-1" } })).toBe(id);
  });
});

describe("polling fallback", () => {
  it("reports new disputes, then only status changes", async () => {
    const f = loadFixtures();
    const db = openDb(":memory:");
    const gw = new ReplayGateway(f);
    expect((await pollOnce(gw, db)).map((c) => c.kind)).toEqual(["new", "new", "new", "new"]);
    expect(await pollOnce(gw, db)).toEqual([]);
    upsertDispute(db, { ...f.disputes.get("PP-R-PLP-10190379")!, status: "UNDER_REVIEW" }, "replay");
    expect(await pollOnce(gw, db)).toEqual([{ id: "PP-R-PLP-10190379", from: "UNDER_REVIEW", to: "WAITING_FOR_SELLER_RESPONSE", kind: "status" }]);
  });
});
