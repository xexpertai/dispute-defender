// One off-camera sandbox check of provide-supporting-info (multipart: input={notes} + a tiny PDF).
// Usage: npx tsx --env-file=.env.local scripts/supporting-info-test.mts <dispute_id> "<notes>"
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PayPalClient } from "../lib/paypal/client";
import { runCustomDisputeTool } from "../lib/paypal/disputes";

const [id, notes] = process.argv.slice(2);
if (!id || !notes) throw new Error("usage: <dispute_id> <notes>");
const doc = await PDFDocument.create();
const page = doc.addPage([400, 200]);
page.drawText("Kiln & Clay Studio: supporting information (sandbox test)", { x: 20, y: 160, size: 11, font: await doc.embedFont(StandardFonts.Helvetica) });
page.drawText(notes.slice(0, 80), { x: 20, y: 130, size: 9 });
const data = await doc.save();
const res = await runCustomDisputeTool(new PayPalClient(), "provide_dispute_supporting_info", { dispute_id: id, notes, files: [{ filename: "supporting-info.pdf", type: "application/pdf", data }] });
console.log(`provide-supporting-info ${id}: ${res.status} debug_id=${res.debugId}`);
