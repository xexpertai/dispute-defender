import { describe, expect, it } from "vitest";
import { PayPalAPI } from "@paypal/agent-toolkit/mcp";
import { assertSandboxUrl, getPayPalConfig, SANDBOX_BASE_URL, SandboxGuardError } from "@/lib/paypal/config";
import { PayPalClient } from "@/lib/paypal/client";
import { createSandboxToolkit } from "@/lib/paypal/toolkit";

// M1 test #1: nothing in this app may ever reach live PayPal.
describe("sandbox guard", () => {
  it("rejects PAYPAL_ENV other than sandbox", () => {
    for (const PAYPAL_ENV of ["live", "production", "", undefined]) {
      expect(() => getPayPalConfig({ PAYPAL_ENV, PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b" })).toThrow(SandboxGuardError);
    }
  });

  it("requires credentials", () => {
    expect(() => getPayPalConfig({ PAYPAL_ENV: "sandbox" })).toThrow(/PAYPAL_CLIENT_ID/);
  });

  it("only accepts the sandbox origin", () => {
    expect(() => assertSandboxUrl(`${SANDBOX_BASE_URL}/v1/customer/disputes`)).not.toThrow();
    for (const url of [
      "https://api-m.paypal.com/v1/customer/disputes",
      "https://api.paypal.com/v1/x",
      "https://api-m.sandbox.paypal.com.evil.test/v1/x",
      "http://api-m.sandbox.paypal.com/v1/x",
      "not a url",
    ]) {
      expect(() => assertSandboxUrl(url), url).toThrow(SandboxGuardError);
    }
  });

  it("client refuses a live base URL even if constructed directly", () => {
    const live = { clientId: "a", clientSecret: "b", baseUrl: "https://api-m.paypal.com" } as never;
    expect(() => new PayPalClient(live)).toThrow(SandboxGuardError);
  });

  it("Agent Toolkit defaults to LIVE, so our wrapper must force sandbox", () => {
    // Documents the upstream default that makes this guard necessary.
    expect(new PayPalAPI("token", {}).baseUrl).toBe("https://api-m.paypal.com");
    expect(createSandboxToolkit("token").baseUrl).toBe(SANDBOX_BASE_URL);
  });
});
