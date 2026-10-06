import { describe, expect, it } from "vitest";
import { inboundSequence, planFollowUp } from "../src/rules/followup.js";
import { checkText, isOptOut, smsSegments } from "../src/rules/texting.js";
import { describeHours, windowFor } from "../src/rules/states.js";

const GOOD_FIRST =
  "Hi Pat, this is Sam with Example Home Buyers. Saw your request about 12 Elm St. Is now a good time to talk? Reply STOP to opt out.";

describe("state hours", () => {
  it("uses federal 8 a.m. to 9 p.m. for states without stricter rules", () => {
    expect(windowFor("CA", 2)).toEqual({ start: 480, end: 1260 });
    expect(describeHours("CA")).toContain("8 a.m. to 9 p.m.");
  });
  it("uses the stricter state window", () => {
    expect(windowFor("FL", 2)).toEqual({ start: 480, end: 1200 });
    expect(windowFor("CT", 2)?.start).toBe(540);
  });
  it("applies Sunday rules", () => {
    expect(windowFor("AL", 0)).toBeNull();
    expect(windowFor("TX", 0)).toEqual({ start: 720, end: 1260 });
    expect(windowFor("RI", 0)).toBeNull();
  });
  it("is case-insensitive and falls back on unknown input", () => {
    expect(windowFor("fl", 1)?.end).toBe(1200);
    expect(windowFor(undefined, 1)?.end).toBe(1260);
  });
});

describe("opt-out detection", () => {
  it.each(["STOP", "stop.", "Unsubscribe", "opt out", "Stop texting me", "please don't text me again", "remove me off your list", "cancel", "END"])(
    "treats %j as an opt-out",
    (r) => expect(isOptOut(r)).toBe(true),
  );
  it.each(["end of the month works for me", "Can you call me after 5?", "I might cancel my listing with my agent, not sure", "yes"])(
    "does not treat %j as an opt-out",
    (r) => expect(isOptOut(r)).toBe(false),
  );
});

describe("SMS segments", () => {
  it("counts GSM-7 and UCS-2", () => {
    expect(smsSegments("a".repeat(160))).toMatchObject({ encoding: "GSM-7", segments: 1 });
    expect(smsSegments("a".repeat(161)).segments).toBe(2);
    expect(smsSegments("Hi 👋").encoding).toBe("UCS-2");
    expect(smsSegments("’".repeat(71)).segments).toBe(2);
  });
});

describe("checkText", () => {
  it("passes a clean first text inside hours", () => {
    const r = checkText({ message: GOOD_FIRST, seller_state: "CA", send_time_local: "10:00", day_of_week: 2, is_first_message: true, consent: "inbound_or_verbal" });
    expect(r.verdict).toBe("ok_to_send");
  });
  it("blocks after an opt-out reply", () => {
    const r = checkText({ message: "Just checking in!", last_seller_reply: "STOP" });
    expect(r.verdict).toBe("do_not_send");
    expect(r.issues[0].source).toBe("fcc_revocation");
  });
  it("blocks 8:30 p.m. in Florida but allows it in California", () => {
    const base = { message: GOOD_FIRST, send_time_local: "20:30", day_of_week: 3, is_first_message: true, consent: "written" as const };
    expect(checkText({ ...base, seller_state: "FL" }).verdict).toBe("do_not_send");
    expect(checkText({ ...base, seller_state: "CA" }).verdict).toBe("ok_to_send");
  });
  it("blocks before 8 a.m. everywhere", () => {
    expect(checkText({ message: "hi", seller_state: "NV", send_time_local: "07:59", day_of_week: 1 }).verdict).toBe("do_not_send");
  });
  it("blocks Sunday in Alabama", () => {
    expect(checkText({ message: GOOD_FIRST, seller_state: "AL", send_time_local: "12:00", day_of_week: 0 }).verdict).toBe("do_not_send");
  });
  it("blocks the 4th touch in 24 hours in capped states", () => {
    const r = checkText({ message: "hi", seller_state: "OK", touches_last_24h: 3, send_time_local: "12:00", day_of_week: 2 });
    expect(r.issues.map((i) => i.rule)).toContain("Daily contact cap reached");
    expect(r.verdict).toBe("do_not_send");
  });
  it("asks for an opt-out line, sender name and no link on a first text", () => {
    const r = checkText({ message: "Want to sell your house? www.example.com", is_first_message: true, seller_state: "CA", send_time_local: "12:00", day_of_week: 2 });
    const rules = r.issues.map((i) => i.rule);
    expect(rules).toEqual(expect.arrayContaining(["No opt-out line", "Sender not named", "Link in first text"]));
    expect(r.verdict).toBe("fix_before_sending");
  });
  it("flags hardship and pressure wording", () => {
    const r = checkText({ message: "Final notice: avoid foreclosure, act now", seller_state: "CA", send_time_local: "12:00", day_of_week: 2 });
    expect(r.issues.filter((i) => i.rule === "Risky wording").length).toBeGreaterThanOrEqual(2);
  });
  it("flags missing consent and Maryland written consent", () => {
    const r = checkText({ message: GOOD_FIRST, seller_state: "MD", consent: "none", send_time_local: "12:00", day_of_week: 2, is_first_message: true });
    expect(r.issues.map((i) => i.rule)).toEqual(expect.arrayContaining(["No consent", "Maryland written consent"]));
  });
  it("rejects an unreadable time instead of ignoring it", () => {
    expect(checkText({ message: "hi", send_time_local: "7pm" }).issues.map((i) => i.rule)).toContain("Send time unreadable");
  });
});

describe("inbound sequence", () => {
  const calls = (s: ReturnType<typeof inboundSequence>) => s.filter((t) => t.channel !== "text");
  it("has six calls with voicemails on calls 2 and 6", () => {
    const s = calls(inboundSequence());
    expect(s).toHaveLength(6);
    expect(s[1].channel).toBe("voicemail");
    expect(s[5].channel).toBe("voicemail");
  });
  it("keeps six calls but never more than 3 touches a day in capped states", () => {
    const s = inboundSequence(3);
    expect(calls(s)).toHaveLength(6);
    const perDay = new Map<number, number>();
    for (const t of s) perDay.set(t.day, (perDay.get(t.day) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(3);
  });
});

describe("planFollowUp", () => {
  it("says call now for a brand-new inbound lead and cites lead-response research", () => {
    const p = planFollowUp({ source: "ppc", status: "new", minutes_since_lead_arrived: 0, seller_state: "TX" });
    expect(p.lead_type).toBe("inbound");
    expect(p.next_action.action).toBe("Call now.");
    expect(p.next_action.when).toBe("Within the first minute");
    expect(p.sources.map((s) => s.id)).toEqual(expect.arrayContaining(["lead_response_mgmt", "velocify", "state_mini_tcpa"]));
    expect(p.compliance.join(" ")).toContain("Texas Secretary of State");
  });
  it("walks the inbound sequence by touches done", () => {
    const p = planFollowUp({ source: "web_form", status: "no_contact_yet", call_attempts: 1, texts_sent: 1, days_since_first_touch: 0 });
    expect(p.next_action.action).toContain("Call 2");
    expect(p.next_action.action).toContain("voicemail");
  });
  it("uses the 7-day cold protocol with one call a day and a consent warning", () => {
    const p = planFollowUp({ source: "cold_list", status: "new" });
    expect(p.lead_type).toBe("cold_outbound");
    const callsPerDay = p.schedule.map((d) => d.touches.filter((t) => t.startsWith("call")).length);
    expect(Math.max(...callsPerDay)).toBe(1);
    expect(p.schedule.reduce((n, d) => n + d.touches.filter((t) => t.startsWith("call")).length, 0)).toBe(4);
    expect(p.compliance.join(" ")).toContain("has not given you consent");
  });
  it("waits when the next cold touch is on a later day", () => {
    const p = planFollowUp({ source: "cold_list", status: "no_contact_yet", call_attempts: 2, texts_sent: 4, days_since_first_touch: 4 });
    expect(p.next_action.when).toBe("In 1 day (day 5)");
  });
  it("moves to the drip when the sequence is finished", () => {
    const p = planFollowUp({ source: "cold_list", status: "no_contact_yet", call_attempts: 4, texts_sent: 5, days_since_first_touch: 8 });
    expect(p.next_action.action).toContain("long-term drip");
  });
  it("stops for opted-out and wrong-number leads", () => {
    for (const status of ["opted_out", "wrong_number"] as const) {
      const p = planFollowUp({ source: "ppl", status });
      expect(p.next_action.action).toContain("Stop");
      expect(p.schedule).toHaveLength(0);
    }
  });
  it("schedules a future-timeline lead about two weeks early", () => {
    const p = planFollowUp({ source: "direct_mail_response", status: "future_timeline", seller_timeline_days: 90 });
    expect(p.next_action.when).toBe("Day 76");
  });
  it("respects a hot lead's requested callback time", () => {
    const p = planFollowUp({ source: "text_reply", status: "hot", callback_requested: true });
    expect(p.next_action.action).toContain("time the seller asked for");
  });
  it("flags a reached daily cap", () => {
    const p = planFollowUp({ source: "ppl", status: "no_contact_yet", seller_state: "FL", touches_last_24h: 3, call_attempts: 2, texts_sent: 1 });
    expect(p.compliance.join(" ")).toContain("Daily cap reached");
  });
  it("always includes stop rules, a disclaimer and sources", () => {
    const p = planFollowUp({ source: "referral", status: "warm" });
    expect(p.stop_rules.length).toBeGreaterThan(0);
    expect(p.disclaimer).toMatch(/not legal advice/);
    expect(p.sources.every((s) => s.url.startsWith("https://"))).toBe(true);
  });
});
