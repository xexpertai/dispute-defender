import type { StoredDraft } from "../store/drafts";
import { validateDraft, type ValidationIssue } from "./validate";

/**
 * "Test our checker": inject two claims an AI might make up into a stored draft and run the same
 * server-side validation every real draft goes through. Read-only: nothing is saved or sent.
 *  1. a fact with a made-up record (a carrier scan that doesn't exist);
 *  2. a policy outcome only PayPal can decide, citing a real record.
 */
export interface CheckerResult {
  claim: string;
  caught: boolean;
  reason: string;
}

export function testTheChecker(stored: StoredDraft): CheckerResult[] {
  const evidence = stored.packItems;
  const real = evidence[0]?.sourceRef;
  const scan = evidence.find((e) => e.sourceRef.startsWith("track:"))?.sourceRef.replace(/#ev\d+$/, "") ?? "track:USPS:0000";
  const tests = [
    { text: "The buyer signed for a second package on 2 Oct.", sourceRefs: [`${scan}#ev99`] },
    { text: "PayPal Seller Protection applies, so this case will be closed in our favour.", sourceRefs: real ? [real] : [] },
  ];
  const ctx = { disputeId: stored.disputeId, reason: stored.reason, amount: stored.amount, currency: stored.currency, allowedActions: stored.draft.action ? [stored.draft.action.kind] : [] };
  const { draft, issues } = validateDraft({ ...stored.draft, claims: [...stored.draft.claims, ...tests] }, evidence, ctx);
  return tests.map((t) => {
    const kept = draft.claims.some((c) => c.text.includes(t.text.slice(0, 24)));
    const issue: ValidationIssue | undefined = issues.find((i) => i.message.includes(t.text.slice(0, 24)) || (i.code === "policy_claim" && /Seller Protection/i.test(t.text)));
    return {
      claim: t.text,
      caught: !kept || Boolean(issue),
      reason: issue?.code === "policy_claim" ? "states an outcome only PayPal can decide" : issue?.code === "unknown_source" ? "cites a record that doesn't exist" : issue ? issue.message : "not caught",
    };
  });
}
