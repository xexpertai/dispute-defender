import { describe, expect, it } from "vitest";
import { PayPalClient } from "@/lib/paypal/client";
import { getPayPalConfig } from "@/lib/paypal/config";
import { runCustomDisputeTool, sandboxSimulate } from "@/lib/paypal/disputes";
import { ActionNotAllowedError, availableActions } from "@/lib/paypal/links";
import { customToolsToClaude, toolkitToolToClaude, createSandboxToolkit } from "@/lib/paypal/toolkit";
import { fakeFetch, TOKEN_ROUTE } from "./helpers/fake-fetch";

const D = "https://api-m.sandbox.paypal.com/v1/customer/disputes";
const dispute = (rels: string[]) => ({ dispute_id: "PP-R-TEST-1", links: rels.map((rel) => ({ rel })) });

describe("HATEOAS gate", () => {
  it("lists only known actions present in links (rels use underscores)", () => {
    expect(availableActions(dispute(["self", "make_offer", "provide_evidence", "weird"]))).toEqual(["make_offer", "provide_evidence"]);
  });

  it("refuses a write when the link is missing and never calls the action endpoint", async () => {
    const { fn, calls } = fakeFetch({ ...TOKEN_ROUTE, [`GET ${D}/PP-R-TEST-1`]: () => ({ json: dispute(["self", "provide_supporting_info"]) }) });
    const c = new PayPalClient(getPayPalConfig(), fn);
    await expect(sandboxSimulate(c, "PP-R-TEST-1", { kind: "adjudicate", outcome: "SELLER_FAVOR" })).rejects.toBeInstanceOf(ActionNotAllowedError);
    await expect(runCustomDisputeTool(c, "escalate_dispute", { dispute_id: "PP-R-TEST-1", note: "x" })).rejects.toThrow(/escalate/);
    expect(calls.some((x) => x.method === "POST" && x.url.startsWith(D))).toBe(false);
  });
});

describe("custom dispute tools", () => {
  it("provide evidence → multipart input with tracking (shape verified in sandbox M0)", async () => {
    const { fn, calls } = fakeFetch({
      ...TOKEN_ROUTE,
      [`GET ${D}/PP-R-TEST-1`]: () => ({ json: dispute(["provide_evidence"]) }),
      [`POST ${D}/PP-R-TEST-1/provide-evidence`]: () => ({ json: {} }),
    });
    const c = new PayPalClient(getPayPalConfig(), fn);
    await runCustomDisputeTool(c, "provide_dispute_evidence", {
      dispute_id: "PP-R-TEST-1",
      evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", evidence_info: { tracking_info: [{ carrier_name: "USPS", tracking_number: "9400" }] }, notes: "Delivered" }],
      files: [{ filename: "pack.pdf", type: "application/pdf", data: new Uint8Array([1, 2, 3]) }],
    });
    const form = calls.at(-1)!.body as FormData;
    const input = JSON.parse(await (form.get("input") as Blob).text());
    expect(input).toEqual({ evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", evidence_info: { tracking_info: [{ carrier_name: "USPS", tracking_number: "9400" }] }, notes: "Delivered" }] });
    expect(input.dispute_id).toBeUndefined();
    expect((form.get("evidence-file") as File).name).toBe("pack.pdf");
  });

  it("provide supporting info → multipart notes + the pack, only while PayPal offers the link", async () => {
    const { fn, calls } = fakeFetch({
      ...TOKEN_ROUTE,
      [`GET ${D}/PP-R-TEST-1`]: () => ({ json: dispute(["provide_supporting_info"]) }),
      [`POST ${D}/PP-R-TEST-1/provide-supporting-info`]: () => ({ json: {} }),
    });
    const c = new PayPalClient(getPayPalConfig(), fn);
    await runCustomDisputeTool(c, "provide_dispute_supporting_info", { dispute_id: "PP-R-TEST-1", notes: "Delivered, signed", files: [{ filename: "pack.pdf", type: "application/pdf", data: new Uint8Array([1]) }] });
    const form = calls.at(-1)!.body as FormData;
    expect(JSON.parse(await (form.get("input") as Blob).text())).toEqual({ notes: "Delivered, signed" });
    expect((form.get("file1") as File).name).toBe("pack.pdf");
    const { fn: fn2 } = fakeFetch({ ...TOKEN_ROUTE, [`GET ${D}/PP-R-TEST-1`]: () => ({ json: dispute(["accept_claim"]) }) });
    await expect(runCustomDisputeTool(new PayPalClient(getPayPalConfig(), fn2), "provide_dispute_supporting_info", { dispute_id: "PP-R-TEST-1", notes: "x" })).rejects.toThrow(/provide_supporting_info/);
  });

  it("make offer → JSON body; rejects unknown offer types and bad amounts", async () => {
    const { fn, calls } = fakeFetch({
      ...TOKEN_ROUTE,
      [`GET ${D}/PP-R-TEST-1`]: () => ({ json: dispute(["make_offer"]) }),
      [`POST ${D}/PP-R-TEST-1/make-offer`]: () => ({ json: {} }),
    });
    const c = new PayPalClient(getPayPalConfig(), fn);
    await runCustomDisputeTool(c, "make_dispute_offer", { dispute_id: "PP-R-TEST-1", note: "Partial refund", offer_type: "REFUND", offer_amount: { currency_code: "USD", value: "5.00" } });
    expect(JSON.parse(calls.at(-1)!.body as string)).toEqual({ note: "Partial refund", offer_type: "REFUND", offer_amount: { currency_code: "USD", value: "5.00" } });
    await expect(runCustomDisputeTool(c, "make_dispute_offer", { dispute_id: "PP-R-TEST-1", note: "x", offer_type: "FREE_MONEY" })).rejects.toThrow();
    await expect(runCustomDisputeTool(c, "make_dispute_offer", { dispute_id: "PP-R-TEST-1", note: "x", offer_type: "REFUND", offer_amount: { currency_code: "USD", value: "5,00" } })).rejects.toThrow();
  });

  it("rejects evidence files >= 10 MB before calling PayPal", async () => {
    const { fn, calls } = fakeFetch({ ...TOKEN_ROUTE, [`GET ${D}/PP-R-TEST-1`]: () => ({ json: dispute(["provide_evidence"]) }) });
    const c = new PayPalClient(getPayPalConfig(), fn);
    const big = new Uint8Array(10 * 1024 * 1024);
    await expect(
      runCustomDisputeTool(c, "provide_dispute_evidence", { dispute_id: "PP-R-TEST-1", evidences: [{ evidence_type: "OTHER" }], files: [{ filename: "big.pdf", type: "application/pdf", data: big }] }),
    ).rejects.toThrow(/10 MB/);
    expect(calls.some((x) => x.method === "POST" && x.url.includes("provide-evidence"))).toBe(false);
  });

  it("rejects path-injection in dispute ids", async () => {
    const { fn } = fakeFetch({ ...TOKEN_ROUTE });
    const c = new PayPalClient(getPayPalConfig(), fn);
    await expect(runCustomDisputeTool(c, "escalate_dispute", { dispute_id: "../../v1/payments", note: "x" })).rejects.toThrow();
  });
});

describe("Claude tool bridge", () => {
  it("converts toolkit tools to Claude tools without $schema", () => {
    const tk = createSandboxToolkit("token");
    const names = tk.tools.map((t) => t.method);
    expect(names).toEqual(expect.arrayContaining(["list_disputes", "get_dispute", "accept_dispute_claim", "create_shipment_tracking", "get_shipment_tracking", "list_transactions", "get_order"]));
    const getDispute = toolkitToolToClaude(tk.tools.find((t) => t.method === "get_dispute")!);
    expect(getDispute.input_schema).toMatchObject({ type: "object", required: ["dispute_id"] });
    expect(getDispute.input_schema).not.toHaveProperty("$schema");
  });

  it("exposes custom tools to Claude without binary file params", () => {
    const tools = customToolsToClaude();
    expect(tools.map((t) => t.name)).toEqual(["provide_dispute_evidence", "provide_dispute_supporting_info", "make_dispute_offer", "send_dispute_message", "escalate_dispute", "acknowledge_return_item", "accept_dispute_claim_with_terms"]);
    const pe = tools.find((t) => t.name === "provide_dispute_evidence")!;
    expect(Object.keys((pe.input_schema as { properties: object }).properties)).toEqual(["dispute_id", "evidences"]);
  });
});
