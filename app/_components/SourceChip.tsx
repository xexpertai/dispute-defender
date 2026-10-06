"use client";

import type { EvidenceKind } from "@/lib/evidence/types";
import { PROVENANCE_LABEL, provenanceOf, type Provenance } from "@/lib/disputes/model";
import { evidenceAnchor, humanLabel, shortRef } from "@/lib/format";
import { useEvidence } from "./EvidenceContext";

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

/** A claim's citation in plain words ("USPS scan · Delivered 5 Oct"). Tapping it jumps to and flashes the record. */
export function SourceChip({ sourceRef }: { sourceRef: string }) {
  const { byRef, details } = useEvidence();
  const p = provenanceOfRef(sourceRef);
  const id = evidenceAnchor(sourceRef);
  const label = details ? shortRef(sourceRef) : humanLabel(byRef.get(sourceRef), sourceRef);
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
      <span className={`inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 leading-none text-ink-2 group-hover:border-line-strong group-hover:text-ink ${details ? "font-mono text-[0.68rem]" : "text-[0.78rem]"}`}>
        <span className={`size-1.5 shrink-0 rounded-full ${PROVENANCE_DOT[p]}`} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
    </a>
  );
}
