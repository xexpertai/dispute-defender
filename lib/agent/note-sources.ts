import type { EvidenceItem } from "../evidence/types";

/**
 * Which gathered records a free-text note (or buyer message) relies on, so the UI can show source
 * chips next to it: any order / capture / dispute id or tracking number it mentions, and the PayPal
 * capture record whenever it mentions Seller Protection.
 */
export function noteSources(text: string, evidence: EvidenceItem[]): string[] {
  const refs: string[] = [];
  const add = (r: string) => {
    if (!refs.includes(r)) refs.push(r);
  };
  for (const e of evidence) {
    const id = e.sourceRef.split(":")[1]?.split("#")[0];
    if ((e.kind === "order" || e.kind === "capture" || e.kind === "dispute") && id && text.includes(id)) add(e.sourceRef);
    if (e.kind === "paypal_tracking" && e.facts.trackingNumber && text.includes(e.facts.trackingNumber)) add(e.sourceRef);
  }
  if (/seller protection/i.test(text)) for (const e of evidence) if (e.kind === "capture" && e.facts.sellerProtection) add(e.sourceRef);
  return refs;
}

export const protectionBacked = (evidence: EvidenceItem[]) => evidence.some((e) => e.kind === "capture" && e.facts.sellerProtection === "ELIGIBLE");
