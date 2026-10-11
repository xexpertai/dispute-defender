import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame } from "remotion";
import { C, display, ease, mono, PIC_H, sans } from "../theme";
import { CONFIG, FPS, HITS, MCP, SECTIONS, line, wordAt } from "../data";
import { Footage, full } from "../components/Footage";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
/** 0..1 progress of an eased transition starting at `at` (absolute s) over `dur`. */
export const prog = (t: number, at: number, dur = 0.45) => ease(Math.min(1, Math.max(0, (t - at) / dur)));
const pop = (t: number, at: number, damping = 12, stiffness = 170) => spring({ frame: Math.max(0, (t - at) * FPS), fps: FPS, config: { damping, stiffness } });
export const useT = (start: number) => useCurrentFrame() / FPS + start;

/** The ink-navy desk: a soft lamp light and a fixed paper grain (inside the picture area only). */
export const Desk = ({ children, lamp = 1 }: { children?: React.ReactNode; lamp?: number }) => {
  // A slow push on every graphic scene (0.5 %/s): never a static hold.
  const drift = 1 + 0.005 * (useCurrentFrame() / FPS);
  return (
  <AbsoluteFill style={{ height: PIC_H, background: C.bg, overflow: "hidden" }}>
    <AbsoluteFill style={{ background: `radial-gradient(1100px 760px at 50% 38%, rgba(236,213,147,${0.10 * lamp}), transparent 65%), radial-gradient(900px 600px at 85% 95%, rgba(92,200,224,${0.05 * lamp}), transparent 60%)` }} />
    <AbsoluteFill style={{ transform: `scale(${drift})` }}>{children}</AbsoluteFill>
    <svg width="1920" height={PIC_H} style={{ position: "absolute", inset: 0, opacity: 0.06, mixBlendMode: "screen", pointerEvents: "none" }}>
      <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="5" /><feColorMatrix type="saturate" values="0" /></filter>
      <rect width="100%" height="100%" filter="url(#grain)" />
    </svg>
  </AbsoluteFill>
  );
};

/** A rubber stamp that slams down: scale from large, a slight tilt, an ink-bleed edge. */
export const Stamp = ({ word, color, t, at, size = 64, tilt = -8, style }: { word: string; color: string; t: number; at: number; size?: number; tilt?: number; style?: React.CSSProperties }) => {
  if (t < at - 0.02) return null;
  const p = pop(t, at, 14, 260);
  return (
    <div style={{ display: "inline-block", transform: `rotate(${tilt}deg) scale(${1.9 - 0.9 * p})`, opacity: Math.min(1, (t - at + 0.02) / 0.06), border: `${size / 9}px solid ${color}`, borderRadius: size / 6,
      padding: `${size * 0.08}px ${size * 0.32}px`, color, fontFamily: display, fontWeight: 900, fontSize: size, letterSpacing: size * 0.08, lineHeight: 1.05,
      boxShadow: `inset 0 0 0 ${size / 28}px rgba(255,255,255,.15)`, ...style }}>
      {word}
    </div>
  );
};

/** A manila folder tab with a mono label. */
const Tab = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ display: "inline-block", whiteSpace: "nowrap", background: C.manila, color: C.manilaInk, fontFamily: mono, fontSize: 22, padding: "8px 26px 8px 18px", clipPath: "polygon(0 0, 88% 0, 100% 100%, 0 100%)", ...style }}>{children}</div>
);

/** A paper case card: manila tab on top, paper body. */
const Card = ({ tab, children, w = 520, style }: { tab: string; children: React.ReactNode; w?: number; style?: React.CSSProperties }) => (
  <div style={{ width: w, ...style }}>
    <Tab>{tab}</Tab>
    <div style={{ background: C.paper, color: C.paperInk, borderRadius: "0 14px 14px 14px", padding: "28px 34px", boxShadow: "0 30px 60px -24px rgba(0,0,0,.65)" }}>{children}</div>
  </div>
);

// ------------------------------------------------------------------ 1. hook
export const Hook = ({ start }: { start: number }) => {
  const t = useT(start);
  const land = 0.35;
  const cardP = pop(t, land, 15, 190);
  const h2 = line("hook2").at;
  const clockP = prog(t, h2 - 0.1, 0.4);
  const exit = prog(t, SECTIONS.persona - 0.3, 0.3);
  return (
    <AbsoluteFill>
    <Desk>
      {/* The product from frame one: the real case board, dimmed behind the dispute notice. */}
      <AbsoluteFill style={{ filter: "blur(2px) brightness(0.42) saturate(0.8)", opacity: 1 - exit, transform: `scale(${1.04 - 0.02 * Math.min(1, t / 7)})` }}>
        <Footage take="board" from={0.3} keys={[{ t: 0, view: full("board") }]} />
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 960 - 360, top: 170 - 40 * (1 - cardP) + 30 * exit, transform: `rotate(${-2.5 + 2.5 * cardP}deg) scale(${1.25 - 0.25 * cardP})`, opacity: Math.min(1, cardP * 1.5) * (1 - exit) }}>
        <Card tab="Dispute notice · PayPal" w={720}>
          <div style={{ fontFamily: sans, fontSize: 24, color: C.paperMuted }}>A buyer opened a case</div>
          <div style={{ fontFamily: display, fontWeight: 900, fontSize: 62, marginTop: 6, letterSpacing: 1 }}>ITEM NOT RECEIVED</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 10 }}>
            <span style={{ fontFamily: display, fontWeight: 800, fontSize: 92 }}>$312.00</span>
            <span style={{ fontFamily: sans, fontSize: 24, color: C.paperMuted }}>funds on hold</span>
          </div>
          <div style={{ marginTop: 26, display: "flex", alignItems: "center", gap: 18, opacity: clockP, transform: `translateY(${(1 - clockP) * 10}px)` }}>
            <svg width="64" height="64" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" fill="none" stroke="#a35a00" strokeWidth="5" />
              <line x1="32" y1="32" x2={32 + 20 * Math.sin(t * 5)} y2={32 - 20 * Math.cos(t * 5)} stroke="#a35a00" strokeWidth="5" strokeLinecap="round" />
              <circle cx="32" cy="32" r="4" fill="#a35a00" />
            </svg>
            {/* This case (PP-R-FWW-10190477) had no seller deadline: PayPal was reviewing it. No invented deadline here. */}
            <span style={{ fontFamily: display, fontWeight: 800, fontSize: 44, color: "#a35a00", whiteSpace: "nowrap" }}>PayPal reviewing: prove it</span>
          </div>
        </Card>
      </div>
    </Desk>
    {/* In the caption band (left of the captions), never over the app; Desk clips to the picture area. */}
    <div style={{ position: "absolute", left: 32, top: PIC_H + 30, opacity: 0.85 * (1 - exit), fontFamily: sans, fontWeight: 600, fontSize: 22, color: C.manila }}>Dispute Defender · the case board</div>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ 2+3. persona and the turn
/** Priya and her studio: a flat illustration drawn here (fictional; no photo, no real person). */
const Studio = () => (
  <svg width="900" height="640" viewBox="0 0 900 640">
    {/* back wall shelves with mugs and bowls */}
    {[110, 230].map((y, r) => (
      <g key={r}>
        <rect x="40" y={y} width="520" height="12" rx="4" fill="#5b4a36" />
        {Array.from({ length: 7 }, (_, i) => {
          const x = 70 + i * 70, c = ["#c96f4a", "#e8d9bd", "#6f8fa6", "#d9a441", "#8aa483", "#e8d9bd", "#b85a5a"][(i + r * 3) % 7];
          return i % 2 === r % 2
            ? <g key={i}><rect x={x} y={y - 46} width="40" height="46" rx="7" fill={c} /><path d={`M${x + 40} ${y - 36} q16 0 16 14 q0 14 -16 14`} stroke={c} strokeWidth="6" fill="none" /></g>
            : <path key={i} d={`M${x - 6} ${y - 30} h56 q-6 30 -28 30 q-22 0 -28 -30z`} fill={c} />;
        })}
      </g>
    ))}
    {/* the kiln */}
    <g>
      <rect x="640" y="150" width="210" height="300" rx="26" fill="#8d97a6" />
      <rect x="664" y="180" width="162" height="190" rx="14" fill="#6d7686" />
      <circle cx="745" cy="410" r="14" fill="#d9a441" />
      <rect x="690" y="120" width="110" height="34" rx="10" fill="#6d7686" />
      <path d="M720 108 q8 -22 0 -40 M770 108 q8 -22 0 -40" stroke="#c9ad66" strokeWidth="6" fill="none" strokeLinecap="round" opacity="0.7" />
    </g>
    {/* packing table */}
    <rect x="30" y="470" width="840" height="26" rx="8" fill="#7a5c3e" />
    <rect x="70" y="496" width="22" height="144" fill="#5b4a36" />
    <rect x="800" y="496" width="22" height="144" fill="#5b4a36" />
    {/* boxes */}
    <rect x="520" y="380" width="150" height="90" rx="6" fill="#c9a26a" />
    <rect x="520" y="380" width="150" height="20" fill="#b48c55" />
    <rect x="690" y="410" width="110" height="60" rx="6" fill="#c9a26a" />
    {/* Priya: bun, apron, holding a bowl */}
    <g>
      <path d="M150 470 q0 -150 110 -160 q110 10 110 160z" fill="#2f5d62" />
      <path d="M200 470 v-120 q60 -30 120 0 v120z" fill="#e8d9bd" />
      <rect x="244" y="270" width="32" height="48" rx="14" fill="#9b6a4b" />
      <ellipse cx="260" cy="228" rx="56" ry="64" fill="#b07a55" />
      <path d="M204 222 q0 -76 56 -78 q60 2 58 78 q-16 -40 -58 -42 q-40 2 -56 42z" fill="#1d1512" />
      <circle cx="262" cy="148" r="30" fill="#1d1512" />
      <ellipse cx="240" cy="236" rx="5" ry="6" fill="#1d1512" />
      <ellipse cx="282" cy="236" rx="5" ry="6" fill="#1d1512" />
      <path d="M244 262 q16 12 32 0" stroke="#6b3d2a" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M220 400 h84 q-8 40 -42 40 q-34 0 -42 -40z" fill="#6f8fa6" />
    </g>
    {/* her studio mate, packing (seen from the side) */}
    <g>
      <path d="M560 380 q0 -110 80 -118 q80 8 80 118z" fill="#7a4b6b" opacity="0.95" />
      <ellipse cx="640" cy="222" rx="44" ry="50" fill="#d6a07c" />
      <path d="M596 216 q4 -56 46 -56 q44 2 42 52 q-20 -26 -44 -26 q-28 0 -44 30z" fill="#6b4a2e" />
    </g>
  </svg>
);

const DISPUTES = [
  { tab: "Not received", amt: "$142.00", rot: -9, x: -360 },
  { tab: "Not as described", amt: "$64.00", rot: 2, x: 0 },
  { tab: "Unauthorized", amt: "Who paid?", rot: 10, x: 360 },
];

export const PersonaTurn = ({ start }: { start: number }) => {
  const t = useT(start);
  const p1 = line("priya1").at, p2 = line("priya2").at;
  const turn = SECTIONS.turn, logo = HITS.logo;
  const studioIn = prog(t, SECTIONS.persona, 0.35);
  const toSide = prog(t, p2 - 0.3, 0.8);
  const cardsAt = (i: number) => p2 + 0.2 + i * 0.35;
  const stack = prog(t, logo - 1.2, 0.9);     // the cards gather into one case file before the logo
  const tagP = prog(t, SECTIONS.persona, 0.3) * (1 - prog(t, logo - 0.6, 0.3));
  const logoP = pop(t, logo - 0.12, 13, 170);
  const flash = interpolate(t, [logo - 0.02, logo + 0.03, logo + 0.35], [0, 0.22, 0], clamp);
  const words = ["Fight?", "Offer?", "Refund?"];
  const wordAtI = (i: number) => wordAt("priya2", ["fight", "offer", "refund"][i]) - 0.05;
  return (
    <Desk>
      <div style={{ position: "absolute", left: 80, top: 56, opacity: tagP, padding: "8px 20px", borderRadius: 999, border: `2px solid ${C.manila}`, color: C.manila, fontFamily: sans, fontWeight: 700, fontSize: 24, letterSpacing: 2 }}>
        FICTIONAL EXAMPLE
      </div>
      <div style={{ position: "absolute", left: 120 - 60 * toSide, top: 250 + 40 * toSide, transform: `scale(${1 - 0.32 * toSide})`, transformOrigin: "left top", opacity: studioIn * (1 - prog(t, turn - 0.6, 0.5)) }}>
        <Studio />
      </div>
      <div style={{ position: "absolute", left: 1080, top: 300, opacity: prog(t, p1 - 0.1, 0.4) * (1 - prog(t, p2 - 0.4, 0.35)) }}>
        <div style={{ fontFamily: display, fontWeight: 900, fontSize: 140, color: C.ink, lineHeight: 1 }}>MEET PRIYA</div>
        <div style={{ fontFamily: sans, fontSize: 44, color: C.manila, marginTop: 22 }}>Kiln &amp; Clay Studio</div>
        <div style={{ fontFamily: sans, fontSize: 34, color: C.muted, marginTop: 8 }}>a two-person ceramics shop</div>
      </div>
      {/* three disputes fan out, then stack into a case file */}
      {DISPUTES.map((d, i) => {
        const p = pop(t, cardsAt(i), 13, 160);
        if (t < cardsAt(i)) return null;
        const x = 1310 + d.x * 0.95 * (1 - stack), r = d.rot * (1 - stack), y = 330 + 20 * Math.abs(i - 1) * (1 - stack) - 10 * i * stack;
        const q = prog(t, wordAtI(i), 0.25) * (1 - stack);
        return (
          <div key={i} style={{ position: "absolute", left: x - 165, top: y - 60 * (1 - p), transform: `rotate(${r}deg) scale(${0.6 + 0.4 * p})`, opacity: Math.min(1, p * 1.4) * (1 - prog(t, logo - 0.15, 0.15)) }}>
            <Card tab={d.tab} w={330}>
              <div style={{ fontFamily: display, fontWeight: 800, fontSize: d.amt.startsWith("$") ? 64 : 50, height: 77, display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>{d.amt}</div>
              <div style={{ fontFamily: display, fontWeight: 900, fontSize: 120, color: "#a35a00", textAlign: "center", lineHeight: 1, opacity: q, transform: `scale(${0.6 + 0.4 * q})` }}>?</div>
            </Card>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 980, width: 900, top: 760, textAlign: "center", fontFamily: display, fontWeight: 900, fontSize: 84, color: C.ink, opacity: 1 - stack }}>
        {words.map((w, i) => {
          const p = prog(t, wordAtI(i), 0.25);
          return <span key={w} style={{ display: "inline-block", marginRight: 30, opacity: p, transform: `translateY(${(1 - p) * 20}px)`, color: i === 0 ? C.win : i === 1 ? C.manila : C.loss }}>{w}</span>;
        })}
      </div>
      {t >= logo - 0.12 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", opacity: 1 - prog(t, SECTIONS.board - 0.15, 0.15) }}>
          <svg width="150" height="170" viewBox="0 0 24 27" style={{ transform: `scale(${0.6 + 0.4 * logoP})`, opacity: Math.min(1, logoP * 1.4) }}>
            <path d="M12 1 L22 5 V12 C22 19 17.5 23.5 12 26 C6.5 23.5 2 19 2 12 V5 Z" fill={C.manila} />
            <path d="M7.5 13.2 L10.8 16.5 L16.8 9.8" stroke={C.bg} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ fontFamily: display, fontWeight: 900, fontSize: 150, color: C.ink, letterSpacing: 2, marginTop: 20, transform: `scale(${1.2 - 0.2 * logoP})`, opacity: Math.min(1, logoP * 1.4) }}>
            DISPUTE DEFENDER
          </div>
          <div style={{ marginTop: 26, fontFamily: sans, fontWeight: 600, fontSize: 46, color: C.manila, opacity: prog(t, logo + 0.6, 0.4) }}>
            Win the disputes worth fighting. Settle the rest fairly.
          </div>
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{ background: C.manila, opacity: flash }} />
    </Desk>
  );
};

// ------------------------------------------------------------------ 5. before / after
const Sticky = ({ x, y, r, text }: { x: number; y: number; r: number; text: string }) => (
  <div style={{ position: "absolute", left: x, top: y, width: 230, height: 190, background: "#d9cf8a", transform: `rotate(${r}deg)`, padding: 22, boxSizing: "border-box",
    fontFamily: "'Comic Sans MS', 'Marker Felt', cursive", fontSize: 30, color: "#3d3a2a", boxShadow: "0 16px 28px -14px rgba(0,0,0,.7)" }}>{text}</div>
);

export const Split = ({ start, end }: { start: number; end: number }) => {
  const t = useT(start);
  const inP = prog(t, start, 0.5);
  // A crossfade into the next shot (the scene runs 0.3 s past `end`, on top of it): no empty dark frames.
  const out = prog(t, end - 0.05, 0.35);
  const after = [
    { tab: "PP-R-WEO-10190424", amt: "$89.00", word: "DEFEND", color: C.stampGreen },
    { tab: "PP-R-KFL-10190426", amt: "$64.00", word: "OFFER", color: "#a35a00" },
    { tab: "PP-R-FDW-10190427", amt: "$28.50", word: "REFUND", color: C.stampRed },
  ];
  return (
    <AbsoluteFill style={{ opacity: 1 - out }}>
    <Desk>
      <AbsoluteFill>
        {/* before: desaturated guesswork */}
        <div style={{ position: "absolute", left: 0, top: 0, width: 960, height: PIC_H, filter: "grayscale(1) brightness(.8)", opacity: inP }}>
          <div style={{ position: "absolute", left: 90, top: 80, fontFamily: display, fontWeight: 900, fontSize: 42, color: C.muted, letterSpacing: 1 }}>BEFORE: GUESS, REFUND, OR LOSE</div>
          <Sticky x={140} y={260} r={-7} text="refund the mugs??" />
          <Sticky x={430} y={300} r={5} text="where is the tracking?" />
          <Sticky x={250} y={540} r={3} text="deadline Fri?" />
          <div style={{ position: "absolute", left: 600, top: 560, width: 260, height: 170, background: "#cfd6df", borderRadius: 8, transform: "rotate(-4deg)" }}>
            <svg width="260" height="170"><path d="M0 0 L130 90 L260 0" stroke="#8e98a6" strokeWidth="6" fill="none" /></svg>
          </div>
          <div style={{ position: "absolute", left: 120, top: 470, fontFamily: display, fontWeight: 900, fontSize: 200, color: "#7d8796", transform: `rotate(${Math.sin(t * 3) * 5}deg)` }}>?</div>
        </div>
        <div style={{ position: "absolute", left: 958, top: 60, width: 4, height: PIC_H - 120, background: C.line }} />
        {/* after: every case has a verdict and a record */}
        <div style={{ position: "absolute", left: 1010, top: 80, fontFamily: display, fontWeight: 900, fontSize: 42, color: C.manila, opacity: prog(t, start + 0.1, 0.3), letterSpacing: 1 }}>AFTER: EVERY CLAIM HAS A RECORD</div>
        {after.map((a, i) => {
          const p = pop(t, start + 0.15 + i * 0.2, 14, 180);
          return (
            <div key={i} style={{ position: "absolute", left: 1040, top: 220 + i * 240, opacity: Math.min(1, p * 1.5), transform: `translateX(${(1 - p) * 40}px)` }}>
              <Card tab={a.tab} w={760}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: 92 }}>
                  <span style={{ fontFamily: display, fontWeight: 800, fontSize: 60 }}>{a.amt}</span>
                  <Stamp word={a.word} color={a.color} t={t} at={start + 0.45 + i * 0.25} size={50} />
                </div>
              </Card>
            </div>
          );
        })}
      </AbsoluteFill>
    </Desk>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ 6. how it works
const NODES = [
  // Matches the code: Live reads of disputes/orders/tracking go through the Agent Toolkit; the capture lookup,
  // webhooks and our seven dispute write tools use our sandbox-forced REST client.
  { k: "PayPal's", title: "PAYPAL APIS", sub: "Agent Toolkit reads disputes · orders · tracking", code: "REST: payments · webhooks · our 7 write tools", color: C.pp },
  { k: "facts", title: "RULES, IN CODE", sub: "evidence strength · buyer-fair · cost to fight", code: "deterministic", color: C.manila },
  { k: "Claude", title: "CLAUDE HAIKU 4.5", sub: "drafts the reply", code: "one strict tool call", color: C.ai },
  { k: "server", title: "SERVER CHECKS", sub: "sources · allowed actions · numbers · policy wording", code: "every claim", color: C.win },
  { k: "decide", title: "YOU APPROVE", sub: "then PayPal's Disputes API", code: "nothing is sent without you", color: C.ink },
];

export const How = ({ start }: { start: number }) => {
  const t = useT(start);
  const W = 310, G = 40, y = 360, H = 360;
  const ats = NODES.map((n) => wordAt("how", n.k) - 0.12);
  // The row stays centred as it grows: its width follows how many cards have (partly) arrived.
  const shown = ats.reduce((n, at) => n + prog(t, at - 0.05, 0.5), 0);
  const x0 = (1920 - (Math.max(1, shown) * W + Math.max(0, shown - 1) * G)) / 2;
  return (
    <Desk>
      <div style={{ position: "absolute", top: 150, width: "100%", textAlign: "center", fontFamily: display, fontWeight: 900, fontSize: 96, color: C.ink, opacity: prog(t, start, 0.4),
        transform: `translateY(${(1 - prog(t, start, 0.5)) * 20}px)` }}>UNDER THE HOOD</div>
      <svg width="1920" height={PIC_H} style={{ position: "absolute", inset: 0 }}>
        {NODES.slice(1).map((_, i) => {
          const a = x0 + (i + 1) * W + i * G, b = a + G, cy = y + H / 2;
          const p = prog(t, ats[i + 1] - 0.15, 0.35);
          const dot = (t * 0.9 + i * 0.3) % 1;
          return (
            <g key={i} opacity={p}>
              <line x1={a + 4} y1={cy} x2={a + 4 + (G - 8) * p} y2={cy} stroke={C.line} strokeWidth={4} />
              <path d={`M${b - 14} ${cy - 9} L${b - 4} ${cy} L${b - 14} ${cy + 9}`} stroke={C.muted} strokeWidth={4} fill="none" />
              {p >= 1 && <circle cx={a + 4 + (G - 8) * dot} cy={cy} r={5} fill={NODES[i].color} />}
            </g>
          );
        })}
      </svg>
      {NODES.map((n, i) => {
        const p = prog(t, ats[i], 0.4);
        return (
          <div key={i} style={{ position: "absolute", left: x0 + i * (W + G), top: y, width: W, height: H, opacity: p, transform: `translateY(${(1 - p) * 30}px)`,
            background: C.surface, border: `2px solid ${C.line}`, borderTop: `6px solid ${n.color}`, borderRadius: 16, padding: "26px 24px", boxSizing: "border-box" }}>
            <div style={{ fontFamily: mono, fontSize: 22, color: C.muted }}>0{i + 1}</div>
            <div style={{ fontFamily: display, fontWeight: 900, fontSize: 38, color: C.ink, marginTop: 8, lineHeight: 1.05 }}>{n.title}</div>
            <div style={{ fontFamily: sans, fontSize: 26, color: C.ink, marginTop: 12, lineHeight: 1.3 }}>{n.sub}</div>
            <div style={{ fontFamily: mono, fontSize: 19, color: n.color, marginTop: 14, lineHeight: 1.35 }}>{n.code}</div>
          </div>
        );
      })}
    </Desk>
  );
};

// ------------------------------------------------------------------ 6b. MCP: the same judgement for any AI assistant
/** A real assess_dispute call to the keyless Replay MCP server (scripts/video/mcp-shot.mts): every value is its output. */
export const Mcp = ({ start, end }: { start: number; end: number }) => {
  const t = useT(start);
  if (!MCP) return <Desk />;
  const r = MCP.result as Record<string, unknown>;
  const reads = MCP.tools.filter((n) => !/(provide|make|send|escalate|acknowledge|accept)_/.test(n));
  const writes = MCP.tools.length - reads.length;
  const show = (k: string) => `  "${k}": ${JSON.stringify(r[k])},`;
  const keys = ["verdict", "seller_cannot_prove_delivery", "buyer_is_right", "recommended_action", "decided_by"];
  const hl = new Set(["verdict", "seller_cannot_prove_delivery", "decided_by"]);
  const rows: { text: string; color: string; at: number; k?: string; small?: boolean }[] = [
    { text: `$ ${MCP.command}`, color: C.ink, at: start + 0.15 },
    { text: `tools: ${reads.join(" · ")} · + ${writes} write tools (return the request, send nothing)`, color: C.muted, at: start + 0.7, small: true },
    { text: `→ ${MCP.tool} ${JSON.stringify(MCP.args).replace(/":"/g, '": "')}`, color: C.pp, at: start + 1.4 },
    { text: "{", color: C.ink, at: start + 2.0 },
    ...keys.map((k, i) => ({ text: show(k), color: C.ink, at: start + 2.2 + i * 0.22, k })),
    { text: "  …", color: C.muted, at: start + 2.2 + keys.length * 0.22 },
    { text: "}", color: C.ink, at: start + 2.3 + keys.length * 0.22 },
  ];
  const lit = prog(t, wordAt("mcp", "same") - 0.1, 0.3);
  const out = prog(t, end - 0.3, 0.3);
  return (
    <Desk>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 34, opacity: 1 - out }}>
        <div style={{ textAlign: "center", opacity: prog(t, start, 0.4) }}>
          <div style={{ fontFamily: display, fontWeight: 900, fontSize: 64, color: C.ink, letterSpacing: 1 }}>ANY AI ASSISTANT, SAME JUDGEMENT</div>
          <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 32, color: C.manila, marginTop: 8 }}>Our MCP server on the Replay data: no keys, nothing sent to PayPal</div>
        </div>
        <div style={{ width: 1640, background: "#0a1020", border: `2px solid ${C.line}`, borderRadius: 16, padding: "26px 36px", boxSizing: "border-box",
          boxShadow: "0 30px 60px -24px rgba(0,0,0,.65)", opacity: prog(t, start + 0.05, 0.35) }}>
          {rows.map((row, i) => {
            const p = prog(t, row.at, 0.25);
            const on = row.k && hl.has(row.k) ? lit : 0;
            return (
              <div key={i} style={{ fontFamily: mono, fontSize: row.k ? 33 : row.small ? 23 : 27, lineHeight: 1.5, color: row.color, whiteSpace: "pre", opacity: p,
                transform: `translateY(${(1 - p) * 6}px)`, background: `rgba(236,213,147,${0.2 * on})`, boxShadow: on ? `inset 4px 0 0 rgba(236,213,147,${on})` : undefined, borderRadius: 6, margin: "0 -10px", padding: "0 10px" }}>
                {row.text}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Desk>
  );
};

// ------------------------------------------------------------------ 7. close
export const Close = ({ start }: { start: number }) => {
  const t = useT(start);
  const hit = HITS.final;
  const flash = interpolate(t, [hit - 0.02, hit + 0.03, hit + 0.4], [0, 0.35, 0], clamp);
  const rows = ([["Try it", CONFIG.demoUrl], ["Code", CONFIG.repoUrl]] as const).filter(([, url]) => Boolean(url));
  const drift = 1 + (0.035 * Math.max(0, t - start)) / 9; // a slow push: never a static hold
  const w1 = ["WIN", "THE", "DISPUTES", "WORTH", "FIGHTING."];
  const w2 = ["SETTLE", "THE", "REST", "FAIRLY."];
  // The whole tagline is on screen (dim) with the logo, so the card is never half empty; words light up as spoken.
  const ghost = 0.22 * prog(t, start + 0.2, 0.5);
  return (
    <Desk lamp={1.4}>
      {/* One block, centred vertically in the picture; the links' space is reserved so nothing shifts. */}
      <AbsoluteFill style={{ transform: `scale(${drift})`, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 44 }}>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 22, opacity: prog(t, start, 0.4) }}>
          <svg width="62" height="70" viewBox="0 0 24 27"><path d="M12 1 L22 5 V12 C22 19 17.5 23.5 12 26 C6.5 23.5 2 19 2 12 V5 Z" fill={C.manila} /><path d="M7.5 13.2 L10.8 16.5 L16.8 9.8" stroke={C.bg} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span style={{ fontFamily: display, fontWeight: 900, fontSize: 64, color: C.ink, letterSpacing: 2 }}>DISPUTE DEFENDER</span>
        </div>
        <div style={{ textAlign: "center", fontFamily: display, fontWeight: 900, fontSize: 76, lineHeight: 1.15, color: C.ink, whiteSpace: "nowrap" }}>
          {w1.map((w, i) => {
            const p = prog(t, wordAt("close", i + 2) - 0.05, 0.2);
            return <span key={i} style={{ display: "inline-block", opacity: ghost + (1 - ghost) * p, transform: `translateY(${(1 - p) * 8}px)`, marginRight: "0.24em" }}>{w}</span>;
          })}
          <br />
          {w2.map((w, i) => {
            const p = prog(t, wordAt("close", i + 7) - 0.05, 0.2);
            return <span key={i} style={{ display: "inline-block", color: C.manila, opacity: ghost + (1 - ghost) * p, transform: `translateY(${(1 - p) * 8}px)`, marginRight: "0.24em" }}>{w}</span>;
          })}
        </div>
        <div style={{ textAlign: "center", fontFamily: sans, fontSize: 38, color: C.ink, lineHeight: 1.6, minHeight: 61 * (rows.length + 1) }}>
          {rows.map(([label, url], i) => (
            <div key={label} style={{ opacity: prog(t, hit + 0.5 + i * 0.25, 0.4) }}>
              <span style={{ color: C.manila, fontWeight: 700, marginRight: 18 }}>{label}</span>
              <span style={{ fontFamily: mono, fontSize: 34 }}>{url}</span>
            </div>
          ))}
          <div style={{ opacity: prog(t, hit + 0.6 + rows.length * 0.25, 0.4), color: C.muted }}>Built by {CONFIG.builtBy}</div>
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: C.manila, opacity: flash }} />
    </Desk>
  );
};
