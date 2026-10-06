import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests must never touch the network or real credentials.
    env: { PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "test-client-id-0000", PAYPAL_CLIENT_SECRET: "test-client-secret-0000", DD_DB_PATH: ":memory:", DD_LLM: "fake" },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/empty.ts"),
    },
  },
});
