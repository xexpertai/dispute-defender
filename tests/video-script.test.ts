import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scenes = JSON.parse(readFileSync("video/scenes.json", "utf8")) as { scenes: { id: string; take: string; lines: string[] }[] };
// The readable script is an internal planning doc (not in the public repo); check it only where it exists.
const hasMd = existsSync("docs/VIDEO_SCRIPT.md");
const md = hasMd ? readFileSync("docs/VIDEO_SCRIPT.md", "utf8") : "";

describe("video script", () => {
  it.skipIf(!hasMd)("docs/VIDEO_SCRIPT.md contains every spoken line from video/scenes.json, verbatim", () => {
    for (const s of scenes.scenes) for (const l of s.lines) expect(md, `${s.id}: ${l}`).toContain(l);
  });

  it("keeps sentences short (≤ 24 words) for a natural read", () => {
    for (const s of scenes.scenes) for (const l of s.lines) expect(l.split(/\s+/).length, l).toBeLessThanOrEqual(24);
  });

  it("opens with the hook, ends with the end card, and the voice never introduces itself as a person", () => {
    expect(scenes.scenes[0].id).toBe("hook");
    expect(scenes.scenes.at(-1)?.id).toBe("endcard");
    const text = scenes.scenes.flatMap((s) => s.lines).join(" ");
    expect(text).not.toMatch(/\b(hello|hi everyone|my name|I'm|I am|Harsha)\b/i);
    expect(readFileSync("scripts/video/cards.html", "utf8")).toContain("<dt>Built by</dt><dd>Harsha Shinde · xexpertai</dd>");
    const cfg = JSON.parse(readFileSync("video/config.json", "utf8"));
    expect(Object.keys(cfg)).toEqual(expect.arrayContaining(["demoUrl", "repoUrl"]));
  });

  it("never claims more PayPal APIs than the app uses, and cites the hook's source on screen", () => {
    const text = scenes.scenes.flatMap((s) => s.lines).join(" ");
    expect(text).not.toMatch(/seven|eight PayPal/i);
    expect(text).not.toMatch(/real PayPal API call/i); // Replay reads recorded responses; say so
    const cards = readFileSync("scripts/video/cards.html", "utf8");
    expect(cards).toContain("Source: 2026 industry fraud-cost study");
    // no third-party marks on screen (full citation lives in docs/YOUTUBE.md)
    expect(cards + text).not.toMatch(/®|™|LexisNexis|True Cost of Fraud/);
  });
});
