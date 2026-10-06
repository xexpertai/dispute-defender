// Shared helpers for local setup scripts: hidden terminal input and safe .env.local updates.
// Nothing here ever prints a value.
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ENV_PATH = fileURLToPath(new URL("../../.env.local", import.meta.url));

export function requireTty() {
  if (!process.stdin.isTTY) {
    console.error("Run this in an interactive terminal (e.g. `! npm run paypal:key`).");
    process.exit(1);
  }
}

/** Read a line without echoing it (paste-friendly). */
export function askHidden(question) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (ch === "\u0003") {
          stdout.write("\nCancelled.\n");
          process.exit(1);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

export function readEnvFile(path = ENV_PATH) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")];
      }),
  );
}

/** Set/replace keys in .env.local, keep every other line, chmod 600. */
export function updateEnvFile(updates, path = ENV_PATH) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const kept = lines.filter((l) => l.trim() && !Object.keys(updates).some((k) => l.startsWith(`${k}=`)));
  const out = [...kept, ...Object.entries(updates).map(([k, v]) => `${k}=${v}`)].join("\n") + "\n";
  writeFileSync(path, out, { mode: 0o600 });
  chmodSync(path, 0o600);
}
