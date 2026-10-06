"use client";

import type { EvidenceKind } from "@/lib/evidence/types";
import { PROVENANCE_LABEL, provenanceOf, type Provenance } from "@/lib/disputes/model";
import { evidenceAnchor, shortRef } from "@/lib/format";

const KIND_BY_PREFIX: Record<string, EvidenceKind> = {
  dispute: "dispute",
  order: "order",
  capture: "capture",
  pptrack: "paypal_tracking",
  track: "carrier_event",
  store: "store_log",
  chat: "chat",
  listing: "listing",
};

export const provenanceOfRef = (ref: string): Provenance => provenanceOf(KIND_BY_PREFIX[ref.split(":")[0]] ?? "dispute");

export const PROVENANCE_DOT: Record<Provenance, string> = { paypal: "bg-pp", carrier: "bg-amber", store: "bg-muted" };

/** A claim's citation. Tapping it scrolls to and flashes the evidence item it points at. */
export function SourceChip({ sourceRef }: { sourceRef: string }) {
  const p = provenanceOfRef(sourceRef);
  const id = evidenceAnchor(sourceRef);
  return (
    <a
      href={`#${id}`}
      onClick={() => {
        const el = document.getElementById(id);
        if (!el) return;
        el.dataset.flash = "true";
        window.setTimeout(() => {
          delete el.dataset.flash;
        }, 1600);
      }}
      className="group inline-flex min-h-11 max-w-full items-center"
      title={`${PROVENANCE_LABEL[p]} · ${sourceRef}`}
    >
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[0.7rem] leading-none text-ink-2 group-hover:border-line-strong group-hover:text-ink">
        <span className={`size-1.5 shrink-0 rounded-full ${PROVENANCE_DOT[p]}`} aria-hidden="true" />
        <span className="truncate">{shortRef(sourceRef)}</span>
      </span>
    </a>
  );
}
