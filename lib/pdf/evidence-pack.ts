import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { PROVENANCE_LABEL, provenanceOf, reasonLabel } from "../disputes/model";
import type { EvidenceItem } from "../evidence/types";
import { utcStamp } from "../format";
import type { Draft } from "../llm/draft";

/**
 * The evidence pack PDF attached to provide-evidence (PayPal limit: < 10 MB per file).
 * Contents: the seller's statement, each claim with the records it cites, and every cited record
 * with its source and provenance. Sample / mock records are labelled as such: the pack is honest
 * about where each line came from.
 */
export interface PackInput {
  disputeId: string;
  reason: string;
  amount: number;
  currency: string;
  draft: Draft;
  /** Only the items referenced by the pack (packRefs), any order. */
  items: EvidenceItem[];
  generatedAt: string;
}

// Standard PDF fonts only cover WinAnsi; map the few symbols we use and drop the rest.
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
export function winAnsi(text: string): string {
  return text
    .replace(/[→⇒]/g, "->")
    .replace(/[✓✔]/g, "OK")
    .replace(/[  ]/g, " ")
    .split("")
    .map((c) => (c === "\n" || (c >= " " && c <= "ÿ") || WINANSI_EXTRA.has(c) ? c : "?"))
    .join("");
}

const PAGE = { w: 612, h: 792, margin: 54 };
const INK = rgb(0.086, 0.094, 0.114);
const MUTED = rgb(0.42, 0.44, 0.48);
const SIGNAL = rgb(0.82, 0.27, 0.12);

class Writer {
  page!: PDFPage;
  y = 0;
  pageNo = 0;
  constructor(
    private readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    private readonly footer: string,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.w, PAGE.h]);
    this.pageNo += 1;
    this.y = PAGE.h - PAGE.margin;
    this.page.drawText(winAnsi(`${this.footer} · page ${this.pageNo}`), { x: PAGE.margin, y: 30, size: 7.5, font: this.regular, color: MUTED });
  }

  ensure(h: number) {
    if (this.y - h < 50) this.newPage();
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    for (const para of winAnsi(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    return lines;
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.regular;
    const x = PAGE.margin + (opts.indent ?? 0);
    for (const line of this.wrap(text, font, size, PAGE.w - x - PAGE.margin)) {
      this.ensure(size + 3);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= size + 3;
    }
    this.y -= opts.gap ?? 4;
  }

  rule() {
    this.ensure(10);
    this.page.drawLine({ start: { x: PAGE.margin, y: this.y - 4 }, end: { x: PAGE.w - PAGE.margin, y: this.y - 4 }, thickness: 0.6, color: rgb(0.82, 0.8, 0.75) });
    this.y -= 12;
  }
}

export async function renderEvidencePack(p: PackInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const when = new Date(p.generatedAt);
  doc.setTitle(`Evidence pack ${p.disputeId}`);
  doc.setProducer("Dispute Defender");
  doc.setCreator("Dispute Defender");
  doc.setCreationDate(when);
  doc.setModificationDate(when);
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold), `Evidence pack ${p.disputeId}`);

  w.text("EVIDENCE PACK", { size: 9, bold: true, color: SIGNAL, gap: 2 });
  w.text(`${reasonLabel(p.reason)} · ${p.currency} ${p.amount.toFixed(2)}`, { size: 20, bold: true, gap: 2 });
  w.text(`PayPal dispute ${p.disputeId} · prepared ${utcStamp(p.generatedAt)}`, { size: 9, color: MUTED, gap: 2 });
  w.text(`Draft origin: ${p.draft.origin === "ai" ? `AI-written (${p.draft.model ?? "Claude"}), reviewed and approved by the seller` : "TEMPLATE (rules-based), reviewed and approved by the seller"}`, { size: 9, color: MUTED });
  w.rule();

  w.text("Seller statement", { size: 12, bold: true });
  w.text(p.draft.sellerNote, { size: 10, gap: 8 });

  const byRef = new Map(p.items.map((i) => [i.sourceRef, i]));
  if (p.draft.claims.length) {
    w.text("Claims and the records they rely on", { size: 12, bold: true });
    p.draft.claims.forEach((c, n) => {
      w.text(`${n + 1}. ${c.text}`, { size: 10, gap: 1 });
      w.text(`Sources: ${c.sourceRefs.join(", ")}`, { size: 8, color: MUTED, indent: 12, gap: 5 });
    });
    w.rule();
  }

  const items = [...p.items].sort((a, b) => (a.at ?? "9").localeCompare(b.at ?? "9"));
  w.text(`Records (${items.length})`, { size: 12, bold: true });
  for (const it of items) {
    w.ensure(40);
    w.text(`${utcStamp(it.at) || "undated"}   ${it.label}`, { size: 10, bold: true, gap: 1 });
    if (it.text) w.text(it.text, { size: 9.5, indent: 12, gap: 1 });
    w.text(`${it.sourceRef} · ${PROVENANCE_LABEL[provenanceOf(it.kind)]}`, { size: 7.5, color: MUTED, indent: 12, gap: 6 });
  }
  const missing = p.draft.claims.flatMap((c) => c.sourceRefs).filter((r) => !byRef.has(r));
  if (missing.length) throw new Error(`Pack is missing cited records: ${[...new Set(missing)].join(", ")}`);

  w.rule();
  w.text("Every statement above cites a record in this pack. Records marked 'Carrier (mock)' or 'Store (sample)' come from the seller's demo systems in the PayPal sandbox.", { size: 8, color: MUTED });
  return doc.save({ useObjectStreams: false });
}
