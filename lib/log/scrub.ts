/**
 * Log scrubbing: removes registered secret values, bearer/basic credentials and
 * Authorization headers from anything we print or persist.
 */
const secrets = new Set<string>();

/** Register a secret value (e.g. client secret, API key) so it is masked everywhere. */
export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 8) secrets.add(value);
}

export function scrub(input: unknown): string {
  let text = typeof input === "string" ? input : safeStringify(input);
  for (const s of secrets) text = text.split(s).join("[REDACTED]");
  return text
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, "$1 [REDACTED]")
    .replace(/("?authorization"?\s*[:=]\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[REDACTED]");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const log = {
  info: (...parts: unknown[]) => console.log(parts.map(scrub).join(" ")),
  warn: (...parts: unknown[]) => console.warn(parts.map(scrub).join(" ")),
  error: (...parts: unknown[]) => console.error(parts.map(scrub).join(" ")),
};
