"""Scripted, repeatable screen takes for the demo video. Re-shoot any time the UI or data changes:
`scripts/video/make-draft.sh`. Needs the app running in Replay mode at BASE.

Capture: app takes at 1280×606 CSS px × 1.5 (crisp 1920×909 UI); the phone take at 390×844 × 2.
Every click the narration mentions is shown with a visible cursor and a click ripple (video-only
overlay). Each take passes a layout QA before it counts; failures are written to qa-takes.json and
fail the render.

Usage: python3 scripts/video/takes.py <build_dir> [base_url]"""
import json, os, pathlib, subprocess, sys, time
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
BUILD = pathlib.Path(sys.argv[1])
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:4517"
CARDS = (ROOT / "scripts/video/cards.html").as_uri()
SCENES = json.load(open(ROOT / "video/scenes.json"))["scenes"]
CONFIG = json.load(open(ROOT / "video/config.json"))
GAP, TAIL, LEAD = 0.3, 0.25, 0.15
# Playwright's recorder captures at CSS-pixel size (it ignores deviceScaleFactor), so takes record at the
# output size and the app is enlarged with CSS zoom: crisp, legible UI that fills the frame.
ZOOM = 1.5
VIEW = REC = {"width": 1920, "height": 910}            # app layout ≈ 1280 CSS px wide
PHONE_VIEW = PHONE_REC = {"width": 585, "height": 1266}  # mobile layout (≈ 390 CSS px), media queries see 585
DSF = 1.5  # screenshots only (cards, desk still): those do honour the device scale factor
FADE_CSS = 56  # bottom fade height in frame px (the frame fades there on purpose)
assert VIEW == REC and PHONE_VIEW == PHONE_REC, "record size must equal the viewport (else the take only fills part of the frame)"
ZOOM_JS = f"document.addEventListener('DOMContentLoaded', () => {{ document.documentElement.style.zoom = '{ZOOM}'; }});"
QA_ISSUES = []
for d in ("takes", "captions", "cards", "raw"):
    (BUILD / d).mkdir(parents=True, exist_ok=True)


def dur(wav):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def line_lengths(sc):
    return [dur(BUILD / "audio_trim" / f"{sc['id']}_{i}.wav") for i in range(len(sc["lines"]))]


def scene_seconds(sc):
    ls = line_lengths(sc)
    return max(LEAD + sum(ls) + GAP * (len(ls) - 1) + TAIL, sc.get("minSeconds", 0))


def ms(x):
    return int(max(0, x) * 1000)


# --------------------------------------------------------------------------- layout QA (in page)
QA_JS = """([fade, expects]) => {
  const bad = [];
  const nav = document.getElementById('site-nav');
  if (!nav) return bad;
  const nr = nav.getBoundingClientRect(), nb = nr.bottom, H = innerHeight, W = innerWidth;
  if (nr.top < 0 || nb > H) bad.push('app header not fully in frame');
  const logo = nav.querySelector('a[aria-label^="Dispute Defender"]');
  if (logo) { const r = logo.getBoundingClientRect(); if (r.left < 0 || r.top < 0) bad.push('logo cut at the frame edge'); }
  const vis = el => { const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.2 && el.getClientRects().length; };
  const leaves = [...document.querySelectorAll('main p, main li, main span, main h1, main h2, main h3, main a, main dd, main dt, main label')]
    .filter(el => vis(el) && el.textContent.trim() && !el.closest('.sr-only') && !el.closest('details:not([open]) > :not(summary)') && ![...el.children].some(c => /^(P|LI|DIV|UL|OL|H\\d|SECTION)$/.test(c.tagName)));
  for (const el of leaves) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.height < 80 && r.top < nb - 1 && r.bottom > nb + 1) { bad.push('half-visible row under the header: ' + el.textContent.trim().slice(0, 40)); break; }
  }
  for (const st of document.querySelectorAll('main .stamp')) {
    if (!vis(st)) continue;
    const a = st.getBoundingClientRect();
    if (a.bottom < nb || a.top > H) continue;
    for (const el of leaves) {
      if (st.contains(el) || el.contains(st)) continue;
      const b = el.getBoundingClientRect();
      if (b.left < a.right - 2 && b.right > a.left + 2 && b.top < a.bottom - 2 && b.bottom > a.top + 2) { bad.push('stamp "' + st.textContent.trim() + '" overlaps text: ' + el.textContent.trim().slice(0, 40)); break; }
    }
  }
  for (const el of document.querySelectorAll('main *')) {
    if (!(el instanceof HTMLElement) || el.clientWidth <= 1 || el.tagName === 'TEXTAREA' || el.closest('.truncate, .sr-only')) continue;
    const ox = getComputedStyle(el).overflowX;
    if (['hidden', 'clip', 'auto', 'scroll'].includes(ox) && el.scrollWidth > el.clientWidth + 2) bad.push('clipped horizontally: ' + el.tagName + '.' + String(el.className).slice(0, 40));
  }
  for (const sel of expects) {
    const el = [...document.querySelectorAll(sel)].find(vis);
    if (!el) { bad.push('expected element missing: ' + sel); continue; }
    const r = el.getBoundingClientRect();
    if (r.top < nb - 1 || r.bottom > H - fade + 1 || r.left < 0 || r.right > W) bad.push('expected element not fully on screen: ' + sel);
  }
  return bad;
}"""


def qa(page, label, expects=()):
    page.wait_for_timeout(500)
    for issue in page.evaluate(QA_JS, [FADE_CSS, list(expects)]):
        QA_ISSUES.append(f"{label}: {issue}")


# --------------------------------------------------------------------------- scrolling + emphasis
SETTLE_JS = """() => {
  const nb = document.getElementById('site-nav').getBoundingClientRect().bottom;
  const rows = [...document.querySelectorAll('main p, main li, main span, main h2, main h3, main a, main label')]
    .filter(el => el.textContent.trim() && el.getClientRects().length && !el.closest('details:not([open]) > :not(summary)'));
  for (const el of rows) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.height < 80 && r.top < nb - 1 && r.bottom > nb + 1) {
      const y = window.scrollY;
      window.scrollBy(0, r.bottom - nb + 2);          // tuck it fully under the header…
      if (window.scrollY === y) {  // …or, at the page end, reveal its whole item (row + label) fully
        const item = (el.closest('li, article') || el).getBoundingClientRect();
        window.scrollBy(0, item.top - nb - 6);
      }
      return true;
    }
  }
  return false;
}"""


def settle(page):
    """No half-visible rows under the header: nudge them fully behind it."""
    for _ in range(4):
        if not page.evaluate(SETTLE_JS):
            return
        page.wait_for_timeout(60)


def smooth_to(page, selector, gap=18, whole=True):
    """Scroll so the element's top (its case tab included) sits `gap` px below the sticky nav."""
    page.evaluate(
        """([s, gap, whole]) => {
          const el = document.querySelector(s); if (!el) return;
          const target = whole ? (el.closest('.case-wrap') || el.closest('section') || el) : el;
          const nav = document.getElementById('site-nav').getBoundingClientRect().bottom;
          window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - nav - gap, behavior: 'smooth' });
        }""",
        [selector, gap, whole],
    )
    wait_scroll_stable(page)
    settle(page)


def wait_scroll_stable(page, limit_ms=2000):
    last, stable, waited = None, 0, 0
    while waited < limit_ms and stable < 3:
        y = page.evaluate("window.scrollY")
        stable = stable + 1 if y == last else 0
        last = y
        page.wait_for_timeout(60)
        waited += 60


CURSOR_JS = """([x, y, click]) => {
  let c = document.getElementById('dd-cursor');
  if (!c) {
    c = document.createElement('div'); c.id = 'dd-cursor';
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2l15 9-7 1.6L8.6 20z" fill="#101c33" stroke="#fff" stroke-width="1.4"/></svg>';
    const Z0 = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    Object.assign(c.style, { position: 'fixed', zIndex: 99999, pointerEvents: 'none', left: (innerWidth * 0.55 / Z0) + 'px', top: (innerHeight * 0.6 / Z0) + 'px', transition: 'left .55s cubic-bezier(.2,.8,.2,1), top .55s cubic-bezier(.2,.8,.2,1)' });
    document.body.appendChild(c);
    c.getBoundingClientRect();
  }
  const Z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;  // fixed elements live in zoomed space
  c.style.left = (x / Z - 4) + 'px'; c.style.top = (y / Z - 2) + 'px';
  if (click) setTimeout(() => {
    const r = document.createElement('div');
    Object.assign(r.style, { position: 'fixed', zIndex: 99998, pointerEvents: 'none', left: (x / Z - 22) + 'px', top: (y / Z - 22) + 'px', width: '44px', height: '44px', borderRadius: '50%', border: '3px solid #b07a12', transition: 'transform .45s ease-out, opacity .45s ease-out' });
    document.body.appendChild(r); r.getBoundingClientRect();
    r.style.transform = 'scale(1.7)'; r.style.opacity = '0';
    setTimeout(() => r.remove(), 600);
  }, 560);
}"""


def click(page, locator, after=300):
    """Move a visible cursor to the element, show a click ripple, then really click it."""
    locator.scroll_into_view_if_needed()
    box = locator.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.evaluate(CURSOR_JS, [x, y, True])
    page.wait_for_timeout(700)
    locator.click()
    page.wait_for_timeout(after)


def ring(page, selector):
    """Video emphasis only: a manila ring around the element the narration names."""
    page.evaluate("s => { const el = document.querySelector(s); if (el) { el.style.outline = '4px solid #ecd593'; el.style.outlineOffset = '5px'; el.style.borderRadius = '10px'; } }", selector)


def dim(page, selector):
    """Video emphasis only: fade out an element the scene doesn't feature."""
    page.evaluate("s => document.querySelectorAll(s).forEach(el => { el.style.animation = 'none'; el.style.opacity = '0.08'; })", selector)


def finished(page):
    page.wait_for_selector("text=Done in", timeout=40000)
    page.wait_for_timeout(1800)  # let the AI note finish typing


# --------------------------------------------------------------------------- the takes
# prepare(page) runs before the scene's clock starts (trimmed off); act(page, seconds, L) is filmed.
D1, D3, D4 = "PP-R-CMR-10190364", "PP-R-MQR-10190375", "PP-R-PLP-10190379"


def act_hook(p, s, L):
    p.wait_for_timeout(ms(s))


def act_phone(p, s, L):
    p.wait_for_timeout(ms(s * 0.45))
    p.mouse.wheel(0, 260)
    p.wait_for_timeout(ms(s * 0.55))


def act_dashboard(p, s, L):
    p.wait_for_timeout(ms(s - 1.6))
    click(p, p.get_by_role("link", name="Watch the agent work a case"), after=250)
    p.wait_for_timeout(300)


def act_agent(p, s, L):
    p.wait_for_timeout(ms(s * 0.5))
    smooth_to(p, "#casefile-h")
    p.wait_for_timeout(ms(s * 0.5) - 700)


def act_draft(p, s, L):
    p.wait_for_timeout(ms(LEAD + L[0]))
    smooth_to(p, "#draft-h")
    p.wait_for_timeout(ms(L[1] + GAP - 0.7))
    smooth_to(p, "label[for=msg]", 24, whole=False)
    p.wait_for_timeout(ms(s - LEAD - L[0] - L[1] - GAP - 0.7))


def act_sources(p, s, L):
    p.wait_for_timeout(ms(LEAD + 0.2))
    click(p, p.locator("#rec-h ~ ul a[href*='ev-order-']").first, after=150)
    settle(p)
    p.wait_for_timeout(ms(LEAD + L[0] + GAP - 0.2 - 1.15))
    smooth_to(p, "#casefile-h")
    p.wait_for_timeout(ms(L[1] - 0.7 + TAIL))


def act_paypal(p, s, L):
    p.wait_for_timeout(ms(LEAD + 0.1))
    click(p, p.get_by_role("tab", name="What PayPal receives"))
    p.wait_for_timeout(ms(s - LEAD - 0.1 - 1.0))


def act_refund(p, s, L):
    click(p, p.get_by_role("button", name="Start the agent"), after=100)
    p.wait_for_timeout(ms(s * 0.42))
    smooth_to(p, "#casefile-h")
    p.wait_for_timeout(ms(s * 0.2))
    smooth_to(p, "#rec-h")
    p.wait_for_timeout(ms(s * 0.38 - 2.3))


def act_outcome(p, s, L):
    p.wait_for_timeout(ms(LEAD + L[0] + GAP * 0.5))
    p.goto(BASE + "/outcomes", wait_until="networkidle")
    p.evaluate("() => { const li = [...document.querySelectorAll('main li')].find(l => l.querySelector('.stamp.text-win')); if (li) { li.id = 'dd-won'; } }")
    ring(p, "#dd-won")
    p.wait_for_timeout(ms(s - LEAD - L[0] - GAP * 0.5))


def act_insights(p, s, L):
    p.wait_for_timeout(ms(s))


def prep_insights(p):
    p.goto(BASE + "/insights", wait_until="networkidle")
    # Feature pattern 1 and the actions; pattern 2 (a sandbox-seeding artifact) isn't featured.
    dim(p, "#p-tracking_reused, li:has(a[href='#p-tracking_reused']):not(:has(a[href='#p-opened_before_delivery'])), #p-below_cost_to_fight")
    ring(p, "#p-opened_before_delivery")
    smooth_to(p, "#actions-h")


TAKES = {
    "hook-run": (lambda p: p.goto(f"{BASE}/disputes/{D1}?run=1&pace=0.5", wait_until="domcontentloaded"), act_hook),
    "phone+desk": (lambda p: p.goto(f"{BASE}/disputes/{D4}", wait_until="networkidle"), act_phone),
    "dashboard": (lambda p: p.goto(BASE + "/", wait_until="networkidle"), act_dashboard),
    "agent-run": (lambda p: (p.goto(f"{BASE}/disputes/{D3}?run=1", wait_until="domcontentloaded"), p.wait_for_selector("section[aria-labelledby=casefile-h] .drop-in", timeout=20000)), act_agent),
    "spanish-draft": (lambda p: (p.goto(f"{BASE}/disputes/{D3}?run=1&pace=0.15", wait_until="domcontentloaded"), finished(p), smooth_to(p, "#casefile-h")), act_draft),
    "source-chip": (lambda p: (p.goto(f"{BASE}/disputes/{D3}?run=1&pace=0.15", wait_until="domcontentloaded"), finished(p), smooth_to(p, "#rec-h")), act_sources),
    "paypal-receives": (lambda p: (p.goto(f"{BASE}/disputes/{D3}?run=1&pace=0.15", wait_until="domcontentloaded"), finished(p), smooth_to(p, "#draft-h")), act_paypal),
    "refund": (lambda p: (p.goto(f"{BASE}/disputes/{D4}?pace=0.6", wait_until="networkidle"), p.wait_for_timeout(300)), act_refund),
    "outcome": (lambda p: (p.goto(f"{BASE}/disputes/{D3}", wait_until="networkidle"), smooth_to(p, "#sub-h", 40), ring(p, "section[aria-labelledby=sub-h]")), act_outcome),
    "insights": (prep_insights, act_insights),
}


def card_png(browser, params, path, transparent=False):
    page = browser.new_page(viewport={"width": 1366, "height": 768}, device_scale_factor=1.5)
    page.goto(f"{CARDS}?{urlencode(params)}", wait_until="networkidle")
    page.wait_for_timeout(300)
    page.screenshot(path=str(path), omit_background=transparent)
    page.close()


def main():
    meta = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for sc in SCENES:
            for i, line in enumerate(sc["lines"]):
                card_png(browser, {"card": "caption", "text": line}, BUILD / "captions" / f"{sc['id']}_{i}.png", transparent=True)
            for k, lab in enumerate(sc.get("bandLabels", [])):
                card_png(browser, {"card": "bandlabel", "text": lab["text"]}, BUILD / "cards" / f"label-{sc['id']}-{k}.png", transparent=True)
        card_png(browser, {"card": "architecture"}, ROOT / "docs/architecture.png")  # README diagram, same source
        card_png(browser, {"card": "hookstat"}, BUILD / "cards" / "hookstat.png", transparent=True)
        card_png(browser, {"card": "fade"}, BUILD / "cards" / "fade.png", transparent=True)
        for step in (1, 2):
            card_png(browser, {"card": "architecture", "step": step}, BUILD / "cards" / f"architecture-{step}.png")
        still = browser.new_page(viewport={"width": 1280, "height": 606}, device_scale_factor=DSF)  # desktop still for the phone scene
        still.goto(f"{BASE}/disputes/{D4}", wait_until="networkidle")
        still.wait_for_timeout(400)
        still.screenshot(path=str(BUILD / "cards" / "desk.png"))
        still.close()

        for sc in SCENES:
            seconds = scene_seconds(sc)
            L = line_lengths(sc)
            take = sc["take"]
            if take.startswith("card:"):
                name = take[5:]
                params = {"card": name}
                if name == "endcard":
                    params.update({"demo": CONFIG.get("demoUrl", ""), "repo": CONFIG.get("repoUrl", "")})
                card_png(browser, params, BUILD / "takes" / f"{sc['id']}.png")
                meta[sc["id"]] = {"kind": "still", "file": f"takes/{sc['id']}.png", "seconds": seconds}
                continue
            phone = take == "phone+desk"
            raw = BUILD / "raw" / sc["id"]
            raw.mkdir(exist_ok=True)
            for f in raw.glob("*.webm"):
                f.unlink()
            ctx = browser.new_context(
                viewport=PHONE_VIEW if phone else VIEW,
                device_scale_factor=1,
                record_video_dir=str(raw),
                record_video_size=PHONE_REC if phone else REC,
                color_scheme="light",
                reduced_motion="no-preference",
            )
            started = time.monotonic()
            page = ctx.new_page()
            page.add_init_script(ZOOM_JS)
            prepare, act = TAKES[take]
            prepare(page)
            lead = time.monotonic() - started
            if not phone:
                qa(page, f"{sc['id']} (framing)", sc.get("expect", []) if take == "dashboard" else [])
            act(page, seconds, L)
            if not phone and not take.startswith("dashboard"):
                qa(page, f"{sc['id']} (end)", sc.get("expect", []))
            if take == "dashboard":
                pass  # it ends on the click into the next page; checked at framing
            video = page.video.path()
            ctx.close()
            dest = BUILD / "takes" / f"{sc['id']}.webm"
            os.replace(video, dest)
            meta[sc["id"]] = {"kind": "phone" if phone else "screen", "file": f"takes/{sc['id']}.webm", "lead": round(lead, 2), "seconds": seconds}
            print("take", sc["id"], f"{seconds:.1f}s lead {lead:.1f}s")
        browser.close()
    json.dump(meta, open(BUILD / "takes.json", "w"), indent=2)
    json.dump(QA_ISSUES, open(BUILD / "qa-takes.json", "w"), indent=2)
    if QA_ISSUES:
        print("TAKE QA FAILED:\n  " + "\n  ".join(QA_ISSUES))
        sys.exit(1)
    print("take QA: no issues")


main()
