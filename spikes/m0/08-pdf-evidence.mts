// Real-sandbox check of the M1 adapter: provide evidence WITH a PDF file via lib/paypal/disputes.
// Usage: tsx --env-file=../../.env.local 08-pdf-evidence.mts <dispute_id>
import { PayPalClient } from "../../lib/paypal/client";
import { getDispute, runCustomDisputeTool } from "../../lib/paypal/disputes";
import { availableActions } from "../../lib/paypal/links";

const id = process.argv[2];
const pdf = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
    "4 0 obj<</Length 58>>stream\nBT /F1 14 Tf 20 100 Td (Dispute Defender evidence pack) Tj ET\nendstream endobj\n" +
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
const client = new PayPalClient();
for (let i = 0; i < 30; i++) {
  const d = await getDispute(client, id);
  console.log(new Date().toISOString().slice(11, 19), d.status, availableActions(d).join(","));
  if (availableActions(d).includes("provide_evidence")) break;
  await new Promise((r) => setTimeout(r, 20000));
}
const r = await runCustomDisputeTool(client, "provide_dispute_evidence", {
  dispute_id: id,
  evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", evidence_info: { tracking_info: [{ carrier_name: "USPS", tracking_number: "9400111899223197428491" }] }, notes: "M1 adapter check: tracking + evidence pack PDF attached." }],
  files: [{ filename: "evidence-pack.pdf", type: "application/pdf", data: pdf }],
});
console.log("provide-evidence with PDF:", r.status, r.debugId);
const after = await getDispute(client, id);
const ev = (after.evidences as { evidence_type: string; source: string; documents?: { name: string }[] }[] | undefined) ?? [];
console.log("seller evidences:", JSON.stringify(ev.filter((e) => e.source === "SUBMITTED_BY_SELLER").map((e) => ({ type: e.evidence_type, docs: e.documents?.map((d) => d.name) }))));
