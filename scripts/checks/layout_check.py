"""Layout regression check (Playwright, real browser). Run against a running app:
    npm run check:layout            (defaults to http://localhost:4517)
Fails (exit 1) if, on any page × viewport × theme:
  1. the sticky nav is not opaque (content would show through it);
  2. anything inside <main> is position: sticky/fixed (a sticky card can cover a scrolling list);
  3. while scrolling in steps, content paints over the nav band, or the page overflows sideways;
  4. a panel heading, scrolled into view the way anchors / the video do, is not fully below the nav
     (case tabs included)."""
import json, sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4517"
PAGES = [
    ("/", None),
    ("/insights", None),
    ("/outcomes", None),
    ("/disputes/PP-R-MQR-10190375?run=1&pace=0", "text=Done in"),
    ("/disputes/PP-R-PLP-10190379?run=1&pace=0", "text=Done in"),
    ("/disputes/PP-R-CMR-10190364?run=1&pace=0", "text=Done in"),
]
VIEWPORTS = [(1366, 768), (1366, 900), (390, 844)]

PROBE = """() => {
  const nav = document.getElementById('site-nav');
  const navBottom = nav.getBoundingClientRect().bottom;
  const bg = getComputedStyle(nav).backgroundColor;
  const alpha = bg.startsWith('rgba') ? parseFloat(bg.split(',')[3]) : 1;
  const sticky = [...document.querySelectorAll('main *')].filter(e => ['sticky','fixed'].includes(getComputedStyle(e).position)).map(e => e.tagName + '.' + String(e.className).slice(0, 40));
  return { navBottom, alpha, sticky, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
}"""

TOPMOST = """(navBottom) => {
  const nav = document.getElementById('site-nav');
  const xs = [10, innerWidth / 2, innerWidth - 10];
  return xs.every(x => { const el = document.elementFromPoint(x, navBottom - 2); return el && nav.contains(el); });
}"""

HEADINGS = """async () => {
  const nav = document.getElementById('site-nav');
  const out = [];
  for (const h of document.querySelectorAll('main h2[id], main h1[id]')) {
    if (!h.getClientRects().length) continue;
    h.scrollIntoView({ block: 'start' });
    await new Promise(r => setTimeout(r, 60));
    const navBottom = nav.getBoundingClientRect().bottom;
    const wrap = h.closest('.case-wrap');
    const tab = wrap ? wrap.querySelector(':scope > .case-tab, :scope > * > .case-tab') : null;
    const top = Math.min(h.getBoundingClientRect().top, tab ? tab.getBoundingClientRect().top : Infinity);
    // A heading near the end of a short page can't scroll to the top; that's fine if fully visible.
    if (top < navBottom - 0.5) out.push({ id: h.id, top: Math.round(top), navBottom: Math.round(navBottom) });
  }
  return out;
}"""

failures = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    for scheme in ("light", "dark"):
        for w, h in VIEWPORTS:
            ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, reduced_motion="reduce")
            page = ctx.new_page()
            for path, ready in PAGES:
                tag = f"{path} {w}x{h} {scheme}"
                page.goto(BASE + path, wait_until="networkidle")
                if ready:
                    page.wait_for_selector(ready, timeout=30000)
                    page.wait_for_timeout(400)
                info = page.evaluate(PROBE)
                if info["alpha"] < 1:
                    failures.append(f"{tag}: nav background is translucent")
                if info["sticky"]:
                    failures.append(f"{tag}: sticky/fixed elements inside main: {info['sticky'][:3]}")
                total = page.evaluate("document.documentElement.scrollHeight")
                y = 0
                while y < total:
                    page.evaluate(f"window.scrollTo(0, {y})")
                    page.wait_for_timeout(30)
                    probe = page.evaluate(PROBE)
                    if probe["overflow"]:
                        failures.append(f"{tag} @y={y}: horizontal overflow")
                        break
                    if not page.evaluate(TOPMOST, probe["navBottom"]):
                        failures.append(f"{tag} @y={y}: content paints over the nav")
                        break
                    y += int(h * 0.6)
                for bad in page.evaluate(HEADINGS):
                    failures.append(f"{tag}: heading #{bad['id']} lands under the nav (top {bad['top']} < nav {bad['navBottom']})")
            ctx.close()
    browser.close()

print(json.dumps({"checked": len(PAGES) * len(VIEWPORTS) * 2, "failures": failures}, indent=2))
sys.exit(1 if failures else 0)
