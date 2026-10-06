import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pre-commit guard for recorded fixtures: no secrets, tokens or buyer/seller PII.
 * Placeholders like [email]/[name] are expected; real-looking values fail the build.
 */
const ROOT = path.resolve(import.meta.dirname, "../fixtures");

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const FORBIDDEN: [string, RegExp][] = [
  ["email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ["bearer/basic credential", /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/],
  ["PayPal access token", /\bA21AA[A-Za-z0-9_-]{20,}/],
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{10,}/],
  ["client secret field", /"(client_secret|access_token|password)"\s*:/i],
  ["phone number", /(?<![\w-])\+?\d{1,3}[\s.-]?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w-])/],
  ["street address", /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s){0,4}(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd)\b/i],
];

const SENSITIVE_KEYS = ["payer_id", "given_name", "surname", "full_name", "address_line_1", "email", "email_address", "phone_number", "account_id"];

describe("fixtures contain no secrets or PII", () => {
  const all = files(ROOT).filter((f) => f.endsWith(".json"));
  it("has fixture files to scan (or none yet)", () => {
    expect(Array.isArray(all)).toBe(true);
  });
  for (const file of all) {
    const rel = path.relative(ROOT, file);
    const text = readFileSync(file, "utf8");
    it(`${rel}: no forbidden patterns`, () => {
      for (const [label, re] of FORBIDDEN) expect(text, `${label} in ${rel}`).not.toMatch(re);
      const env = process.env;
      for (const v of [env.PAYPAL_CLIENT_ID, env.PAYPAL_CLIENT_SECRET]) if (v && v.length > 8) expect(text).not.toContain(v);
    });
    it(`${rel}: sensitive keys hold placeholders only`, () => {
      for (const key of SENSITIVE_KEYS) {
        for (const m of text.matchAll(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "gi"))) {
          expect(m[1], `${key} in ${rel}`).toMatch(/^\[[a-z_]+\]$/);
        }
      }
    });
  }
});
