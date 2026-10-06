/**
 * PII redaction for LLM prompts, logs and recorded fixtures.
 * - redactText: free text (buyer messages, notes) → emails, phones, street addresses masked.
 * - redactObject: PayPal JSON → sensitive keys replaced with stable placeholders, strings run
 *   through redactText. Postal code + country are kept: delivery-ZIP matching is evidence.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// +1 (415) 555-0100, 415-555-0100, +44 20 7946 0958, 9876543210 …
const PHONE = /(?<![\w-])(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?![\w-])/g;
// "1234 Main St", "55 W. 3rd Avenue Apt 4" …
const STREET =
  /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Za-z0-9.'-]+\s){0,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Way|Pl|Place|Ter|Terrace|Pkwy|Parkway|Hwy|Highway)\b\.?(?:,?\s*(?:Apt|Unit|Suite|Ste|#)\s*[\w-]+)?/gi;

export function redactText(text: string): string {
  return text.replace(EMAIL, "[email]").replace(STREET, "[address]").replace(PHONE, "[phone]");
}

/** Keys whose values are always replaced (case-insensitive). */
const SENSITIVE_KEYS: Record<string, string> = {
  email: "[email]",
  email_address: "[email]",
  given_name: "[name]",
  surname: "[name]",
  full_name: "[name]",
  middle_name: "[name]",
  alternate_full_name: "[name]",
  payer_id: "[payer_id]",
  merchant_id: "[merchant_id]",
  account_id: "[account_id]",
  phone: "[phone]",
  phone_number: "[phone]",
  national_number: "[phone]",
  address_line_1: "[address]",
  address_line_2: "[address]",
  address_line_3: "[address]",
  admin_area_2: "[city]",
  admin_area_3: "[area]",
  admin_area_4: "[area]",
  tax_id: "[tax_id]",
  birth_date: "[dob]",
};

/** Timestamp fields (ISO strings or epoch millis) are never PII; skip text redaction on them. */
const TIME_KEY = /(^|_)(time|date|at)$/;

/** Keys whose value may be a string name OR an object of name parts. */
const NAME_KEYS = new Set(["name", "buyer_name", "seller_name"]);
/** Structural fields that legitimately carry the word "name" but are not people. */
const NAME_ALLOWLIST_PARENTS = new Set(["items", "item_info", "carrier", "tracking_info", "links"]);

export function redactObject<T>(value: T, parentKey = ""): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactObject(v, parentKey)) as T;
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const k = key.toLowerCase();
    if (TIME_KEY.test(k) && (typeof v === "string" || typeof v === "number")) {
      out[key] = v;
    } else if (k in SENSITIVE_KEYS && v !== null && typeof v !== "object") {
      out[key] = SENSITIVE_KEYS[k];
    } else if (NAME_KEYS.has(k) && !NAME_ALLOWLIST_PARENTS.has(parentKey) && typeof v === "string") {
      out[key] = "[name]";
    } else {
      out[key] = redactObject(v, k);
    }
  }
  return out as T;
}
