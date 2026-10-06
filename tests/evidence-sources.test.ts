import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fromCarrierTracking, fromChat, fromDispute, fromOrder, fromPayPalTrackers, fromStoreLog } from "@/lib/evidence/sources";

const fixture = (id: string) => JSON.parse(readFileSync(path.resolve(import.meta.dirname, `../fixtures/paypal/disputes/${id}.json`), "utf8"));

describe("evidence sources", () => {
  it("maps a recorded sandbox dispute to a summary + messages with stable refs", () => {
    const items = fromDispute(fixture("PP-R-CMR-10190364"));
    expect(items[0]).toMatchObject({ sourceRef: "dispute:PP-R-CMR-10190364", kind: "dispute", facts: { amount: 12, currency: "USD" } });
    expect(items[1]).toMatchObject({ sourceRef: "dispute:PP-R-CMR-10190364#msg0", kind: "dispute_message", facts: { postedBy: "SELLER" } });
    expect(fromDispute(fixture("PP-R-CMR-10190364")).map((i) => i.sourceRef)).toEqual(items.map((i) => i.sourceRef));
  });

  it("maps an Orders v2 order and its capture (ZIP kept, address never present)", () => {
    const items = fromOrder({
      id: "810133174W798673R",
      create_time: "2026-10-05T14:40:00Z",
      purchase_units: [
        {
          invoice_id: "DD-1",
          description: "Ceramic mug set",
          amount: { value: "12.00", currency_code: "USD" },
          shipping: { address: { postal_code: "95131", country_code: "US" } },
          payments: { captures: [{ id: "72C200774H985740J", status: "COMPLETED", amount: { value: "12.00", currency_code: "USD" }, seller_protection: { status: "ELIGIBLE" } }] },
        },
      ],
    });
    expect(items.map((i) => i.sourceRef)).toEqual(["order:810133174W798673R", "capture:72C200774H985740J"]);
    expect(items[0].facts).toMatchObject({ amount: 12, shipToPostalCode: "95131", shipToCountry: "US" });
    expect(items[1].facts.sellerProtection).toBe("ELIGIBLE");
  });

  it("sorts carrier events chronologically and numbers them", () => {
    const items = fromCarrierTracking({
      carrier: "USPS",
      trackingNumber: "9400111899223197428490",
      events: [
        { code: "DELIVERED", at: "2026-10-03T18:00:00Z", postalCode: "95131", signature: true },
        { code: "LABEL_CREATED", at: "2026-09-30T10:00:00Z" },
        { code: "IN_TRANSIT", at: "2026-10-01T09:00:00Z" },
      ],
    });
    expect(items.map((i) => [i.sourceRef, i.facts.eventCode])).toEqual([
      ["track:USPS:9400111899223197428490#ev0", "LABEL_CREATED"],
      ["track:USPS:9400111899223197428490#ev1", "IN_TRANSIT"],
      ["track:USPS:9400111899223197428490#ev2", "DELIVERED"],
    ]);
    expect(items[2].label).toBe("USPS scan: Delivered (95131)");
    expect(items[2].text).toContain("signature obtained");
  });

  it("maps PayPal tracking records, store logs and chat with redaction", () => {
    expect(fromPayPalTrackers([{ transaction_id: "72C200774H985740J", tracking_number: "9400", carrier: "USPS" }])[0].sourceRef).toBe("pptrack:72C200774H985740J:9400");
    const store = fromStoreLog("DD-1", [{ author: "system", text: "Shipped to jane@x.com at 22 Elm Street", tags: { buyerPriorOrders: 3 } }]);
    expect(store[0]).toMatchObject({ sourceRef: "store:DD-1#line0", facts: { buyerPriorOrders: 3 } });
    expect(store[0].text).toBe("Shipped to [email] at [address]");
    const chat = fromChat("t1", [{ author: "seller", text: "Sorry, we sent the wrong size", tags: { sellerAdmitsFault: true } }]);
    expect(chat[0]).toMatchObject({ sourceRef: "chat:t1#line0", label: "Seller chat", facts: { sellerAdmitsFault: true } });
  });
});

describe("PayPal tracker timestamps", () => {
  it("normalises epoch-millis strings to ISO so the timeline sorts correctly", async () => {
    const { toIso, fromPayPalTrackers } = await import("@/lib/evidence/sources");
    expect(toIso("1791226556899")).toBe(new Date(1791226556899).toISOString());
    expect(toIso("2026-10-05T18:00:00Z")).toBe("2026-10-05T18:00:00Z");
    expect(toIso("garbage")).toBeUndefined();
    expect(fromPayPalTrackers([{ transaction_id: "C", tracking_number: "1", carrier: "USPS", last_updated_time: "1791226556899" }])[0].at).toMatch(/^2026-10-05T/);
  });
});

describe("capture on hold", () => {
  it("explains a PENDING capture held for a buyer complaint instead of calling it a pending payment", async () => {
    const { fromOrder } = await import("@/lib/evidence/sources");
    const items = fromOrder({ id: "O", purchase_units: [{ amount: { value: "12.75", currency_code: "USD" }, payments: { captures: [{ id: "C1", status: "PENDING", status_details: { reason: "BUYER_COMPLAINT" }, amount: { value: "12.75", currency_code: "USD" }, seller_protection: { status: "ELIGIBLE" } }] } }] });
    expect(items[1]).toMatchObject({ label: "Payment captured · funds on hold" });
    expect(items[1].text).toMatch(/holding the funds while the buyer's complaint is open/);
  });
});
