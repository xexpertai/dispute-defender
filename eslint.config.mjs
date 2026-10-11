import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Throwaway M0 spike scripts.
    "spikes/**",
    // The Remotion story video (its own package and tsconfig).
    "video/remotion/**",
    // Local scratch (gitignored).
    ".scratch/**",
  ]),
]);

export default eslintConfig;
