/** Formatting shared by server and client. Fixed locale and UTC so both render the same text. */
export function money(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "5 Oct, 19:08 UTC" */
export function utcStamp(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hh}:${mm} UTC`;
}

/** "19:08" (UTC) for dense timelines. */
export function utcTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** DOM id for an evidence item, so source chips can link to it. */
export const evidenceAnchor = (sourceRef: string) => `ev-${sourceRef.replace(/[^A-Za-z0-9_-]/g, "-")}`;

/** Short, readable form of a sourceRef for chips: "order:8101…673R", "track:USPS:…8490#ev4". */
export function shortRef(ref: string): string {
  return ref.replace(/([A-Z0-9]{6})[A-Z0-9]{5,}([A-Z0-9]{4})/g, "$1…$2");
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
};

const SCAN: Record<string, string> = {
  LABEL_CREATED: "Label created",
  ACCEPTED: "Accepted",
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  DELIVERY_ATTEMPTED: "Delivery attempted",
  EXCEPTION: "Exception",
  RETURNED_TO_SENDER: "Returned to sender",
};

interface Labellable {
  sourceRef: string;
  kind: string;
  at?: string;
  facts: { carrier?: string; eventCode?: string; postedBy?: string; author?: string };
}

/** Plain-language label for a record ("USPS scan · Delivered 5 Oct"); raw refs stay behind "Show details". */
export function humanLabel(e: Labellable | undefined, ref: string): string {
  const day = shortDay(e?.at);
  const withDay = (s: string) => (day ? `${s} · ${day}` : s);
  const kind = e?.kind ?? ({ track: "carrier_event", pptrack: "paypal_tracking", order: "order", capture: "capture", store: "store_log", chat: "chat", listing: "listing" } as Record<string, string>)[ref.split(":")[0]] ?? "dispute";
  switch (kind) {
    case "carrier_event":
      return `${e?.facts.carrier ?? ref.split(":")[1] ?? "Carrier"} scan · ${SCAN[e?.facts.eventCode ?? ""] ?? "Update"}${day ? ` ${day}` : ""}`;
    case "paypal_tracking":
      return `Tracking at PayPal${e?.facts.carrier ? ` · ${e.facts.carrier}` : ""}`;
    case "order":
      return "Order";
    case "capture":
      return "Payment record";
    case "dispute":
      return withDay("Dispute opened");
    case "dispute_message":
      return withDay(e?.facts.postedBy === "SELLER" ? "Your message" : "Buyer message");
    case "store_log":
      return withDay("Store log");
    case "chat":
      return withDay(e?.facts.author === "seller" ? "Your chat" : "Buyer chat");
    case "listing":
      return "Listing";
    default:
      return ref;
  }
}
