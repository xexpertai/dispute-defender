"""Product footage for the story video (video/remotion), captured from the real app.

Usage: python3 scripts/video/footage.py <out_dir> <replay_base_url> [live_base_url]   (TAKES=a,b re-shoots some)

Every take is captured with Chrome's screencast at 2560x1320 device pixels (the app at 1280x660 CSS px,
device scale 2), at the browser's own frame rate, then resampled to constant 30 fps H.264. The extra
resolution leaves headroom for zooms up to ~133% in the 1920x990 picture area.

Each take records event marks (seconds from the take start) and element rectangles (take pixels) to
<out_dir>/footage.json for the editor's zooms and callouts, and runs the app's layout QA at its key
moments (header in frame, no half-hidden rows under it, no stamp over text, narrated element visible).

Replay takes use the recorded Kiln & Clay fixtures (no network, $0). The LIVE takes write to PayPal's
sandbox and run once each (no retries that would duplicate a submission):
  live-offer   the mugs case: a live agent run (one capped Claude Haiku call), approve, make-offer
  won-a        the bowl claim: "Seller wins" (sandbox adjudicate) and PayPal's POST response
  won-b        after PayPal resolves it (~2-3 min, waited off camera): the Won stamp and a re-read
They run only when named in TAKES and a live base URL is given."""
import base64, json, os, pathlib, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(sys.argv[1])
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:4521"
LIVE = sys.argv[3] if len(sys.argv) > 3 else ""
CSS_W, CSS_H, DSF = 1280, 660, 2
W, H = CSS_W * DSF, CSS_H * DSF
FPS = 30
OUT.mkdir(parents=True, exist_ok=True)
META_PATH = OUT / "footage.json"
META = json.loads(META_PATH.read_text()) if META_PATH.exists() else {}
QA: dict[str, list[str]] = {}
BOWL, PLATES, MUGS, PLANTER = "PP-R-WEO-10190424", "PP-R-VYZ-10190425", "PP-R-KFL-10190426", "PP-R-FDW-10190427"
CAFE = os.environ.get("CAFE_ID", "")  # the end-to-end DEFEND case (KC-CAFE-24), opened 7 Oct

# A visible cursor and click ripple (video-only overlay, CSS px).
CURSOR_JS = """
(() => {
  let pos = { x: -100, y: -100 };
  const ensure = () => {
    const head = document.head || document.documentElement;
    if (!head) return;
    if (!document.getElementById('__ripple')) { const st = document.createElement('style'); st.id = '__ripple';
      st.textContent = '@keyframes __ripple{from{transform:scale(.3);opacity:1}to{transform:scale(1.5);opacity:0}}'; head.appendChild(st); }
    if (document.body && !document.getElementById('__cursor')) {
      const c = document.createElement('div'); c.id = '__cursor';
      c.style.cssText = 'position:fixed;width:26px;height:26px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))';
      c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.5L9 19z" fill="#101c33" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      document.body.appendChild(c); place();
    }
  };
  const place = () => { const c = document.getElementById('__cursor'); if (c) { c.style.left = (pos.x - 4) + 'px'; c.style.top = (pos.y - 2) + 'px'; } };
  addEventListener('mousemove', (e) => { pos = { x: e.clientX, y: e.clientY }; ensure(); place(); }, true);
  addEventListener('mousedown', (e) => {
    const r = document.createElement('div');
    r.style.cssText = `position:fixed;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border-radius:999px;border:3px solid #b07a12;z-index:2147483646;pointer-events:none;animation:__ripple .65s ease-out forwards`;
    document.body.appendChild(r); setTimeout(() => r.remove(), 700);
  }, true);
  ensure();
  setInterval(ensure, 40);
})();
"""

# Layout QA in the page (CSS px): the same checks as the draft pipeline's takes.
QA_JS = """(need) => {
  const bad = [];
  const nav = document.getElementById('site-nav');
  if (!nav) return ['no app header'];
  const nr = nav.getBoundingClientRect(), nb = nr.bottom, H = innerHeight;
  if (nr.top < -1 || nb > H) bad.push('app header not fully in frame');
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
  for (const s of need) {
    const el = s.startsWith('text:') ? [...document.querySelectorAll('main *')].find(e => e.children.length === 0 && e.textContent.includes(s.slice(5))) : document.querySelector(s);
    if (!el) { bad.push('missing: ' + s); continue; }
    const r = el.getBoundingClientRect();
    if (r.top < nb - 1 || r.bottom > H + 1) bad.push('not fully in frame: ' + s);
  }
  return bad;
}"""


class Take:
    def __init__(self, ctx, page, name):
        self.ctx, self.page, self.name = ctx, page, name
        self.dir = OUT / "frames" / name
        shutil.rmtree(self.dir, ignore_errors=True)
        self.dir.mkdir(parents=True)
        self.frames: list[tuple[float, str]] = []
        self.marks: dict[str, float] = {}
        self.rects: dict[str, dict] = {}
        self.cdp = ctx.new_cdp_session(page)
        self.cdp.on("Page.screencastFrame", self._frame)
        self.t0 = None

    def _frame(self, f):
        p = self.dir / f"{len(self.frames):06d}.jpg"
        p.write_bytes(base64.b64decode(f["data"]))
        self.frames.append((f["metadata"]["timestamp"], p.name))
        try:
            self.cdp.send("Page.screencastFrameAck", {"sessionId": f["sessionId"]})
        except Exception:
            pass

    def start(self):
        self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": W, "maxHeight": H, "everyNthFrame": 1})
        self.t0 = time.time()

    def mark(self, key):
        self.marks[key] = round(time.time() - self.t0, 3)

    def rect(self, key, locator):
        b = locator.first.bounding_box()
        if b:
            self.rects[key] = {k: round(v * DSF, 1) for k, v in b.items()}

    def qa(self, moment, need=None):
        issues = self.page.evaluate(QA_JS, need or [])
        if issues:
            QA.setdefault(self.name, []).extend(f"{moment}: {i}" for i in dict.fromkeys(issues))

    def stop(self):
        self.page.wait_for_timeout(250)
        self.cdp.send("Page.stopScreencast")
        end = time.time()
        frames = sorted(self.frames)
        n = int((end - self.t0) * FPS)
        lines, j = [], 0
        for k in range(n):
            t = self.t0 + k / FPS
            while j + 1 < len(frames) and frames[j + 1][0] <= t:
                j += 1
            lines.append(f"file '{frames[j][1]}'\nduration {1 / FPS:.6f}")
        ts = [f[0] - self.t0 for f in frames if f[0] >= self.t0]
        gaps = max((b - a for a, b in zip(ts, ts[1:])), default=0)
        (self.dir / "list.txt").write_text("\n".join(lines) + f"\nfile '{frames[j][1]}'\n")
        mp4 = OUT / f"{self.name}.mp4"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(self.dir / "list.txt"),
                        "-vf", f"fps={FPS},scale={W}:{H}:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-movflags", "+faststart", str(mp4)], check=True)
        for jpg in self.dir.glob("*.jpg"):
            jpg.unlink()
        META[self.name] = {"file": mp4.name, "seconds": round(n / FPS, 3), "width": W, "height": H, "marks": self.marks, "rects": self.rects,
                           "max_frame_gap": round(gaps, 3)}
        print(f"take {self.name}: {n / FPS:.1f}s, max frame gap {gaps * 1000:.0f} ms")
        META_PATH.write_text(json.dumps(META, indent=2))


# ---------------------------------------------------------------- helpers
def move(page, x, y, steps=22, pause=120):
    page.mouse.move(x, y, steps=steps)
    page.wait_for_timeout(pause)


def click(page, locator, pause=260, after=200):
    loc = locator.first
    box = loc.bounding_box()
    move(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, 24, pause)
    page.mouse.down()
    page.wait_for_timeout(90)
    page.mouse.up()
    page.wait_for_timeout(after)


def scroll_to(page, selector, gap=14, smooth=True, whole=True):
    """Scrolls so the element's case (tab included) sits `gap` px under the app header, then waits for it to settle."""
    page.evaluate("""([s, gap, smooth, whole]) => { const el = document.querySelector(s); if (!el) return;
      const target = whole ? (el.closest('.case-wrap') || el.closest('section') || el) : el;
      const nav = document.getElementById('site-nav').getBoundingClientRect().bottom;
      window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - nav - gap, behavior: smooth ? 'smooth' : 'instant' }); }""", [selector, gap, smooth, whole])
    last, stable = None, 0
    for _ in range(60):
        y = page.evaluate("window.scrollY")
        stable = stable + 1 if y == last else 0
        last = y
        if stable >= 4:
            break
        page.wait_for_timeout(50)
    settle(page)


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
    """No half-visible rows under the header: nudge them fully behind it (or fully into view at the page end)."""
    for _ in range(4):
        if not page.evaluate(SETTLE_JS):
            return
        page.wait_for_timeout(60)


def context(browser):
    ctx = browser.new_context(viewport={"width": CSS_W, "height": CSS_H}, device_scale_factor=DSF, color_scheme="light", reduced_motion="no-preference")
    ctx.add_init_script(CURSOR_JS)
    return ctx, ctx.new_page()


def finished(page, timeout=90000):
    page.wait_for_selector("text=Done in", timeout=timeout)


# ---------------------------------------------------------------- replay takes
def take_board(browser):
    """The case board, then "Watch the agent work a case" on the bowl: the trace runs and DEFEND lands."""
    ctx, page = context(browser)
    page.goto(f"{BASE}/disputes/{BOWL}?run=1&pace=0.05", wait_until="domcontentloaded")  # warm the route (unfilmed)
    finished(page)
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(800)
    page.mouse.move(1180, 600)
    tk = Take(ctx, page, "board")
    tk.start()
    tk.rect("risk", page.locator("text=at risk").locator("xpath=ancestor::div[2]"))
    tk.rect("yourMove", page.locator("text=Your move").first.locator("xpath=.."))
    tk.rect("deadline", page.locator("text=Next deadline").first.locator("xpath=.."))
    tk.rect("cases", page.locator("h2:has-text('Open cases')"))
    tk.rect("watch", page.get_by_role("link", name="Watch the agent work a case"))
    tk.qa("board", ["text:at risk"])
    page.wait_for_timeout(600)
    move(page, 300, 330, 30, 300)  # over the "$ at risk" figure
    tk.mark("risk")
    page.wait_for_timeout(1800)
    move(page, 520, 330, 20, 200)  # "Your move" / "Next deadline"
    tk.mark("deadline")
    page.wait_for_timeout(1600)
    # Scroll to "The agent's call on all 7 of your cases" (the rules' call per case, summed), hold, then back for the click.
    scroll_to(page, "#calls-h", 24, whole=False)
    page.evaluate("window.scrollBy({ top: -40, behavior: 'instant' })")
    page.wait_for_timeout(300)
    settle(page)
    tk.mark("calls")
    tk.rect("calls", page.locator("section[aria-labelledby=calls-h]"))
    tk.qa("calls", ["#calls-h"])
    for x in (260, 560, 860, 1120):  # across the four calls
        move(page, x, 400, 26, 1250)
    page.wait_for_timeout(1400)
    page.evaluate("window.scrollTo({ top: 0, behavior: 'smooth' })")
    page.wait_for_timeout(1300)
    tk.mark("cards")
    tk.mark("beforeClick")
    click(page, page.get_by_role("link", name="Watch the agent work a case"), 300, 0)
    tk.mark("click")
    page.wait_for_selector("#casefile-h", timeout=20000)
    tk.mark("detail")
    page.wait_for_timeout(400)
    tk.qa("detail")
    page.wait_for_selector("section[aria-labelledby=casefile-h] .drop-in", timeout=20000)
    tk.mark("firstRecord")
    page.wait_for_timeout(1200)
    scroll_to(page, "#casefile-h")
    tk.mark("caseFile")
    page.mouse.move(1250, 640, steps=10)
    page.wait_for_selector("main .stamp-xl", timeout=40000)
    tk.mark("stamp")
    page.wait_for_timeout(900)
    tk.rect("stamp", page.locator("main .stamp-xl"))
    tk.rect("caseFile", page.locator("section[aria-labelledby=casefile-h]"))
    tk.rect("trace", page.locator("#casefile-h").locator("xpath=ancestor::section[1]"))
    tk.qa("stamp", ["main .stamp-xl"])
    finished(page)
    tk.mark("done")
    page.wait_for_timeout(2500)
    # "Test our checker": two made-up claims, struck out by the server (read-only).
    btn = page.get_by_role("button", name="Test our checker")
    # Put the button ~300 px above the bottom edge (never under the header) so the two test claims that
    # drop in below it stay in frame, whatever the case file's length.
    btn.scroll_into_view_if_needed()
    page.evaluate("""() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Test our checker'));
      const nav = document.getElementById('site-nav').getBoundingClientRect().bottom;
      window.scrollBy({ top: b.getBoundingClientRect().top - Math.max(nav + 40, innerHeight - 300), behavior: 'instant' }); }""")
    page.wait_for_timeout(600)
    settle(page)
    tk.rect("checkerBtn", btn)
    click(page, btn, 300, 0)
    tk.mark("checker")
    page.wait_for_selector("[data-checker-test]", timeout=20000)
    page.wait_for_timeout(1200)
    tk.rect("checkerTests", page.locator("[data-checker-test]").first.locator("xpath=.."))
    tk.rect("checker1", page.locator("[data-checker-test]").first)
    tk.rect("checker2", page.locator("[data-checker-test]").last)
    tk.qa("checker", ["[data-checker-test]"])
    page.mouse.move(1250, 640, steps=10)
    page.wait_for_timeout(3500)
    tk.stop()
    ctx.close()


def take_draft(browser, dispute_id, name, chip_text, message=True, query=""):
    """A case's response panel: Claude's note (AI label), the buyer message (optional), a source chip that
    lights up its timeline row, and "What PayPal receives" (the request, plus the evidence pack PDF link
    when one is attached)."""
    ctx, page = context(browser)
    page.goto(f"{BASE}/disputes/{dispute_id}?run=1&pace=0.05{query}", wait_until="domcontentloaded")
    finished(page)
    page.wait_for_timeout(2600)  # the AI note finishes typing
    scroll_to(page, "#draft-h", smooth=False)
    page.mouse.move(1200, 620)
    page.wait_for_timeout(500)
    tk = Take(ctx, page, name)
    tk.start()
    tk.rect("draftPanel", page.locator("section[aria-labelledby=draft-h]"))
    tk.rect("aiLabel", page.locator("section[aria-labelledby=draft-h] .stamp").first)
    tk.rect("note", page.locator("section[aria-labelledby=draft-h] textarea").first)
    tk.qa("note", ["#draft-h"])
    page.wait_for_timeout(2200)
    tk.mark("claims")
    if message:
        # Down to the claims and the buyer message.
        scroll_to(page, "label[for=msg]", 150, whole=False)
        # The response column is sticky: if the label ended up under the app header, back up until it clears it.
        for _ in range(6):
            off = page.evaluate("""() => { const l = document.querySelector('label[for=msg]').getBoundingClientRect().top;
              const nav = document.getElementById('site-nav').getBoundingClientRect().bottom; return l - nav; }""")
            if off >= 16:
                break
            page.evaluate(f"window.scrollBy({{ top: {off - 40}, behavior: 'instant' }})")
            page.wait_for_timeout(150)
        page.wait_for_timeout(300)
        tk.mark("message")
        # The label, the buyer-language message and its English gloss (not the whole panel around them).
        box = page.evaluate("""() => { const l = document.querySelector('label[for=msg]').getBoundingClientRect();
          const m = document.getElementById('msg'); const g = m.nextElementSibling && m.nextElementSibling.tagName === 'P' ? m.nextElementSibling : m;
          const b = g.getBoundingClientRect(); return { x: l.left, y: l.top, width: Math.max(l.width, b.right - l.left), height: b.bottom - l.top }; }""")
        tk.rects["message"] = {k: round(v * DSF, 1) for k, v in box.items()}
        tk.rect("msgLabel", page.locator("label[for=msg]"))
        tk.qa("message", ["#msg"])
        page.wait_for_timeout(2600)
    # Tap a claim's record chip: the timeline row lights up.
    chip = page.locator("section[aria-labelledby=draft-h] a[href^='#ev-']").filter(has_text=chip_text)
    if not chip.count():
        chip = page.locator("section[aria-labelledby=draft-h] a[href^='#ev-']")
    chip.first.scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    tk.rect("chip", chip)
    click(page, chip, 260, 0)
    tk.mark("chip")
    page.wait_for_timeout(900)
    settle(page)
    page.wait_for_timeout(600)
    tk.mark("row")
    tgt = page.locator(":target")
    if tgt.count():
        tk.rect("row", tgt)
    tk.qa("row")
    page.wait_for_timeout(1800)
    scroll_to(page, "#draft-h")
    page.wait_for_timeout(400)
    click(page, page.get_by_role("tab", name="What PayPal receives"), 260, 0)
    tk.mark("receives")
    page.wait_for_timeout(700)
    tk.rect("request", page.locator("section[aria-labelledby=draft-h] pre").first)
    tk.rect("draftPanel2", page.locator("section[aria-labelledby=draft-h]"))
    pack = page.locator("section[aria-labelledby=draft-h] a[href*='/pack']")
    if pack.count():
        page.wait_for_timeout(1600)
        scroll_to(page, "section[aria-labelledby=draft-h] a[href*='/pack']", 260, whole=False)
        page.wait_for_timeout(300)
        tk.mark("pack")
        tk.rect("pack", pack)
        tk.rect("packArea", pack.locator("xpath=.."))
        tk.qa("pack", ["section[aria-labelledby=draft-h] a[href*='/pack']"])
    tk.qa("receives")
    page.mouse.move(1250, 640, steps=12)
    page.wait_for_timeout(3600)
    tk.stop()
    ctx.close()


def take_mugs(browser):
    take_draft(browser, MUGS, "mugs", "Buyer chat")


def take_cafe_draft(browser):
    take_draft(browser, CAFE, "cafe-draft", "Delivered", message=False, query="&rewind=1")  # the featured run: before PayPal's decision


def take_fair(browser):
    """The planter: returned to sender, the store's own note; REFUND lands with "The buyer is right"."""
    ctx, page = context(browser)
    page.goto(f"{BASE}/disputes/{PLANTER}?run=1&pace=0.05", wait_until="domcontentloaded")
    finished(page)
    page.goto(f"{BASE}/disputes/{PLANTER}", wait_until="networkidle")
    scroll_to(page, "#casefile-h", smooth=False)
    page.mouse.move(1250, 640)
    page.wait_for_timeout(400)
    tk = Take(ctx, page, "fair")
    tk.start()
    page.wait_for_timeout(300)
    click(page, page.get_by_role("button", name="Start the agent"), 200, 0)
    tk.mark("start")
    page.wait_for_selector("main .stamp-xl", timeout=40000)
    tk.mark("stamp")
    page.wait_for_timeout(900)
    tk.rect("stamp", page.locator("main .stamp-xl"))
    tk.rect("caseFile", page.locator("section[aria-labelledby=casefile-h]"))
    tk.rect("buyerRight", page.locator("text=The buyer is right"))
    tk.qa("stamp", ["main .stamp-xl", "text:The buyer is right"])
    finished(page)
    page.wait_for_timeout(3000)
    tk.stop()
    ctx.close()


def take_plates(browser):
    """The plates (no tracking): REFUND lands with "You can't prove delivery", then the actions PayPal allows
    right now, the one the rules picked and why not the others."""
    ctx, page = context(browser)
    page.goto(f"{BASE}/disputes/{PLATES}?run=1&pace=0.05", wait_until="domcontentloaded")
    finished(page)
    page.goto(f"{BASE}/disputes/{PLATES}", wait_until="networkidle")
    scroll_to(page, "#casefile-h", smooth=False)
    page.mouse.move(1250, 640)
    page.wait_for_timeout(400)
    tk = Take(ctx, page, "plates")
    tk.start()
    page.wait_for_timeout(300)
    click(page, page.get_by_role("button", name="Start the agent"), 200, 0)
    tk.mark("start")
    page.wait_for_selector("main .stamp-xl", timeout=40000)
    tk.mark("stamp")
    page.wait_for_timeout(900)
    tk.rect("stamp", page.locator("main .stamp-xl"))
    tk.rect("caseFile", page.locator("section[aria-labelledby=casefile-h]"))
    tk.rect("unprovable", page.locator("text=You can't prove delivery: no tracking on record."))
    tk.qa("stamp", ["main .stamp-xl", "text:You can't prove delivery: no tracking on record."])
    finished(page)
    tk.mark("done")
    page.wait_for_timeout(2600)
    h = page.locator("h3:has-text('Actions PayPal allows right now')")
    page.evaluate("""() => { const h = [...document.querySelectorAll('h3')].find(x => x.textContent.includes('Actions PayPal allows right now'));
      const nav = document.getElementById('site-nav').getBoundingClientRect().bottom;
      window.scrollBy({ top: h.getBoundingClientRect().top - nav - 30, behavior: 'smooth' }); }""")
    page.wait_for_timeout(900)
    settle(page)
    tk.mark("actions")
    tk.rect("actions", h.locator("xpath=.."))
    tk.qa("actions", ["text:Actions PayPal allows right now"])
    move(page, 700, 420, 30, 400)
    page.wait_for_timeout(5500)
    tk.stop()
    ctx.close()


def take_insights(browser):
    ctx, page = context(browser)
    page.goto(BASE + "/insights", wait_until="networkidle")
    page.wait_for_timeout(1500)
    page.mouse.move(1250, 640)
    tk = Take(ctx, page, "insights")
    tk.start()
    tk.qa("top")
    page.wait_for_timeout(1500)
    # Scroll just enough to show the whole actions panel (24 px margin) when the page is short; a full
    # scroll_to would stop at the page bottom and leave the page title half under the app header.
    need = page.evaluate("""() => { const r = document.getElementById('actions-h').closest('section').getBoundingClientRect();
      const nav = document.getElementById('site-nav').getBoundingClientRect().bottom;
      return r.height + 24 <= innerHeight - nav ? Math.max(0, r.bottom - innerHeight + 24) : -1; }""")
    if need < 0:
        scroll_to(page, "#actions-h")
    elif need > 0:
        page.evaluate(f"window.scrollBy({{ top: {need}, behavior: 'smooth' }})")
        page.wait_for_timeout(700)
        settle(page)
    tk.mark("actions")
    tk.rect("actions", page.locator("#actions-h").locator("xpath=ancestor::section[1]"))
    tk.qa("actions", ["#actions-h"])
    page.wait_for_timeout(3500)
    # "Lessons from single cases" (rules template, TEMPLATE stamp in frame).
    scroll_to(page, "#lessons-h", 20, whole=False)
    tk.mark("lessons")
    tk.rect("lessons", page.locator("section[aria-labelledby=lessons-h]"))
    tk.qa("lessons", ["#lessons-h"])
    move(page, 1150, 420, 30, 200)
    page.wait_for_timeout(5000)
    tk.stop()
    ctx.close()


# ---------------------------------------------------------------- live takes (sandbox writes, once)
def take_live_offer(browser):
    ctx, page = context(browser)
    page.set_default_timeout(120000)
    page.goto(f"{LIVE}/disputes/{MUGS}", wait_until="networkidle")
    page.mouse.move(1250, 640)
    tk = Take(ctx, page, "live-offer")
    tk.start()
    tk.rect("badge", page.locator("header").get_by_text("LIVE", exact=False).first)
    page.wait_for_timeout(600)
    click(page, page.get_by_role("button", name="Start the agent"), 200, 0)
    tk.mark("start")
    finished(page, 120000)
    tk.mark("done")
    page.wait_for_timeout(2600)
    box = page.get_by_text("I have read this draft and the evidence")
    scroll_to(page, "section[aria-labelledby=draft-h] input[type=checkbox]", 330, whole=False)
    tk.mark("approveArea")
    tk.qa("approve", ["section[aria-labelledby=draft-h] input[type=checkbox]"])
    click(page, box, 260, 300)
    tk.mark("ticked")
    btn = page.locator("section[aria-labelledby=draft-h] button.bg-primary").last
    tk.rect("approve", btn)
    click(page, btn, 300, 0)
    tk.mark("approve")
    page.wait_for_selector("text=Sent to PayPal sandbox", timeout=60000)
    tk.mark("sent")
    page.wait_for_timeout(500)
    page.evaluate("() => { const el = [...document.querySelectorAll('p')].find(p => p.textContent.includes('Sent to PayPal sandbox')); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }")
    page.wait_for_timeout(1000)
    page.evaluate("() => window.scrollBy(0, -90)")
    page.wait_for_timeout(600)
    tk.mark("proof")
    tk.rect("sentLine", page.locator("text=Sent to PayPal sandbox"))
    tk.rect("proof", page.locator("[data-proof]").first)
    if page.locator("[data-proof]").count() > 1:
        tk.rect("reread", page.locator("[data-proof]").nth(1))
    tk.qa("proof", ["[data-proof]"])
    page.mouse.move(1250, 640, steps=10)
    page.wait_for_timeout(4500)
    tk.stop()
    ctx.close()


def take_won(browser):
    ctx, page = context(browser)
    page.set_default_timeout(120000)
    page.goto(f"{LIVE}/disputes/{BOWL}", wait_until="networkidle")
    scroll_to(page, "#sim-h", 14, smooth=False)
    page.mouse.move(1250, 640)
    page.wait_for_timeout(400)
    tk = Take(ctx, page, "won-a")
    tk.start()
    tk.rect("sim", page.locator("section[aria-labelledby=sim-h]"))
    tk.qa("sim", ["#sim-h"])
    page.wait_for_timeout(1200)
    btn = page.get_by_role("button", name="Seller wins")
    tk.rect("sellerWins", btn)
    click(page, btn, 300, 0)
    tk.mark("click")
    page.wait_for_selector("section[aria-labelledby=sim-h] [data-proof]", timeout=60000)
    tk.mark("posted")
    page.wait_for_timeout(600)
    tk.rect("proof", page.locator("section[aria-labelledby=sim-h] [data-proof]"))
    tk.qa("posted", ["section[aria-labelledby=sim-h] [data-proof]"])
    page.mouse.move(1250, 640, steps=10)
    page.wait_for_timeout(4000)
    tk.stop()
    # Off camera: PayPal decides (usually 2-3 min); the page polls and refreshes itself.
    t0 = time.time()
    page.wait_for_selector("header .stamp:has-text('Won')", timeout=10 * 60 * 1000)
    print(f"PayPal resolved the bowl claim after {time.time() - t0:.0f}s (off camera)")
    page.goto(f"{LIVE}/disputes/{BOWL}", wait_until="networkidle")
    page.evaluate("window.scrollTo(0, 0)")
    page.mouse.move(1250, 640)
    page.wait_for_timeout(600)
    tk = Take(ctx, page, "won-b")
    tk.start()
    tk.rect("won", page.locator("main header .stamp").first)
    tk.rect("header", page.locator("main header").first)
    tk.qa("won", ["main header .stamp"])
    page.wait_for_timeout(1600)
    verify = page.get_by_role("button", name="Verify with PayPal")
    tk.rect("verify", verify)
    click(page, verify, 300, 0)
    tk.mark("verify")
    page.wait_for_selector("section[aria-label='Verify with PayPal'] [data-proof]", timeout=60000)
    tk.mark("decision")
    page.wait_for_timeout(500)
    tk.rect("decision", page.locator("section[aria-label='Verify with PayPal'] [data-proof]"))
    tk.qa("decision", ["section[aria-label='Verify with PayPal'] [data-proof]"])
    page.mouse.move(1250, 640, steps=10)
    page.wait_for_timeout(4500)
    tk.stop()
    ctx.close()


def take_cafe_live(browser):
    """LIVE, once: the cafe case end to end. A live agent run, approve -> evidence sent (200, response
    panels); then PayPal's sandbox decision ("Simulate PayPal's decision · SANDBOX" stays in frame), the wait
    off camera, and the WON page with a re-read from PayPal."""
    ctx, page = context(browser)
    page.set_default_timeout(120000)
    page.goto(f"{LIVE}/disputes/{CAFE}", wait_until="networkidle")
    # PayPal may already offer the sandbox decision, whose panel pushes the agent below the fold: start on it.
    scroll_to(page, "#trace-h", smooth=False)
    page.mouse.move(1250, 640)
    tk = Take(ctx, page, "cafe-approve")
    tk.start()
    page.wait_for_timeout(600)
    # The page may still be hydrating: if the click didn't start the run, click again (the run is read-only).
    for _ in range(3):
        click(page, page.get_by_role("button", name="Start the agent"), 200, 0)
        try:
            page.wait_for_selector("text=/Running|Done in/", timeout=4000)
            break
        except Exception:
            print("start click didn't take (hydrating?); clicking again")
    tk.mark("start")
    finished(page, 120000)
    tk.mark("done")
    page.wait_for_timeout(1500)
    tk.rect("stamp", page.locator("main .stamp-xl"))
    tk.rect("caseFile", page.locator("section[aria-labelledby=casefile-h]"))
    page.wait_for_timeout(1500)
    scroll_to(page, "section[aria-labelledby=draft-h] input[type=checkbox]", 330, whole=False)
    tk.mark("approveArea")
    tk.qa("approve", ["section[aria-labelledby=draft-h] input[type=checkbox]"])
    click(page, page.get_by_text("I have read this draft and the evidence"), 260, 300)
    tk.mark("ticked")
    btn = page.locator("section[aria-labelledby=draft-h] button.bg-primary").last
    tk.rect("approve", btn)
    click(page, btn, 300, 0)
    tk.mark("approve")
    page.wait_for_selector("text=Sent to PayPal sandbox", timeout=90000)
    tk.mark("sent")
    page.wait_for_timeout(500)
    page.evaluate("() => { const el = [...document.querySelectorAll('p')].find(p => p.textContent.includes('Sent to PayPal sandbox')); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }")
    page.wait_for_timeout(1000)
    page.evaluate("() => window.scrollBy(0, -90)")
    page.wait_for_timeout(600)
    tk.mark("proof")
    tk.rect("sentLine", page.locator("text=Sent to PayPal sandbox"))
    tk.rect("proof", page.locator("[data-proof]").first)
    if page.locator("[data-proof]").count() > 1:
        tk.rect("reread", page.locator("[data-proof]").nth(1))
    tk.qa("proof", ["[data-proof]"])
    page.mouse.move(1250, 640, steps=10)
    page.wait_for_timeout(4500)
    tk.stop()

    # PayPal's sandbox decision: wait (off camera) until PayPal offers adjudicate on this case.
    for _ in range(60):
        page.goto(f"{LIVE}/disputes/{CAFE}", wait_until="networkidle")
        if page.locator("#sim-h").count():
            break
        print("waiting for PayPal to offer the sandbox decision (adjudicate)...")
        page.wait_for_timeout(30000)
    scroll_to(page, "#sim-h", 14, smooth=False)
    page.mouse.move(1250, 640)
    page.wait_for_timeout(400)
    tk = Take(ctx, page, "cafe-sim")
    tk.start()
    tk.rect("sim", page.locator("section[aria-labelledby=sim-h]"))
    tk.rect("simTitle", page.locator("section[aria-labelledby=sim-h] h2"))
    tk.qa("sim", ["#sim-h"])
    page.wait_for_timeout(1500)
    sw = page.get_by_role("button", name="Seller wins")
    tk.rect("sellerWins", sw)
    click(page, sw, 300, 0)
    tk.mark("click")
    page.wait_for_selector("section[aria-labelledby=sim-h] [data-proof]", timeout=60000)
    tk.mark("posted")
    page.wait_for_timeout(600)
    tk.rect("proof", page.locator("section[aria-labelledby=sim-h] [data-proof]"))
    tk.qa("posted", ["section[aria-labelledby=sim-h] [data-proof]"])
    page.mouse.move(1250, 640, steps=10)
    page.wait_for_timeout(4000)
    tk.stop()
    t0 = time.time()
    page.wait_for_selector("header .stamp:has-text('Won')", timeout=12 * 60 * 1000)
    print(f"PayPal resolved the cafe claim after {time.time() - t0:.0f}s (off camera)")
    page.goto(f"{LIVE}/disputes/{CAFE}", wait_until="networkidle")
    page.evaluate("window.scrollTo(0, 0)")
    page.mouse.move(1250, 640)
    page.wait_for_timeout(600)
    tk = Take(ctx, page, "cafe-won")
    tk.start()
    tk.rect("won", page.locator("main header .stamp").first)
    tk.rect("header", page.locator("main header").first)
    tk.qa("won", ["main header .stamp"])
    page.wait_for_timeout(1600)
    verify = page.get_by_role("button", name="Verify with PayPal")
    tk.rect("verify", verify)
    click(page, verify, 300, 0)
    tk.mark("verify")
    page.wait_for_selector("section[aria-label='Verify with PayPal'] [data-proof]", timeout=60000)
    tk.mark("decision")
    page.wait_for_timeout(500)
    tk.rect("decision", page.locator("section[aria-label='Verify with PayPal'] [data-proof]"))
    tk.qa("decision", ["section[aria-label='Verify with PayPal'] [data-proof]"])
    page.mouse.move(1250, 640, steps=10)
    page.wait_for_timeout(4500)
    tk.stop()
    ctx.close()


TAKES = {"board": take_board, "mugs": take_mugs, "cafe-draft": take_cafe_draft, "fair": take_fair, "plates": take_plates, "insights": take_insights}
LIVE_TAKES = {"live-offer": take_live_offer, "won": take_won, "cafe-live": take_cafe_live}

if __name__ == "__main__":
    only = [t for t in os.environ.get("TAKES", "").split(",") if t] or list(TAKES)
    for name in only:
        if name in LIVE_TAKES and not LIVE:
            sys.exit(f"take {name} writes to the PayPal sandbox: pass the live base URL")
    with sync_playwright() as pw:
        # No font hinting: Linux Chromium otherwise snaps glyphs to the pixel grid ("Def ender"); this matches macOS.
        browser = pw.chromium.launch(args=["--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--font-render-hinting=none"])
        for name in only:
            (TAKES.get(name) or LIVE_TAKES[name])(browser)
        browser.close()
    META_PATH.write_text(json.dumps(META, indent=2))
    (OUT / f"footage-qa-{'-'.join(only)}.json").write_text(json.dumps(QA, indent=2))
    if QA:
        print("LAYOUT QA ISSUES:\n" + "\n".join(f"  {k}: {v}" for k, vs in QA.items() for v in vs))
        sys.exit(1)
    print("footage layout QA: clean")
