/**
 * HATEOAS gate. PayPal only allows a dispute action when its link is present in the
 * dispute details (`links[].rel`). We never offer or attempt an action without it.
 * Note: rels use underscores (verified in sandbox, M0), e.g. `provide_evidence`.
 */
export const DISPUTE_ACTIONS = [
  "send_message",
  "make_offer",
  "escalate",
  "provide_evidence",
  "accept_claim",
  "acknowledge_return_item",
  "provide_supporting_info",
  "appeal",
  // sandbox-only simulation
  "require_evidence",
  "adjudicate",
] as const;

export type DisputeAction = (typeof DISPUTE_ACTIONS)[number];

export interface HasLinks {
  dispute_id?: string;
  links?: { rel: string; href?: string; method?: string }[];
}

export class ActionNotAllowedError extends Error {
  constructor(
    readonly action: DisputeAction,
    readonly available: string[],
  ) {
    super(`Action "${action}" is not allowed now (available: ${available.join(", ") || "none"})`);
    this.name = "ActionNotAllowedError";
  }
}

export function availableActions(dispute: HasLinks): DisputeAction[] {
  const rels = new Set((dispute.links ?? []).map((l) => l.rel));
  return DISPUTE_ACTIONS.filter((a) => rels.has(a));
}

export function isAllowed(dispute: HasLinks, action: DisputeAction): boolean {
  return availableActions(dispute).includes(action);
}

export function assertAllowed(dispute: HasLinks, action: DisputeAction): void {
  if (!isAllowed(dispute, action)) throw new ActionNotAllowedError(action, availableActions(dispute));
}
