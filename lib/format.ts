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
