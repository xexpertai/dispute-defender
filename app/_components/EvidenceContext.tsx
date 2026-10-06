"use client";

import { createContext, useContext } from "react";
import type { EvidenceItem } from "@/lib/evidence/types";

/** Gathered evidence (for plain chip labels) and the "Show details" switch for raw refs/API details. */
export interface EvidenceCtx {
  byRef: Map<string, EvidenceItem>;
  details: boolean;
}

export const EvidenceContext = createContext<EvidenceCtx>({ byRef: new Map(), details: false });
export const useEvidence = () => useContext(EvidenceContext);
