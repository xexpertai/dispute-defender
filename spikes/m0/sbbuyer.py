"""Sandbox-buyer automation for the M0 spike (sandbox.paypal.com ONLY).

  python3 sbbuyer.py approve <checkoutnow-url>   # log in as sandbox buyer, pay the order
  python3 sbbuyer.py txns [n]                    # print the newest n buyer-side transaction ids

Rules: headed browser, human-paced; stops immediately on a block / security challenge (no bypass);
retries the sandbox's flaky "Things don't appear to be working" page. Credentials come from
../../.env.local and are never printed.
"""
import os, re, sys, time, random
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(ROOT, "shots")
os.makedirs(SHOTS, exist_ok=True)
env = dict(l.strip().split("=", 1) for l in open(os.path.join(ROOT, "../../.env.local")) if "=" in l)
assert env.get("PAYPAL_ENV") == "sandbox"

def pause(a=1.2, b=2.8): time.sleep(random.uniform(a, b))

def body(p):
    try: return p.inner_text("body")[:4000]
    except Exception: return ""

def blocked(p):
    t = body(p)
    return "You have been blocked" in t or "security challenge" in t.lower()

def stop_if_blocked(p, where):
    if blocked(p):
        p.screenshot(path=f"{SHOTS}/blocked-{where}.png")
        print(f"BLOCKED at {where}; stopping (switch to manual Plan B)")
        sys.exit(2)

def login(p):
    if p.locator("#email").is_visible():
        p.fill("#email", env["PAYPAL_SANDBOX_BUYER_EMAIL"]); pause()
        if p.locator("#btnNext").is_visible(): p.click("#btnNext"); pause(2.5, 4)
    if p.locator("#password").is_visible():
        p.fill("#password", env["PAYPAL_SANDBOX_BUYER_PASSWORD"]); pause()
        p.click("#btnLogin"); pause(6, 9)

def approve(url):
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=False)
        for attempt in range(1, 4):
            ctx = b.new_context(viewport={"width": 1366, "height": 900}); p = ctx.new_page()
            p.goto(url, wait_until="domcontentloaded", timeout=90000); pause(4, 6)
            stop_if_blocked(p, "checkout")
            login(p); stop_if_blocked(p, "login")
            if "appear to be working" in body(p):
                print(f"attempt {attempt}: sandbox error page, retrying"); ctx.close(); pause(4, 7); continue
            btn = p.get_by_role("button", name=re.compile(r"(Complete Purchase|Pay Now|^Pay$|Continue)", re.I)).first
            btn.wait_for(timeout=45000); pause(); btn.click()
            try:
                p.wait_for_url(re.compile(r"example\.com/return"), timeout=60000)
                print(f"APPROVED on attempt {attempt}"); b.close(); return
            except Exception:
                p.screenshot(path=f"{SHOTS}/approve-fail-{attempt}.png", full_page=True)
                if "appear to be working" in body(p):
                    print(f"attempt {attempt}: sandbox error after pay, retrying"); ctx.close(); pause(4, 7); continue
                print(f"attempt {attempt}: no redirect; see shots/approve-fail-{attempt}.png"); ctx.close()
        b.close(); sys.exit(1)

def txns(n=3):
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=False)
        p = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
        p.goto("https://www.sandbox.paypal.com/signin", wait_until="domcontentloaded", timeout=90000); pause(3, 5)
        stop_if_blocked(p, "signin"); login(p); stop_if_blocked(p, "login")
        p.goto("https://www.sandbox.paypal.com/myaccount/activities/", wait_until="domcontentloaded", timeout=90000); pause(5, 7)
        ids = []
        rows = p.get_by_text("Test Store")
        for i in range(min(n, rows.count())):
            rows.nth(i).click(); pause(4, 6)
            found = re.findall(r"Transaction ID\s*\n?\s*([0-9A-Z]{17})", body(p))
            ids += [x for x in found if x not in ids]
            p.go_back(); pause(4, 6)
        p.screenshot(path=f"{SHOTS}/activity.png")
        print("buyer transaction ids (newest first):", ids)
        b.close()

def txns_new(known_path, amount, timeout_s=480):
    """Wait until the buyer's activity shows a transaction id not in known_path (one id per line).
    Sandbox activity can lag a few minutes behind capture, which is why a single read came back empty."""
    known = set()
    if os.path.exists(known_path):
        known = {l.strip() for l in open(known_path) if l.strip()}
    deadline = time.time() + int(timeout_s)
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=False)
        p = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
        p.goto("https://www.sandbox.paypal.com/signin", wait_until="domcontentloaded", timeout=90000); pause(3, 5)
        stop_if_blocked(p, "signin"); login(p); stop_if_blocked(p, "login")
        while time.time() < deadline:
            p.goto("https://www.sandbox.paypal.com/myaccount/activities/", wait_until="domcontentloaded", timeout=90000); pause(5, 7)
            rows = p.get_by_text("Test Store")
            if rows.count():
                rows.nth(0).click(); pause(4, 6)
                text = body(p)
                found = [x for x in re.findall(r"Transaction ID\s*\n?\s*([0-9A-Z]{17})", text) if x not in known]
                if found and f"${amount}" in text:
                    print("NEW_TXN", found[0]); b.close(); return
            print("no new transaction yet; waiting 60 s"); time.sleep(60)
        b.close(); print("NEW_TXN none"); sys.exit(2)

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "approve": approve(sys.argv[2])
    elif cmd == "txns": txns(int(sys.argv[2]) if len(sys.argv) > 2 else 3)
    elif cmd == "txns-new": txns_new(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else 480)
    else: print(__doc__)
