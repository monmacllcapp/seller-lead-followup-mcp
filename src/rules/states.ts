import type { SourceId } from "./sources.js";

/** Minutes after midnight, seller's local time. */
type Window = { start: number; end: number };

export type StateRule = {
  /** Allowed send windows by day of week, 0 = Sunday. null = no sales contact that day. */
  windows: Record<number, Window | null>;
  /** Max sales calls/texts to one person in 24 hours, if the state sets one. */
  dailyCap?: number;
  /** State requires seller registration before telemarketing. */
  registration?: string;
  note?: string;
  source: SourceId;
};

const h = (hour: number) => hour * 60;
const everyDay = (w: Window | null): Record<number, Window | null> => ({ 0: w, 1: w, 2: w, 3: w, 4: w, 5: w, 6: w });
const noSunday = (w: Window): Record<number, Window | null> => ({ ...everyDay(w), 0: null });

export const FEDERAL: StateRule = { windows: everyDay({ start: h(8), end: h(21) }), source: "fcc_calling_hours" };

/** Stricter state rules, per the JustCall summary updated 2026-09-30. States not listed fall back to FEDERAL. */
export const STATES: Record<string, StateRule> = {
  FL: { windows: everyDay({ start: h(8), end: h(20) }), dailyCap: 3, note: "Texts covered. State do-not-call list.", source: "state_mini_tcpa" },
  OK: { windows: everyDay({ start: h(8), end: h(20) }), dailyCap: 3, source: "state_mini_tcpa" },
  MD: { windows: everyDay({ start: h(8), end: h(20) }), dailyCap: 3, note: "Prior express written consent required.", source: "state_mini_tcpa" },
  WA: {
    windows: everyDay({ start: h(8), end: h(20) }),
    registration: "Register with the Washington Department of Licensing.",
    note: "Texts require prior affirmative consent.",
    source: "state_mini_tcpa",
  },
  CT: { windows: everyDay({ start: h(9), end: h(20) }), note: "Texts covered.", source: "state_mini_tcpa" },
  TX: {
    windows: { ...everyDay({ start: h(9), end: h(21) }), 0: { start: h(12), end: h(21) } },
    registration: "Register with the Texas Secretary of State.",
    note: "Texts covered since 2025-09-01.",
    source: "state_mini_tcpa",
  },
  VA: { windows: everyDay({ start: h(8), end: h(21) }), note: "Texts covered since 2026-01-01.", source: "state_mini_tcpa" },
  AL: { windows: noSunday({ start: h(8), end: h(20) }), source: "state_mini_tcpa" },
  LA: { windows: noSunday({ start: h(8), end: h(20) }), source: "state_mini_tcpa" },
  MS: { windows: noSunday({ start: h(8), end: h(21) }), source: "state_mini_tcpa" },
  UT: { windows: noSunday({ start: h(8), end: h(21) }), note: "No sales contact on legal holidays either.", source: "state_mini_tcpa" },
  RI: {
    windows: { 0: null, 1: { start: h(9), end: h(18) }, 2: { start: h(9), end: h(18) }, 3: { start: h(9), end: h(18) }, 4: { start: h(9), end: h(18) }, 5: { start: h(9), end: h(18) }, 6: { start: h(10), end: h(17) } },
    note: "Source lists no Sunday window, so Sunday is treated as not allowed.",
    source: "state_mini_tcpa",
  },
};

export function ruleFor(state?: string): { code: string; rule: StateRule; stateSpecific: boolean } {
  const code = (state ?? "").trim().toUpperCase();
  const rule = STATES[code];
  return rule ? { code, rule, stateSpecific: true } : { code: code || "unknown", rule: FEDERAL, stateSpecific: false };
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fmt = (m: number) => {
  const hr = Math.floor(m / 60);
  const suffix = hr >= 12 ? "p.m." : "a.m.";
  return `${((hr + 11) % 12) + 1}${m % 60 ? ":" + String(m % 60).padStart(2, "0") : ""} ${suffix}`;
};

/** The strictest of federal and state windows for that day. */
export function windowFor(state: string | undefined, day: number): Window | null {
  const { rule } = ruleFor(state);
  const s = rule.windows[day];
  const f = FEDERAL.windows[day];
  if (!s || !f) return null;
  return { start: Math.max(s.start, f.start), end: Math.min(s.end, f.end) };
}

export function describeHours(state?: string): string {
  const parts: string[] = [];
  for (let d = 0; d < 7; d++) {
    const w = windowFor(state, d);
    parts.push(`${DAYS[d]}: ${w ? `${fmt(w.start)} to ${fmt(w.end)}` : "no sales contact"}`);
  }
  // Collapse identical days for readability.
  const uniq = new Set(parts.map((p) => p.split(": ")[1]));
  return uniq.size === 1 ? `Every day: ${[...uniq][0]} (seller's local time)` : parts.join("; ") + " (seller's local time)";
}

export { DAYS, fmt };
