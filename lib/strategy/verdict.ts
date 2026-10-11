import type { Assessment } from "./rules";

/**
 * What the case file stamps and the recommendation headlines. The rules' strategy, except when the
 * agent holds back on an open case: then it says so ("Hold" / "Wait") instead of stamping DEFEND on
 * evidence that can't be sent yet.
 */
export type VerdictKey = "FIGHT" | "OFFER" | "REFUND" | "HOLD" | "WAIT";

export function verdictOf(rec: Assessment["recommendation"]): VerdictKey {
  if (rec.wait === "awaiting_delivery" || rec.wait === "no_allowed_action") return "HOLD";
  if (rec.wait === "message_first") return "WAIT";
  return rec.strategy;
}

export const VERDICT_WORD: Record<VerdictKey, string> = { FIGHT: "Defend", OFFER: "Offer", REFUND: "Refund", HOLD: "Hold", WAIT: "Wait" };

export function verdictTitle(rec: Assessment["recommendation"]): string {
  switch (rec.wait) {
    case "awaiting_delivery":
      return "Hold: wait for the delivery scan";
    case "no_allowed_action":
      return "Hold: nothing PayPal allows yet";
    case "message_first":
      return "Message the buyer, then wait";
  }
  return { FIGHT: "Defend with evidence", OFFER: "Make a fair offer", REFUND: "Refund the buyer" }[rec.strategy];
}

/** Why there's nothing to approve on an open case, in one sentence (null when there is an action). */
export function holdNote(rec: Assessment["recommendation"]): string | null {
  if (rec.wait === "awaiting_delivery") return "Nothing to send yet: the package hasn't been delivered, so there's no delivery proof. This draft is kept for later.";
  if (rec.wait === "no_allowed_action") return "Nothing to send yet: PayPal hasn't opened a response window for this action. This draft is kept for later.";
  return null;
}
