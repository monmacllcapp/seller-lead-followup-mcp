import { DISCLAIMER, RULES_AS_OF, SOURCES, type SourceId } from "./sources.js";
import { describeHours, ruleFor } from "./states.js";

export const LEAD_SOURCES = [
  "web_form",
  "ppc",
  "ppl",
  "missed_inbound_call",
  "text_reply",
  "direct_mail_response",
  "referral",
  "cold_list",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const STATUSES = [
  "new",
  "no_contact_yet",
  "hot",
  "warm",
  "future_timeline",
  "offer_sent",
  "not_interested_soft",
  "not_interested_hard",
  "opted_out",
  "wrong_number",
] as const;
export type Status = (typeof STATUSES)[number];

export type PlanInput = {
  source: LeadSource;
  status: Status;
  /** Minutes since the lead came in (inbound leads). */
  minutes_since_lead_arrived?: number;
  /** Days since your first touch on this lead, 0 = today. */
  days_since_first_touch?: number;
  call_attempts?: number;
  texts_sent?: number;
  /** Calls plus texts already sent to this person in the last 24 hours. */
  touches_last_24h?: number;
  seller_state?: string;
  /** For future_timeline: days until the seller said they would be ready. */
  seller_timeline_days?: number;
  /** The seller asked to be called back at a specific time. */
  callback_requested?: boolean;
};

type Channel = "call" | "text" | "voicemail";
type Touch = { day: number; channel: Channel; note: string };

export type Plan = {
  lead_type: "inbound" | "cold_outbound";
  next_action: { action: string; when: string; why: string; sources: SourceId[] };
  schedule: { day: number; touches: string[] }[];
  after_schedule: string;
  stop_rules: string[];
  message_briefs: { for: string; goal: string; include: string[]; avoid: string[] }[];
  compliance: string[];
  sources: { id: SourceId; title: string; url: string }[];
  rules_as_of: string;
  disclaimer: string;
};

const INBOUND: ReadonlySet<LeadSource> = new Set(["web_form", "ppc", "ppl", "missed_inbound_call", "text_reply", "direct_mail_response", "referral"]);

const STOP_RULES = [
  'Stop at once and suppress the number if the seller replies with "stop", "quit", "end", "revoke", "opt out", "cancel" or "unsubscribe", or asks in any other clear way not to be contacted.',
  "Stop at once on a confirmed wrong number, an angry or legal-threat reply, or a do-not-call match.",
  "Stop the active sequence the moment the seller engages; switch to the hot or warm plan.",
  "Never call the same person twice in a row or switch caller IDs to get through.",
];

/** Velocify + Lead Response Management: call in the first minute, voicemail on calls 2 and 6, six calls total. */
export function inboundSequence(dailyCap?: number): Touch[] {
  // In states that cap contact at 3 per 24 hours, day 0 is call + text + call; the dropped call moves to day 3.
  const capped = dailyCap !== undefined && dailyCap <= 3;
  const plan: { day: number; channel: Channel; note: string }[] = [
    { day: 0, channel: "call", note: "within the first minute of the lead arriving." },
    { day: 0, channel: "text", note: "If no answer, text within 2 minutes: who you are, why you are reaching out, one question." },
    { day: 0, channel: "voicemail", note: "about an hour later; leave the first voicemail." },
    ...(capped ? [] : [{ day: 0, channel: "call" as Channel, note: "between 4 and 6 p.m., the best contact window." }]),
    { day: 1, channel: "call", note: "at a different time of day than yesterday." },
    { day: 1, channel: "text", note: "Text a short note referencing their request." },
    { day: 2, channel: "call", note: "at a different time of day again." },
    ...(capped ? [{ day: 3, channel: "call" as Channel, note: "between 4 and 6 p.m." }] : []),
    { day: 4, channel: "voicemail", note: "the last call of the sequence; leave the second voicemail." },
  ];
  let n = 0;
  return plan.map((t) => (t.channel === "text" ? t : { ...t, note: `Call ${++n} ${t.note}` }));
}

/** MonmacLabs 7-day cold protocol: max 1 call a day, 4 calls total. */
const COLD_SEQUENCE: Touch[] = [
  { day: 1, channel: "call", note: "Call 1 of 4." },
  { day: 1, channel: "text", note: "If no answer, text 1 to 5 minutes later from the same number." },
  { day: 2, channel: "text", note: "Text only; no call today." },
  { day: 3, channel: "call", note: "Call 2 of 4." },
  { day: 3, channel: "text", note: "If no answer, text 1 to 5 minutes later from the same number." },
  { day: 4, channel: "text", note: "Text only; no call today." },
  { day: 5, channel: "call", note: "Call 3 of 4. No text today." },
  { day: 7, channel: "call", note: "Final call, 4 of 4." },
  { day: 7, channel: "text", note: "Final text, then move to the long-term drip." },
];

function group(touches: Touch[]) {
  const byDay = new Map<number, string[]>();
  for (const t of touches) byDay.set(t.day, [...(byDay.get(t.day) ?? []), `${t.channel}: ${t.note}`]);
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, touches]) => ({ day, touches }));
}

const AVOID = [
  "Fake urgency or deadlines that are not real",
  "Pretending to be a neighbor, a friend or anyone you are not",
  "Mentioning foreclosure, liens, divorce, death or other hardship unless the seller brought it up",
  "More than one question per message",
  "Links in a first text",
];

function brief(forWhat: string, goal: string, include: string[]) {
  return { for: forWhat, goal, include, avoid: AVOID };
}

export function planFollowUp(input: PlanInput): Plan {
  const lead_type = INBOUND.has(input.source) ? "inbound" : "cold_outbound";
  const st = ruleFor(input.seller_state);
  const dailyCap = st.rule.dailyCap;
  const calls = input.call_attempts ?? 0;
  const texts = input.texts_sent ?? 0;
  const day = input.days_since_first_touch ?? 0;
  const used: Set<SourceId> = new Set(["fcc_calling_hours", "fcc_revocation"]);

  const compliance = [`Contact hours for ${st.code}: ${describeHours(input.seller_state)}.`];
  if (dailyCap) compliance.push(`${st.code} caps sales calls and texts at ${dailyCap} per person in 24 hours.`);
  if (st.rule.registration) compliance.push(st.rule.registration);
  if (st.rule.note) compliance.push(st.rule.note);
  if (st.stateSpecific) used.add("state_mini_tcpa");
  compliance.push("Check the National Do Not Call Registry and your own do-not-contact list before any cold call or text.");
  if (lead_type === "cold_outbound")
    compliance.push(
      "This seller has not given you consent. Automated or bulk texting to people who have not consented carries TCPA risk; send texts one at a time by hand or get legal review first.",
    );
  else compliance.push("Keep a record of how this lead gave consent to be contacted (form wording, call recording, or their text).");
  if (dailyCap && (input.touches_last_24h ?? 0) >= dailyCap)
    compliance.push(`Daily cap reached: ${input.touches_last_24h} touches in the last 24 hours. Wait until 24 hours after the first of them.`);

  let next_action: Plan["next_action"];
  let touches: Touch[] = [];
  let after_schedule = "";
  const briefs: Plan["message_briefs"] = [];

  switch (input.status) {
    case "opted_out":
    case "wrong_number":
      return finish({
        next_action: {
          action: "Stop. Do not contact again.",
          when: "Now",
          why:
            input.status === "opted_out"
              ? "The seller revoked consent. Federal rules require honoring it within 10 business days; best practice is immediately."
              : "Confirmed wrong number.",
          sources: ["fcc_revocation"],
        },
        after_schedule: "None. Add the number to your do-not-contact list.",
      });

    case "hot":
      used.add("lead_response_mgmt");
      next_action = {
        action: input.callback_requested ? "Call at the time the seller asked for." : "Call now.",
        when: input.callback_requested ? "At the promised time, not early or late" : "Within 5 minutes",
        why: "Calling within 5 minutes instead of 30 raised contact odds 100x and qualification odds 21x.",
        sources: ["lead_response_mgmt", "monmaclabs_protocol"],
      };
      touches = [
        { day: 0, channel: "call", note: "Call within 5 minutes." },
        { day: 0, channel: "text", note: "If missed, text within 2 minutes saying you will call again and asking for a good time." },
        { day: 0, channel: "call", note: "Second call the same day only if the seller asked for contact." },
        { day: 1, channel: "call", note: "Daily follow-up until the appointment or offer is done." },
      ];
      after_schedule = "Daily until an appointment is booked or an offer is presented, then use the offer_sent plan.";
      briefs.push(brief("missed-call text", "Get a callback time.", ["Your name and company", "That you just tried to call", "One question: when is a good time"]));
      break;

    case "warm":
      next_action = {
        action: "Send a recap text today, then call within 2 to 3 business days.",
        when: "Today",
        why: "Seller is open to an offer but not urgent. Keep the thread warm without pressure.",
        sources: ["monmaclabs_protocol"],
      };
      touches = [
        { day: 0, channel: "text", note: "Recap text: what you heard and the next step." },
        { day: 2, channel: "call", note: "Call; send an offer or price range if you have enough information." },
        { day: 9, channel: "call", note: "Weekly follow-up." },
        { day: 16, channel: "text", note: "Weekly follow-up." },
        { day: 23, channel: "call", note: "Weekly follow-up." },
        { day: 30, channel: "text", note: "Weekly follow-up." },
      ];
      after_schedule = "Every 2 weeks to monthly until they are ready or say no.";
      briefs.push(brief("recap text", "Confirm you listened and set the next step.", ["Their property and the one thing they care about most", "What happens next and when"]));
      break;

    case "future_timeline": {
      const t = Math.max(input.seller_timeline_days ?? 90, 8);
      const first = Math.max(t - 14, 7);
      next_action = {
        action: `Schedule a follow-up for day ${first}, about two weeks before their timeline.`,
        when: `Day ${first}`,
        why: "The seller gave a timeline. Reaching out 7 to 14 days before it lands you ahead of the decision without pestering.",
        sources: ["monmaclabs_protocol"],
      };
      touches = [
        { day: 0, channel: "text", note: "Thank-you text confirming you will check back closer to their date." },
        { day: first, channel: "call", note: "Check-in call before their timeline." },
        { day: t, channel: "text", note: "Check-in on their stated date if no response." },
      ];
      after_schedule = "Monthly drip if no response.";
      briefs.push(brief("check-in call", "Learn whether the timeline still holds.", ["Their stated timeline", "What has changed since you spoke"]));
      break;
    }

    case "offer_sent":
      next_action = {
        action: "Call tomorrow to walk through the offer.",
        when: "Within 24 hours of sending",
        why: "Questions about an offer go cold fast; answer them before another buyer does.",
        sources: ["monmaclabs_protocol"],
      };
      touches = [
        { day: 1, channel: "call", note: "Walk through the offer and answer questions." },
        { day: 7, channel: "call", note: "Weekly follow-up." },
        { day: 14, channel: "text", note: "Weekly follow-up." },
        { day: 21, channel: "call", note: "Weekly follow-up." },
        { day: 28, channel: "text", note: "Weekly follow-up." },
      ];
      after_schedule = "Monthly nurture; the offer stays open unless you say otherwise.";
      briefs.push(brief("offer follow-up", "Find the one thing standing between them and yes.", ["The offer number", "What it covers (closing costs, as-is, timing)", "One question about what would make it work"]));
      break;

    case "not_interested_soft":
      next_action = {
        action: "Stop the active sequence; move to a monthly check-in.",
        when: "Next touch in 30 days",
        why: "A soft no often changes when the seller's situation changes. A long, light cadence keeps you in mind without pressure.",
        sources: ["monmaclabs_protocol"],
      };
      touches = [
        { day: 30, channel: "text", note: "Monthly check-in." },
        { day: 60, channel: "text", note: "Monthly check-in." },
        { day: 90, channel: "call", note: "Monthly check-in." },
      ];
      after_schedule = "Quarterly after the third month.";
      briefs.push(brief("monthly check-in", "Be the person they think of when things change.", ["No offer, no pressure", "A useful local fact or a simple question"]));
      break;

    case "not_interested_hard":
      next_action = {
        action: "No outreach for 90 days.",
        when: "Day 90 at the earliest",
        why: "A firm no means more contact now does harm. One quarterly check-in at most, by text, and never if they asked you to stop.",
        sources: ["monmaclabs_protocol"],
      };
      touches = [{ day: 90, channel: "text", note: "One quarterly check-in, only if they never asked you to stop." }];
      after_schedule = "Quarterly at most.";
      break;

    case "new":
    case "no_contact_yet":
    default: {
      const seq = lead_type === "inbound" ? inboundSequence(dailyCap) : COLD_SEQUENCE;
      if (lead_type === "inbound") used.add("velocify").add("lead_response_mgmt").add("hbr_short_life");
      touches = seq;
      const done = calls + texts;
      const nextTouch = seq[done];
      after_schedule =
        "No contact after the sequence: move to the long-term drip, monthly for 3 months, then quarterly. Re-enter the active plan the moment they reply.";
      if (!nextTouch) {
        next_action = {
          action: "Sequence finished. Move to the long-term drip.",
          when: "Next touch in 30 days",
          why: "93% of leads that convert are reached by the 6th call; more calls now add little and risk spam labels.",
          sources: ["velocify", "monmaclabs_protocol"],
        };
      } else if (lead_type === "inbound" && done === 0) {
        const mins = input.minutes_since_lead_arrived ?? 0;
        next_action = {
          action: "Call now.",
          when: mins <= 1 ? "Within the first minute" : `Now. It has been ${mins} minutes; every minute lowers the odds`,
          why: "Calling within 5 minutes instead of 30 raised contact odds 100x. Firms that responded within an hour were about 7x as likely to qualify the lead as those an hour later.",
          sources: ["lead_response_mgmt", "hbr_short_life", "velocify"],
        };
      } else {
        const wait = nextTouch.day - day;
        next_action = {
          action: nextTouch.note,
          when: wait > 0 ? `In ${wait} day${wait === 1 ? "" : "s"} (day ${nextTouch.day})` : "Today, inside allowed hours",
          why:
            lead_type === "inbound"
              ? "Six calls with voicemails on calls 2 and 6 reach almost all leads that will convert."
              : "Max one call a day keeps your numbers off spam lists and inside state limits.",
          sources: lead_type === "inbound" ? ["velocify"] : ["monmaclabs_protocol"],
        };
      }
      briefs.push(
        brief("first text", "Get a reply, nothing more.", ["Your first name and company", "The property address or street", "One easy yes/no question", 'How to opt out, e.g. "Reply STOP to opt out"']),
        brief("voicemail", "Make calling back feel easy and safe.", ["Your name, company and number, said twice", "Why you are calling in one sentence", "Under 30 seconds"]),
        brief("final text of the sequence", "Leave the door open.", ["That this is your last message for a while", "That they can reach you any time"]),
      );
      break;
    }
  }

  for (const s of next_action.sources) used.add(s);
  return finish({ next_action, touches, after_schedule, briefs });

  function finish(p: { next_action: Plan["next_action"]; touches?: Touch[]; after_schedule: string; briefs?: Plan["message_briefs"] }): Plan {
    if (lead_type === "cold_outbound" || p.touches === undefined) used.add("monmaclabs_protocol");
    for (const s of p.next_action.sources) used.add(s);
    return {
      lead_type,
      next_action: p.next_action,
      schedule: group(p.touches ?? []),
      after_schedule: p.after_schedule,
      stop_rules: STOP_RULES,
      message_briefs: p.briefs ?? [],
      compliance,
      sources: [...used].map((id) => ({ id, ...SOURCES[id] })),
      rules_as_of: RULES_AS_OF,
      disclaimer: DISCLAIMER,
    };
  }
}
