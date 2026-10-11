import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { C, display, ease, mono, PIC_H, sans } from "./theme";
import { END, f, FPS, HITS, SECTIONS, TAKES, Rect, wordAt } from "./data";
import { around, CalloutSpec, Footage, full, Key, Spot, View } from "./components/Footage";
import { Captions } from "./components/Captions";
import { Close, Desk, Hook, How, Mcp, PersonaTurn, Split } from "./scenes/Graphics";

type Tag = { text: string; live?: boolean; at?: number; until?: number };
type Shot = { start: number; end: number; take: string; from: number; rate?: number; keys: Key[]; callouts?: CalloutSpec[]; tag?: Tag; spot?: Spot };

const S = SECTIONS;
const R = (take: string) => TAKES[take].rects;
const M = (take: string) => TAKES[take].marks;
/** Shot-relative time (s) at which a take's moment shows, for a shot that plays `from` at `rate`. */
const when = (take: string, mark: number, from: number, rate = 1) => (mark - from) / rate;
const ASPECT = 1920 / 990;
/**
 * Readable zoom: a view onto a rect (take px) at most `maxW` wide. Takes are 2560 px for 1280 CSS px, so at
 * 1500 px wide the app's 14 px body text renders ~36 px tall at 1080p (12 px labels ~31 px).
 */
const READ = 1500;
const on = (take: string, r: Rect, pad = 60, minW = READ) => around(take, r, pad, ASPECT, minW);
/** The same, but never above `top` (take px), so a zoom never shows a half-cut app header. */
const below = (take: string, r: Rect, top = 320, pad = 60, minW = READ): View => {
  const v = on(take, r, pad, minW);
  return { ...v, y: Math.min(Math.max(v.y, top), Math.max(0, TAKES[take].height - v.w / ASPECT)) };
};
const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};
const REPLAY: Tag = { text: "Replay · recorded from PayPal's sandbox APIs" };
const LIVE: Tag = { text: "LIVE · PayPal sandbox", live: true };

function shots(): Shot[] {
  const out: Shot[] = [];
  // The case board: money at risk and the next deadline, zoomed so the numbers read on a phone.
  {
    const from = 0.3, board = R("board");
    out.push({
      start: S.board, end: S.calls, take: "board", from,
      keys: [{ t: 0, view: full("board") }, { t: 0.5, view: on("board", union(board.risk, board.watch), 40, 1700), dur: 1.4 }],
      callouts: [{ text: "Your move first, then $ × deadline", target: board.deadline, at: when("board", M("board").deadline, from) - 0.6, side: "bottom" }],
      tag: REPLAY,
    });
  }
  // The agent's call on all 7 cases (fixed rules, Replay data): the whole card, then each half as the voice names it.
  {
    const c = R("board").calls, from = M("board").calls - 0.25;
    // Each half at a readable zoom, its top just under the app header (no half-cut header in frame).
    const HW = 1300, half = (i: number): View => ({ x: i === 0 ? c.x - 40 : c.x + c.width + 40 - HW, y: c.y - 60, w: HW });
    out.push({
      start: S.calls, end: S.hero, take: "board", from,
      keys: [
        { t: 0, view: on("board", c, 40, 1700) },
        { t: wordAt("calls", "defend") - S.calls - 0.2, view: half(0), dur: 0.8 },
        { t: wordAt("calls", "refund") - S.calls - 0.3, view: half(1), dur: 0.8 },
      ],
      tag: REPLAY,
    });
  }
  // Hero: one click on the cafe case; the trace runs, records drop into the case file, DEFEND lands.
  {
    const mid = S.hero + 9.8;  // the checker beat starts here
    const from = M("board").beforeClick - 0.45, endAt = M("board").done + 1.2, rate = (endAt - from) / (mid - S.hero);
    const stampT = when("board", M("board").stamp, from, rate);
    out.push({
      start: S.hero, end: mid, take: "board", from, rate,
      keys: [{ t: 0, view: full("board") }, { t: stampT + 0.3, view: below("board", R("board").caseFile, 300, 30, 1650), dur: 1.0 }],
      tag: REPLAY,
    });
    // "Test our checker": two made-up claims injected and struck out by the server, zoomed.
    const cFrom = M("board").checker - 0.7;
    out.push({
      start: mid, end: S.draft, take: "board", from: cFrom,
      keys: [{ t: 0, view: on("board", R("board").checkerTests, 60, 1300) }],
      callouts: [{ text: "Made-up claims, removed by our server", target: R("board").checker1, at: 1.6, side: "right", box: false, line: false,
        pill: { x: R("board").checker2.x, y: R("board").checker2.y + R("board").checker2.height + 24 } }],
      tag: REPLAY,
    });
  }
  // The draft (same case): Claude's note with its AI label, then a tap on a record chip.
  {
    const T = "cafe-draft", aEnd = S.draft + 2.0, bFrom = M(T).chip - 1.0;
    out.push({
      start: S.draft, end: aEnd, take: T, from: 0.0,
      keys: [{ t: 0, view: on(T, union(R(T).aiLabel, R(T).note), 50, 1400) }],
      callouts: [{ text: "", target: R(T).aiLabel, at: 0.2, side: "top", line: false }],
      tag: REPLAY,
    });
    out.push({ start: aEnd, end: S.receives, take: T, from: bFrom, keys: [{ t: 0, view: full(T) }, { t: 1.2, view: on(T, R(T).row ?? R(T).chip, 80, 1400), dur: 0.8 }], tag: REPLAY });
  }
  // What PayPal receives: the provide-supporting-info request and the evidence pack PDF.
  {
    const T = "cafe-draft", from = M(T).receives - 0.6, packT = M(T).pack !== undefined ? when(T, M(T).pack, from) : 99;
    out.push({
      start: S.receives, end: S.live, take: T, from,
      keys: [
        { t: 0, view: on(T, R(T).request, 60, 1450) },
        ...(R(T).packArea ? [{ t: packT + 0.1, view: on(T, R(T).packArea, 120, 1450), dur: 0.8 }] : []),
      ],
      callouts: [
        // Box only (a pill would cover the JSON); it ends before the take scrolls down to the PDF (~1 s before the mark).
        { text: "", target: R(T).request, at: 0.6, until: Math.min(packT, 99) - 1.3, side: "left", line: false },
        ...(R(T).pack ? [{ text: "Evidence pack (PDF)", target: R(T).pack, at: packT + 0.9, side: "right" as const }] : []),
      ],
      tag: REPLAY,
    });
  }
  // LIVE: approve -> evidence sent (200) -> PayPal's response panels, zoomed.
  {
    const T = "cafe-approve", from = M(T).approveArea - 0.3, endAt = TAKES[T].seconds - 0.1, rate = (endAt - from) / (S.won - S.live);
    const proofT = when(T, M(T).proof, from, rate);
    // Zoomed on the response panels only (the case-file column on the left stays out of frame): first PayPal's
    // POST response, then the re-read.
    out.push({
      start: S.live, end: S.won, take: T, from, rate,
      keys: [
        { t: 0, view: below(T, R(T).approve, 0, 260, 1400) },
        { t: proofT - 0.2, view: on(T, union(R(T).sentLine, R(T).proof), 30, 1300), dur: 0.9 },
        ...(R(T).reread ? [{ t: proofT + 2.1, view: on(T, R(T).reread, 30, 1300), dur: 0.9 }] : []),
      ],
      callouts: [{ text: "Straight from PayPal's Disputes API", target: R(T).proof, at: proofT + 0.7, until: R(T).reread ? proofT + 2.0 : undefined, side: "right", box: false, line: false,
        pill: { x: R(T).sentLine.x + 700, y: R(T).sentLine.y - 12 } }],
      tag: LIVE,
    });
  }
  // LIVE: the sandbox decision, said plainly: we trigger it (label in frame), PayPal records the outcome.
  {
    const A = "cafe-sim", aFrom = Math.max(0, M(A).click - 0.8), mid = HITS.won;
    // PayPal's POST response must be readable for ~1.8 s before the cut (the sandbox POST took ~4 s here).
    const simRate = Math.max(1, (M(A).posted - aFrom) / (mid - S.won - 1.8));
    out.push({
      start: S.won, end: mid, take: A, from: aFrom, rate: simRate,
      keys: [{ t: 0, view: on(A, R(A).sim, 40, 1500) }, { t: when(A, M(A).posted, aFrom, simRate) + 0.1, view: on(A, union(R(A).simTitle, R(A).proof), 40, 1500), dur: 0.8 }],
      callouts: [{ text: "Sandbox test endpoint: we trigger the decision", target: R(A).simTitle, at: 0.4, side: "right", box: true,
        pill: { x: R(A).simTitle.x + R(A).simTitle.width + 40, y: R(A).simTitle.y - 30 } }],
      tag: LIVE,
    });
    // The WON page, then the re-read: RESOLVED · SELLER_FAVOUR held large.
    const W = "cafe-won", b1From = 1.0, b1End = mid + (M(W).verify + 0.25 - b1From);
    out.push({
      start: mid, end: b1End, take: W, from: b1From, keys: [{ t: 0, view: below(W, union(R(W).header, R(W).verify), 0, 40, 1600) }],
      callouts: [{ text: "Sandbox test decision · triggered by us", target: R(W).won, at: 0.2, side: "left", box: true }],
      tag: LIVE,
    });
    const dec = R(W).decision;
    out.push({
      start: b1End, end: S.second, take: W, from: M(W).decision - 0.05,
      // A slow push onto the status line (the label pill under the panel stays in frame): no static hold.
      keys: [{ t: 0, view: { x: dec.x - 40, y: Math.min(dec.y - 110, TAKES[W].height - 1300 / ASPECT), w: 1300 } },
        { t: 1.2, view: { x: dec.x - 30, y: Math.min(dec.y - 64, dec.y + dec.height + 85 - 1000 / ASPECT), w: 1000 }, dur: 3.6 }],
      callouts: [{ text: "PayPal records it: won · sandbox test decision", target: dec, at: 0.35, side: "right", box: false, line: false, pill: { x: dec.x, y: dec.y + dec.height + 24 } }],
      tag: LIVE,
    });
  }
  // A second case (after its title card): the mugs, a fair offer, the buyer's Spanish message.
  {
    const T = "mugs", start = S.second + CARD, from = M(T).message - 0.15, rate = (M(T).chip - 0.5 - from) / (S.fair - start);
    out.push({
      start, end: S.fair, take: T, from, rate,
      keys: [{ t: 0, view: on(T, R(T).message, 100, 1350) }],
      // Ends before the take scrolls on to the claim chip (2.6 s after the message mark), so it never sits on the text.
      callouts: [{ text: "In the buyer's language", target: R(T).msgLabel, at: 0.8, until: when(T, M(T).message + 2.5, from, rate), side: "left", box: false, line: false, pill: { x: R(T).msgLabel.x, y: 1000 } }],
      tag: REPLAY,
    });
  }
  // Buyer is right: the planter. REFUND lands with "The buyer is right".
  {
    const T = "fair", from = M(T).stamp - 2.85, st = when(T, M(T).stamp, from);
    out.push({
      start: S.fair, end: S.vyz, take: T, from,
      keys: [{ t: 0, view: full(T) }, { t: st + 0.3, view: below(T, R(T).caseFile, 300, 30, 1650), dur: 0.9 }],
      callouts: [{ text: "Fair to the buyer, too", target: R(T).buyerRight, at: st + 1.4, side: "bottom", line: false,
        pill: { x: R(T).buyerRight.x, y: R(T).caseFile.y + R(T).caseFile.height + 30 } }],
      tag: REPLAY,
    });
  }
  // No tracking on the plates: REFUND with "You can't prove delivery" (not "the buyer is right").
  {
    const T = "plates", from = M(T).stamp - 2.6, st = when(T, M(T).stamp, from);
    out.push({
      start: S.vyz, end: S.actions, take: T, from,
      keys: [{ t: 0, view: full(T) }, { t: st + 0.3, view: below(T, R(T).caseFile, 300, 30, 1650), dur: 0.9 }],
      callouts: [{ text: "", target: R(T).unprovable, at: st + 1.3, side: "bottom", line: false }],
      tag: REPLAY,
    });
    // Every action PayPal allows right now: the one the rules picked, and why not the others.
    out.push({
      start: S.actions, end: S.split, take: T, from: M(T).actions + 0.2,
      // Just under the app header (no half-cut header in frame).
      keys: [{ t: 0, view: { x: R(T).actions.x - 60, y: Math.max(R(T).actions.y - 30, 200), w: 1400 } }],
      tag: { text: "Replay · the rules pick from PayPal's own links" },
    });
  }
  // Insights, zoomed onto the patterns and the suggested changes, then the single-case lessons (rules template).
  {
    const T = "insights", from = 0.4, rate = (M(T).lessons - 0.5 - from) / (S.lessons - S.insights);
    const a = R(T).actions;
    out.push({
      start: S.insights, end: S.lessons, take: T, from, rate,
      keys: [{ t: 0, view: full(T) }, ...(a ? [{ t: 0.6, view: below(T, a, 160, 40, 1600), dur: 1.2 }] : [])],
      tag: { text: "And prevent the next one" },
    });
    out.push({
      start: S.lessons, end: S.mcp, take: T, from: M(T).lessons + 0.2,
      // The whole page first (both lessons and the TEMPLATE stamp, nothing cut), then a push onto the lesson the voice cites.
      keys: [{ t: 0, view: full(T) },
        { t: wordAt("lessons", "ask") - S.lessons - 0.4, view: { x: R(T).lessons.x - 40, y: TAKES[T].height - 1300 / ASPECT, w: 1300 }, dur: 0.9 }],
      tag: { text: "Template · fixed rules, not AI" },
    });
  }
  return out;
}
/** The "A second case" title card's length (s). */
const CARD = 1.6;

const ShotView = ({ s }: { s: Shot }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const at = s.tag?.at ?? 0.5;
  const tagP = s.tag ? ease(Math.min(1, Math.max(0, (t - at) / 0.4))) * (s.tag.until === undefined ? 1 : 1 - ease(Math.min(1, Math.max(0, (t - s.tag.until) / 0.3)))) : 0;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ height: PIC_H, overflow: "hidden" }}>
        <Footage take={s.take} from={s.from} rate={s.rate} keys={s.keys} callouts={s.callouts} spot={s.spot} />
      </AbsoluteFill>
      {s.tag && (
        // In the caption band, left of the captions: a tag never sits on the app's content.
        <div style={{ position: "absolute", left: 28, top: PIC_H + 22, opacity: tagP, padding: "6px 16px", borderRadius: 999, whiteSpace: "nowrap",
          background: C.bg, border: `2px solid ${s.tag.live ? C.win : C.manila}`, color: C.ink, fontFamily: sans, fontWeight: 700, fontSize: 21 }}>
          <span style={{ color: s.tag.live ? C.win : C.manila }}>●</span> {s.tag.text}
        </div>
      )}
    </AbsoluteFill>
  );
};

/** The MCP beat, with its tag in the caption band like every shot. */
const McpShot = () => {
  const t = useCurrentFrame() / FPS;
  const p = ease(Math.min(1, Math.max(0, (t - 0.5) / 0.4)));
  return (
    <AbsoluteFill>
      <Mcp start={S.mcp} end={S.how} />
      <div style={{ position: "absolute", left: 28, top: PIC_H + 22, opacity: p, padding: "6px 16px", borderRadius: 999, whiteSpace: "nowrap",
        background: C.bg, border: `2px solid ${C.manila}`, color: C.ink, fontFamily: sans, fontWeight: 700, fontSize: 21 }}>
        <span style={{ color: C.manila }}>●</span> Replay · a real MCP call
      </div>
    </AbsoluteFill>
  );
};

/** "A second case": says plainly that the story moves to another dispute. */
const SecondCase = () => {
  const t = useCurrentFrame() / FPS;
  const p = ease(Math.min(1, t / 0.35)), out = ease(Math.min(1, Math.max(0, (t - (CARD - 0.25)) / 0.25)));
  return (
    <Desk>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 18, opacity: p * (1 - out) }}>
        <div style={{ fontFamily: mono, fontSize: 30, color: C.manila, letterSpacing: 3 }}>PP-R-KFL-10190426 · $64.00</div>
        <div style={{ fontFamily: display, fontWeight: 900, fontSize: 104, color: C.ink, transform: `translateY(${(1 - p) * 16}px)` }}>A SECOND CASE</div>
        <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 44, color: C.muted }}>Two mugs arrived chipped: a fair offer is smarter</div>
      </AbsoluteFill>
    </Desk>
  );
};

export const Story = () => {
  const frame = useCurrentFrame();
  const fadeOut = interpolate(frame, [f(END) - 15, f(END)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const seq = (start: number, end: number, node: React.ReactNode, key: string) => (
    <Sequence key={key} from={f(start)} durationInFrames={f(end) - f(start)}>{node}</Sequence>
  );
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {seq(0, S.persona, <Hook start={0} />, "hook")}
      {seq(S.persona, S.board, <PersonaTurn start={S.persona} />, "persona")}
      {shots().map((s, i) => seq(s.start, s.end, <ShotView s={s} />, `shot${i}`))}
      {seq(S.second, S.second + CARD, <SecondCase />, "second")}
      {seq(S.split, S.insights + 0.3, <Split start={S.split} end={S.insights} />, "split")}
      {seq(S.mcp, S.how, <McpShot />, "mcp")}
      {seq(S.how, S.close, <How start={S.how} />, "how")}
      {seq(S.close, END, <Close start={S.close} />, "close")}
      <Captions />
      <AbsoluteFill style={{ background: "#000", opacity: fadeOut }} />
    </AbsoluteFill>
  );
};
