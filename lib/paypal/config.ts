/**
 * PayPal environment guard. This project is sandbox-only: every PayPal call must go to
 * SANDBOX_BASE_URL, and startup fails fast if anything else is configured.
 */
export const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

export class SandboxGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxGuardError";
  }
}

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: typeof SANDBOX_BASE_URL;
}

type Env = Record<string, string | undefined>;

export function assertSandboxUrl(url: string): void {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new SandboxGuardError(`Invalid PayPal URL: ${url}`);
  }
  if (origin !== SANDBOX_BASE_URL) {
    throw new SandboxGuardError(`Refusing non-sandbox PayPal URL: ${origin}`);
  }
}

export function getPayPalConfig(env: Env = process.env): PayPalConfig {
  if (env.PAYPAL_ENV !== "sandbox") {
    throw new SandboxGuardError(`PAYPAL_ENV must be "sandbox" (got ${JSON.stringify(env.PAYPAL_ENV ?? null)})`);
  }
  const clientId = env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new SandboxGuardError("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required (run `npm run paypal:key`)");
  }
  return { clientId, clientSecret, baseUrl: SANDBOX_BASE_URL };
}
