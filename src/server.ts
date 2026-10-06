import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CONSENT, checkText } from "./rules/texting.js";
import { LEAD_SOURCES, STATUSES, planFollowUp } from "./rules/followup.js";

export const SERVER_NAME = "seller-lead-followup";
export const SERVER_VERSION = "0.1.0";

const state = z
  .string()
  .regex(/^[A-Za-z]{2}$/)
  .optional()
  .describe("Two-letter US state where the seller lives, e.g. FL. Sets allowed hours and daily caps.");
const count = (what: string) => z.number().int().min(0).max(1000).optional().describe(what);

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function result(summary: string, data: object) {
  return {
    content: [{ type: "text" as const, text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }],
    structuredContent: data as Record<string, unknown>,
  };
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Follow-up planning for real estate investors and wholesalers working motivated-seller leads. " +
        "Use plan_seller_follow_up when the user describes a seller lead and asks what to do next, when to call or text, or how to follow up. " +
        "Use check_seller_text before the user sends a text to a seller. These tools plan and check; they never contact anyone. " +
        "Write the actual messages yourself from the message_briefs, and keep every stop rule.",
    },
  );

  server.registerTool(
    "plan_seller_follow_up",
    {
      title: "Plan seller lead follow-up",
      description:
        "Given one motivated-seller lead (where it came from, where it stands, what has been tried), returns what to do right now, " +
        "the follow-up schedule by day, when to stop, a brief for each message, and the calling-hour and consent rules for the seller's state. " +
        "Built on lead-response research and a working wholesaling team's protocol. Plans only; sends nothing.",
      inputSchema: {
        source: z
          .enum(LEAD_SOURCES)
          .describe("Where the lead came from. cold_list = a skip-traced or purchased list with no prior contact; everything else is inbound."),
        status: z
          .enum(STATUSES)
          .describe(
            "Where it stands. new = just arrived, untouched. no_contact_yet = attempts made, never reached. hot = wants an offer now or asked for a callback. " +
              "warm = open to an offer, not urgent. future_timeline = ready later (give seller_timeline_days). offer_sent = offer delivered. " +
              "not_interested_soft = 'not right now'. not_interested_hard = firm no. opted_out = asked not to be contacted. wrong_number.",
          ),
        minutes_since_lead_arrived: count("For new inbound leads: minutes since it came in."),
        days_since_first_touch: count("Days since your first call or text on this lead; 0 = today."),
        call_attempts: count("Calls made so far in this sequence, voicemails included."),
        texts_sent: count("Texts sent so far in this sequence."),
        touches_last_24h: count("Calls plus texts to this person in the last 24 hours."),
        seller_state: state,
        seller_timeline_days: count("For future_timeline: days until the seller said they would be ready."),
        callback_requested: z.boolean().optional().describe("The seller asked to be called back at a set time."),
      },
      annotations: { title: "Plan seller lead follow-up", ...READ_ONLY },
    },
    async (args) => {
      const plan = planFollowUp(args);
      return result(`Next: ${plan.next_action.action} (${plan.next_action.when})`, plan);
    },
  );

  server.registerTool(
    "check_seller_text",
    {
      title: "Check a text to a seller",
      description:
        "Checks a text message before it goes to a property seller: opt-out replies, allowed hours in the seller's state, daily contact caps, consent, " +
        "a missing opt-out line or sender name, risky wording, and SMS length. Returns ok_to_send, fix_before_sending or do_not_send with reasons and sources. " +
        "A safety check, not legal advice. Sends nothing.",
      inputSchema: {
        message: z.string().min(1).max(1600).describe("The exact text you plan to send."),
        seller_state: state,
        send_time_local: z
          .string()
          .max(5)
          .optional()
          .describe('Planned send time in the seller\'s time zone, 24-hour "HH:MM".'),
        day_of_week: z.number().int().min(0).max(6).optional().describe("Seller's local day: 0 = Sunday ... 6 = Saturday."),
        is_first_message: z.boolean().optional().describe("True if this is the first text to this person."),
        consent: z
          .enum(CONSENT)
          .optional()
          .describe("written = signed or form consent to texts; inbound_or_verbal = they contacted you or agreed on a call; none = cold list; unknown."),
        touches_last_24h: count("Calls plus texts to this person in the last 24 hours."),
        last_seller_reply: z.string().max(1600).optional().describe("The seller's most recent reply, if any."),
      },
      annotations: { title: "Check a text to a seller", ...READ_ONLY },
    },
    async (args) => {
      const check = checkText(args);
      const n = check.issues.filter((i) => i.severity !== "info").length;
      return result(`Verdict: ${check.verdict}${n ? ` (${n} issue${n === 1 ? "" : "s"} to address)` : ""}`, check);
    },
  );

  return server;
}
