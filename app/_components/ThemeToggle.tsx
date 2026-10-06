"use client";

import { useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";
const ORDER: Theme[] = ["system", "light", "dark"];
const LABEL: Record<Theme, string> = { system: "Auto", light: "Light", dark: "Dark" };

function read(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
}

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function apply(t: Theme) {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    if (t === "system") localStorage.removeItem("dd-theme");
    else localStorage.setItem("dd-theme", t);
  } catch {
    /* storage blocked: theme still applies for this page */
  }
  listeners.forEach((fn) => fn());
}

/** Cycles Auto → Light → Dark. 44px tap target. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <button
      type="button"
      onClick={() => apply(next)}
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-medium text-ink-2 hover:border-line-strong"
      aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[next]}`}
      title={`Theme: ${LABEL[theme]}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" />
      </svg>
      <span className="hidden sm:inline">{LABEL[theme]}</span>
    </button>
  );
}

/** Inline, pre-paint script: apply the saved theme before first render (no flash). */
export const themeBootScript = `try{var t=localStorage.getItem("dd-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
