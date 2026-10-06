// npm run claude:key -- <path to an env file containing CLAUDE_API_KEY>
// Copies the key into this project's .env.local (chmod 600) without printing it, then verifies it
// with a free Models API call.
import { readEnvFile, updateEnvFile } from "./lib/env-file.mjs";

const source = process.argv[2];
if (!source) {
  console.error("Usage: npm run claude:key -- <path to an env file containing CLAUDE_API_KEY>");
  process.exit(1);
}
const key = readEnvFile(source).CLAUDE_API_KEY;
if (!key) {
  console.error(`CLAUDE_API_KEY not found in ${source}. Nothing written.`);
  process.exit(1);
}
// GET /v1/models costs nothing; it only proves the key is valid.
const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
  headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
});
if (!res.ok) {
  console.error(`Key check failed (HTTP ${res.status}). Nothing written.`);
  process.exit(1);
}
updateEnvFile({ CLAUDE_API_KEY: key });
console.log("Copied CLAUDE_API_KEY to .env.local (chmod 600). Key check OK.");
