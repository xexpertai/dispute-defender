"""Scripted, repeatable screen takes for the demo video (PLAN §13). Re-shoot any time the UI or
data changes: `scripts/video/make-draft.sh`. Needs the app running in Replay mode at BASE.

Usage: python3 scripts/video/takes.py <build_dir> [base_url]
Writes <build_dir>/takes/<scene>.(webm|png), <build_dir>/captions/<scene>_<i>.png, takes.json."""
import json, os, pathlib, subprocess, sys, time
from urllib.parse import quote
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
BUILD = pathlib.Path(sys.argv[1])
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:4517"
CARDS = (ROOT / "scripts/video/cards.html").as_uri()
SCENES = json.load(open(ROOT / "video/scenes.json"))["scenes"]
GAP, TAIL = 0.35, 0.6
for d in ("takes", "captions", "raw"):
    (BUILD / d).mkdir(parents=True, exist_ok=True)


def dur(wav):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def scene_seconds(sc):
    lines = [dur(BUILD / "audio" / f"{sc['id']}_{i}.wav") for i in range(len(sc["lines"]))]
    return max(sum(lines) + GAP * (len(lines) - 1) + TAIL, sc.get("minSeconds", 0))


def smooth_to(page, selector, offset=110):
    page.evaluate("([s, o]) => { const el = document.querySelector(s); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - o, behavior: 'smooth' }); }", [selector, offset])


def slow_scroll(page, total_px, seconds, steps=30):
    for _ in range(steps):
        page.mouse.wheel(0, total_px / steps)
        page.wait_for_timeout(int(seconds * 1000 / steps))


def finished(page):
    page.wait_for_selector("text=Finished in", timeout=40000)
    page.wait_for_timeout(1800)  # let the AI note finish typing


# Each take: prepare(page) runs before the scene's clock starts (trimmed); act(page, seconds) is filmed.
def t_dashboard(page, s, phone=False):
    page.wait_for_timeout(int(s * 450))
    slow_scroll(page, 900 if phone else 520, s * 0.45)


TAKES = {
    "phone:dashboard": (lambda p: p.goto(BASE + "/", wait_until="networkidle"), lambda p, s: t_dashboard(p, s, phone=True)),
    "dashboard": (lambda p: p.goto(BASE + "/", wait_until="networkidle"), lambda p, s: (p.locator("text=Watch the agent defend").hover(), t_dashboard(p, s))),
    "agent-run": (
        lambda p: p.goto(BASE + "/", wait_until="networkidle"),
        lambda p, s: (p.wait_for_timeout(700), p.get_by_role("link", name="Watch the agent defend").click(), p.wait_for_timeout(int(s * 1000) - 700)),
    ),
    "refund": (
        lambda p: (p.goto(BASE + "/disputes/PP-R-PLP-10190379?run=1&pace=0.15", wait_until="domcontentloaded"), finished(p), smooth_to(p, "#rec-h"), p.wait_for_timeout(900)),
        lambda p, s: (p.wait_for_timeout(int(s * 600)), smooth_to(p, "#draft-h"), p.wait_for_timeout(int(s * 400))),
    ),
    "spanish-draft": (
        lambda p: (p.goto(BASE + "/disputes/PP-R-MQR-10190375?run=1&pace=0.15", wait_until="domcontentloaded"), finished(p), smooth_to(p, "#rec-h"), p.wait_for_timeout(900)),
        lambda p, s: (p.wait_for_timeout(int(s * 330)), smooth_to(p, "#draft-h"), p.wait_for_timeout(int(s * 330)), smooth_to(p, "#msg", 260), p.wait_for_timeout(int(s * 340))),
    ),
    "source-chip": (
        lambda p: (p.goto(BASE + "/disputes/PP-R-MQR-10190375?run=1&pace=0.15", wait_until="domcontentloaded"), finished(p), smooth_to(p, "#rec-h"), p.wait_for_timeout(900)),
        lambda p, s: (p.wait_for_timeout(int(s * 250)), p.locator("a[href*='track-USPS-9400111899223197428491-ev4']").first.click(), p.wait_for_timeout(int(s * 750))),
    ),
    "paypal-receives": (
        lambda p: (p.goto(BASE + "/disputes/PP-R-MQR-10190375?run=1&pace=0.15", wait_until="domcontentloaded"), finished(p), smooth_to(p, "#draft-h"), p.wait_for_timeout(900)),
        lambda p, s: (p.wait_for_timeout(int(s * 200)), p.get_by_role("tab", name="What PayPal receives").click(), p.wait_for_timeout(int(s * 800))),
    ),
    "outcome": (
        lambda p: (p.goto(BASE + "/disputes/PP-R-MQR-10190375", wait_until="networkidle"), smooth_to(p, "#sub-h", 300), p.wait_for_timeout(700)),
        lambda p, s: (p.wait_for_timeout(int(s * 450)), p.goto(BASE + "/outcomes", wait_until="networkidle"), p.wait_for_timeout(int(s * 550))),
    ),
    "insights": (
        lambda p: p.goto(BASE + "/insights", wait_until="networkidle"),
        lambda p, s: (p.wait_for_timeout(int(s * 300)), slow_scroll(p, 700, s * 0.6)),
    ),
}


def caption_pngs(browser):
    page = browser.new_page(viewport={"width": 1366, "height": 768})
    for sc in SCENES:
        for i, line in enumerate(sc["lines"]):
            page.goto(f"{CARDS}?card=caption&text={quote(line)}")
            page.wait_for_timeout(150)
            page.screenshot(path=str(BUILD / "captions" / f"{sc['id']}_{i}.png"), omit_background=True)
    page.close()


def card_png(browser, name, path):
    page = browser.new_page(viewport={"width": 1366, "height": 768}, device_scale_factor=1)
    page.goto(f"{CARDS}?card={name}", wait_until="networkidle")
    page.wait_for_timeout(500)
    page.screenshot(path=str(path))
    page.close()


def main():
    meta = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        caption_pngs(browser)
        card_png(browser, "architecture", ROOT / "docs/architecture.png")  # README diagram, same source
        for sc in SCENES:
            seconds = scene_seconds(sc)
            take = sc["take"]
            if take.startswith("card:"):
                card_png(browser, take[5:], BUILD / "takes" / f"{sc['id']}.png")
                meta[sc["id"]] = {"kind": "still", "file": f"takes/{sc['id']}.png", "seconds": seconds}
                continue
            phone = take.startswith("phone:")
            size = {"width": 390, "height": 844} if phone else {"width": 1366, "height": 768}
            raw = BUILD / "raw" / sc["id"]
            raw.mkdir(exist_ok=True)
            for f in raw.glob("*.webm"):
                f.unlink()
            ctx = browser.new_context(viewport=size, record_video_dir=str(raw), record_video_size=size, color_scheme="light", reduced_motion="no-preference")
            started = time.monotonic()
            page = ctx.new_page()
            prepare, act = TAKES[take]
            prepare(page)
            lead = time.monotonic() - started
            act(page, seconds)
            page.wait_for_timeout(400)
            video = page.video.path()
            ctx.close()
            dest = BUILD / "takes" / f"{sc['id']}.webm"
            os.replace(video, dest)
            meta[sc["id"]] = {"kind": "phone" if phone else "screen", "file": f"takes/{sc['id']}.webm", "lead": round(lead, 2), "seconds": seconds}
            print("take", sc["id"], f"{seconds:.1f}s lead {lead:.1f}s")
        browser.close()
    json.dump(meta, open(BUILD / "takes.json", "w"), indent=2)


main()
