import { fromChat, fromStoreLog, type LogLine } from "../evidence/sources";
import type { EvidenceItem } from "../evidence/types";

/**
 * The seller's own systems (shop backend, inbox). In the demo these are sample records in
 * fixtures/samples/store.json keyed by the PayPal invoice number; a real integration
 * (Shopify, WooCommerce, Gmail…) implements StoreAdapter.
 */
export interface StoreRecord {
  sku?: string;
  store?: LogLine[];
  chat?: { threadId: string; lines: LogLine[] };
}

export interface StoreSampleFile {
  orders: Record<string, StoreRecord>;
  listings?: Record<string, { title: string; text: string }>;
}

export interface StoreAdapter {
  evidenceFor(invoiceNumber: string): Promise<EvidenceItem[]>;
}

export class SampleStore implements StoreAdapter {
  constructor(private readonly data: StoreSampleFile) {}

  async evidenceFor(invoiceNumber: string): Promise<EvidenceItem[]> {
    const rec = this.data.orders[invoiceNumber];
    if (!rec) return [];
    const items: EvidenceItem[] = [];
    if (rec.sku && this.data.listings?.[rec.sku]) {
      const l = this.data.listings[rec.sku];
      items.push({ sourceRef: `listing:${rec.sku}`, kind: "listing", label: `Listing: ${l.title}`, text: l.text, facts: {} });
    }
    if (rec.store?.length) items.push(...fromStoreLog(invoiceNumber, rec.store));
    if (rec.chat?.lines.length) items.push(...fromChat(rec.chat.threadId, rec.chat.lines));
    return items;
  }
}
