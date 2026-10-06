import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scenes = JSON.parse(readFileSync("video/scenes.json", "utf8")) as { scenes: { id: string; take: string; lines: string[] }[] };
const md = readFileSync("docs/VIDEO_SCRIPT.md", "utf8");

describe("video script", () => {
  it("docs/VIDEO_SCRIPT.md contains every spoken line from video/scenes.json, verbatim", () => {
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
    expect(readFileSync("scripts/video/cards.html", "utf8")).toContain("Built by</span><span style=\"font-weight:600\">Harsha Shinde · xexpertai");
  });

  it("never claims more PayPal APIs than the app uses, and cites the hook's source on screen", () => {
    const text = scenes.scenes.flatMap((s) => s.lines).join(" ");
    expect(text).not.toMatch(/seven|eight PayPal/i);
    expect(readFileSync("scripts/video/cards.html", "utf8")).toContain("2026 True Cost of Fraud");
  });
});
