import { describe, expect, it } from "vitest";
import { redactObject, redactText } from "@/lib/redact";

describe("redactText", () => {
  it.each([
    ["Contact me at jane.doe+shop@gmail.com please", "Contact me at [email] please"],
    ["Call +1 (415) 555-0100 or 415-555-0100", "Call [phone] or [phone]"],
    ["Ship to 1234 Main St, Apt 5B, Springfield", "Ship to [address], Springfield"],
    ["I live at 55 W. 3rd Avenue", "I live at [address]"],
  ])("%s", (input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  it("keeps order ids, tracking numbers, amounts and dates", () => {
    const s = "Order 5O190127TN364715T, tracking 9400111899223197428490, $12.50 on 2026-10-05";
    expect(redactText(s)).toBe(s);
  });
});

describe("redactObject", () => {
  it("redacts PayPal buyer/seller PII but keeps business fields and ZIP", () => {
    const input = {
      dispute_id: "PP-R-CMR-10190364",
      disputed_transactions: [
        {
          buyer: { name: "Jane Doe", email: "sb-buyer@personal.example.com", payer_id: "ABCDEF123" },
          seller: { email: "sb-seller@business.example.com", merchant_id: "PP3ZW4ZZTWWNY", name: "Test Store" },
          seller_transaction_id: "72C200774H985740J",
          items: [{ item_name: "Ceramic mug set", name: "Mug" }],
        },
      ],
      shipping: { name: { full_name: "Jane Doe" }, address: { address_line_1: "1 Infinite Loop", admin_area_2: "Cupertino", postal_code: "95014", country_code: "US" } },
      messages: [{ posted_by: "BUYER", content: "Email me at jane@x.com, I'm at 22 Elm Street" }],
      links: [{ rel: "self", href: "https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-R-CMR-10190364" }],
    };
    const out = redactObject(input);
    const s = JSON.stringify(out);
    for (const pii of ["Jane", "sb-buyer", "sb-seller", "ABCDEF123", "Infinite Loop", "Cupertino", "jane@x.com", "22 Elm"]) expect(s).not.toContain(pii);
    expect(out.disputed_transactions[0].seller_transaction_id).toBe("72C200774H985740J");
    expect(out.disputed_transactions[0].items[0]).toEqual({ item_name: "Ceramic mug set", name: "Mug" });
    expect(out.shipping.address.postal_code).toBe("95014");
    expect(out.links[0].href).toContain("PP-R-CMR-10190364");
  });

  it("leaves timestamps alone (PayPal trackers use epoch-millis strings)", () => {
    const out = redactObject({ last_updated_time: "1791214066000", create_time: "2026-10-05T15:27:46.000Z", shipment_date: "2026-10-05", note: "call 4155550100" });
    expect(out).toEqual({ last_updated_time: "1791214066000", create_time: "2026-10-05T15:27:46.000Z", shipment_date: "2026-10-05", note: "call [phone]" });
  });
});
