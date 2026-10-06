import { DISCLAIMER, RULES_AS_OF, SOURCES, type SourceId } from "./sources.js";
import { DAYS, fmt, ruleFor, windowFor } from "./states.js";

export const CONSENT = ["written", "inbound_or_verbal", "none", "unknown"] as const;
export type Consent = (typeof CONSENT)[number];

export type TextCheckInput = {
  message: string;
  seller_state?: string;
  /** Seller's local time, 24-hour "HH:MM". */
  send_time_local?: string;
  /** 0 = Sunday ... 6 = Saturday, seller's local day. */
  day_of_week?: number;
  is_first_message?: boolean;
  consent?: Consent;
  /** Calls plus texts already sent to this person in the last 24 hours. */
  touches_last_24h?: number;
  /** The seller's most recent reply, if any. */
  last_seller_reply?: string;
};

type Severity = "block" | "fix" | "info";
export type Issue = { severity: Severity; rule: string; detail: string; source?: SourceId };

export type TextCheck = {
  verdict: "ok_to_send" | "fix_before_sending" | "do_not_send";
  issues: Issue[];
  characters: number;
  sms_segments: number;
  encoding: "GSM-7" | "UCS-2";
  sources: { id: SourceId; title: string; url: string }[];
  rules_as_of: string;
  disclaimer: string;
};

const OPT_OUT_WORDS = ["stop", "quit", "end", "revoke", "opt out", "optout", "cancel", "unsubscribe"];
const OPT_OUT_PHRASES = /\b(do not|don'?t|never) (text|call|contact|message)\b|\b(remove|take) me off\b|\blose my number\b|\bleave me alone\b/i;
const OPT_OUT_INSTRUCTIONS = /\b(reply|text|send|respond( with)?)\s+["']?stop\b|\bstop to (opt|end|unsub|quit|cancel)/i;
const SENDER_ID = /\b(this is|my name is|it'?s)\s+[A-Z][a-z]+|\bwith [A-Z][\w&]+/;
const LINK = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|net|io|co|ly|me|us|biz|info)\b/i;
const PRESSURE: [RegExp, string][] = [
  [/\b(final notice|last chance|act now|urgent|expires? (today|tonight)|before it'?s too late)\b/i, "pressure or fake urgency"],
  [/\b(foreclos\w*|auction|lien|tax (debt|sale)|behind on (payments|taxes)|probate|divorce|eviction)\b/i, "hardship the seller may not have raised"],
  [/\b(guarantee[ds]?|risk[- ]free|no obligation whatsoever|100%)\b/i, "promises you may not be able to keep"],
  [/\b(irs|court|sheriff|county (office|department)|government)\b/i, "language that can read as official or threatening"],
];

// GSM 03.38 basic + extension characters.
const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€";

export function smsSegments(text: string): { encoding: "GSM-7" | "UCS-2"; segments: number; characters: number } {
  const chars = [...text];
  const gsm = chars.every((c) => GSM.includes(c) || GSM_EXT.includes(c));
  if (gsm) {
    const units = chars.reduce((n, c) => n + (GSM_EXT.includes(c) ? 2 : 1), 0);
    return { encoding: "GSM-7", characters: chars.length, segments: units <= 160 ? 1 : Math.ceil(units / 153) };
  }
  const units = chars.reduce((n, c) => n + (c.codePointAt(0)! > 0xffff ? 2 : 1), 0);
  return { encoding: "UCS-2", characters: chars.length, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}

export function isOptOut(reply: string): boolean {
  const r = reply.trim().toLowerCase().replace(/[.!]+$/, "");
  if (OPT_OUT_WORDS.includes(r)) return true;
  // "end", "quit" and "cancel" also start ordinary sentences ("end of the month works"), so only the
  // unambiguous words count when followed by more text.
  if (/^(stop|unsubscribe|opt ?out|revoke)\b/.test(r)) return true;
  return OPT_OUT_PHRASES.test(reply);
}

function parseTime(t?: string): number | undefined {
  const m = t?.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh < 24 && mm < 60 ? hh * 60 + mm : undefined;
}

export function checkText(input: TextCheckInput): TextCheck {
  const issues: Issue[] = [];
  const used = new Set<SourceId>();
  const add = (i: Issue) => {
    issues.push(i);
    if (i.source) used.add(i.source);
  };
  const st = ruleFor(input.seller_state);

  if (input.last_seller_reply && isOptOut(input.last_seller_reply))
    add({
      severity: "block",
      rule: "Seller opted out",
      detail: `Their last reply ("${input.last_seller_reply.slice(0, 80)}") revokes consent. Do not send anything else; suppress the number.`,
      source: "fcc_revocation",
    });

  const minutes = parseTime(input.send_time_local);
  if (input.send_time_local !== undefined && minutes === undefined)
    add({ severity: "fix", rule: "Send time unreadable", detail: 'Give the seller\'s local time as 24-hour "HH:MM", e.g. "14:30".' });
  if (minutes !== undefined) {
    const day = input.day_of_week ?? 1;
    const w = windowFor(input.seller_state, day);
    const src: SourceId = st.stateSpecific ? "state_mini_tcpa" : "fcc_calling_hours";
    if (input.day_of_week === undefined)
      add({ severity: "info", rule: "Day not given", detail: "Checked as a weekday. Some states ban or shorten Sunday contact; pass day_of_week to check." });
    if (!w) add({ severity: "block", rule: "No sales contact this day", detail: `${st.code} does not allow sales contact on ${DAYS[day]}.`, source: src });
    else if (minutes < w.start || minutes >= w.end)
      add({
        severity: "block",
        rule: "Outside allowed hours",
        detail: `${st.stateSpecific ? st.code : "Federal rules"} allow ${fmt(w.start)} to ${fmt(w.end)} in the seller's time zone on ${DAYS[day]}. Planned: ${input.send_time_local}.`,
        source: src,
      });
  } else if (input.send_time_local === undefined) {
    add({ severity: "info", rule: "Send time not checked", detail: "Pass send_time_local (seller's time zone) to check allowed hours.", source: "fcc_calling_hours" });
  }

  if (st.rule.dailyCap !== undefined && (input.touches_last_24h ?? 0) >= st.rule.dailyCap)
    add({
      severity: "block",
      rule: "Daily contact cap reached",
      detail: `${st.code} allows ${st.rule.dailyCap} sales calls or texts per person in 24 hours; ${input.touches_last_24h} already sent.`,
      source: "state_mini_tcpa",
    });

  const consent = input.consent ?? "unknown";
  if (consent === "none")
    add({
      severity: "fix",
      rule: "No consent",
      detail:
        "This person has not agreed to texts. Automated or bulk texts to them carry TCPA risk; send by hand, one at a time, or get legal review first.",
    });
  else if (consent === "unknown")
    add({ severity: "info", rule: "Consent unknown", detail: "Record how this person agreed to be contacted before texting them at scale." });
  if (st.code === "MD" && consent !== "written")
    add({ severity: "fix", rule: "Maryland written consent", detail: "Maryland requires prior express written consent for these messages.", source: "state_mini_tcpa" });
  if (st.code === "WA" && consent !== "written" && consent !== "inbound_or_verbal")
    add({ severity: "fix", rule: "Washington consent", detail: "Washington requires prior affirmative consent for sales texts.", source: "state_mini_tcpa" });
  if (st.rule.registration) add({ severity: "info", rule: "State registration", detail: st.rule.registration, source: "state_mini_tcpa" });

  const msg = input.message;
  if (input.is_first_message) {
    if (!OPT_OUT_INSTRUCTIONS.test(msg))
      add({ severity: "fix", rule: "No opt-out line", detail: 'Add a way to opt out to the first message, e.g. "Reply STOP to opt out."', source: "fcc_revocation" });
    if (!SENDER_ID.test(msg)) add({ severity: "fix", rule: "Sender not named", detail: 'Say who you are, e.g. "This is Sam with Example Home Buyers."' });
    if (LINK.test(msg)) add({ severity: "fix", rule: "Link in first text", detail: "Links in a first message from an unknown sender are often filtered as spam. Send the link after they reply." });
  }
  for (const [rx, label] of PRESSURE) {
    const hit = msg.match(rx);
    if (hit) add({ severity: "fix", rule: "Risky wording", detail: `"${hit[0]}" reads as ${label}.` });
  }
  if ((msg.match(/\?/g) ?? []).length > 1) add({ severity: "info", rule: "More than one question", detail: "One question per text gets more replies and keeps it easy to answer." });

  const seg = smsSegments(msg);
  if (seg.segments > 1)
    add({
      severity: "info",
      rule: "Long message",
      detail: `${seg.characters} characters in ${seg.encoding} = ${seg.segments} SMS segments, each billed separately.${seg.encoding === "UCS-2" ? " An emoji or curly quote switched it to UCS-2 (70 characters per segment)." : ""}`,
    });

  const verdict = issues.some((i) => i.severity === "block") ? "do_not_send" : issues.some((i) => i.severity === "fix") ? "fix_before_sending" : "ok_to_send";
  return {
    verdict,
    issues,
    characters: seg.characters,
    sms_segments: seg.segments,
    encoding: seg.encoding,
    sources: [...used].map((id) => ({ id, ...SOURCES[id] })),
    rules_as_of: RULES_AS_OF,
    disclaimer: DISCLAIMER,
  };
}
