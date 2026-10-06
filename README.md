# Seller Lead Follow-Up

A free connector for Claude and ChatGPT that tells real estate investors and wholesalers what to do next with a seller lead, and checks texts to sellers before they go out.

Built by [MonmacLabs](https://monmaclabs.com). MIT licensed.

## Why it exists

Follow-up usually goes wrong in one of two ways: too slow on fresh leads, or too much, at the wrong hour, on cold ones. Wholesalers ask the same questions every week: how fast to call back a paid lead, what to send after "not interested", how to text without breaking the rules, how to bring a cold lead back. This connector answers them inside the AI you already use, with sources for every rule.

## What it does

Two tools. Both are read-only: they plan and check, and they never call, text or store anything.

**`plan_seller_follow_up`**: describe one lead and get:
- what to do right now, and how soon
- the follow-up schedule by day
- when to stop
- a brief for each message (goal, what to include, what to avoid), so Claude or ChatGPT can write it in your voice
- the contact hours, daily caps and consent notes for the seller's state

**`check_seller_text`**: paste a text before you send it and get `ok_to_send`, `fix_before_sending` or `do_not_send`, with reasons. It checks:
- whether the seller already opted out (the seven words the FCC treats as revoking consent, plus phrases like "don't text me")
- allowed hours in the seller's state and time zone, including Sunday rules
- the 3-per-day contact cap in Florida, Maryland and Oklahoma
- consent, including Maryland's written-consent rule
- a missing opt-out line, a missing sender name, or a link in a first text
- pressure, hardship or official-sounding wording
- length and SMS segments

## Example

All names and numbers are made up.

> **You:** I got a PPL lead 2 minutes ago, Linda at 48 Oak Ridge Dr in Tampa. What do I do?
>
> **Claude (using the connector):** Call her now; you're inside the window where speed matters most. If she doesn't pick up, text her within 2 minutes. Florida allows contact 8 a.m. to 8 p.m. her time and no more than 3 calls or texts in 24 hours, so today is: call, text, then one more call about an hour later with a voicemail…

> **You:** Check this before I send it: "Final notice, we can stop your foreclosure, call now!"
>
> **Claude:** Don't send it. "Final notice" reads as fake urgency, and it mentions foreclosure when she hasn't. It has no sender name and no opt-out line…

## Where the rules come from

| Situation | Rule | Source |
|---|---|---|
| New inbound lead | Call in the first minute; text within 2 minutes if missed | Lead Response Management study (5 vs 30 minutes: 100x contact odds); HBR, *The Short Life of Online Sales Leads* |
| Inbound, not reached | 6 calls, voicemails on calls 2 and 6 | Velocify study of ~3.5M leads: 93% of converted leads reached by call 6 |
| Cold list | 7 days, max 4 calls, 1 call a day, then a monthly drip | MonmacLabs field protocol |
| "Maybe in a few months" | Follow up about 2 weeks before their date | MonmacLabs field protocol |
| Not interested | Monthly for 3 months, then quarterly; a firm no waits 90 days | MonmacLabs field protocol |
| Contact hours | 8 a.m. to 9 p.m. federal; stricter in 12 states | 47 CFR 64.1200(c)(1); state summary updated 2026-09-30 |
| Opt-outs | stop, quit, end, revoke, opt out, cancel, unsubscribe | 47 CFR 64.1200(a)(10) |

Full citations and the reasoning behind each choice are in [SOURCES.md](SOURCES.md). Rules are current as of 2026-10-06.

**This is a planning and safety aid, not legal advice.** Calling and texting laws change and vary by state. Get a TCPA attorney's review before running automated outreach.

## Use it

### Claude or ChatGPT (hosted)

The hosted endpoint is coming soon. Once it is live, add it as a custom connector using its `/mcp` URL.

### Run it yourself

Node.js 20 or later.

```bash
git clone https://github.com/monmacllcapp/seller-lead-followup-mcp
cd seller-lead-followup-mcp
npm install
```

Claude Code:

```bash
claude mcp add seller-lead-followup -- npx tsx /path/to/seller-lead-followup-mcp/src/stdio.ts
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "seller-lead-followup": {
      "command": "npx",
      "args": ["tsx", "/path/to/seller-lead-followup-mcp/src/stdio.ts"]
    }
  }
}
```

HTTP server on Cloudflare's local runtime, at `http://localhost:8787/mcp`:

```bash
npm run dev
```

Deploy to your own Cloudflare account (the free plan is enough):

```bash
npx wrangler login
npm run deploy
```

## Privacy

The server is stateless. It keeps no accounts, sessions, logs or lead data; each request is handled and forgotten. See [PRIVACY.md](PRIVACY.md).

## Development

```bash
npm run typecheck
npm test
```

Every rule lives in `src/rules/` as a plain function with tests in `test/`. Each rule names its source in `src/rules/sources.ts`; a pull request that changes a rule should change its source too.

## Need it wired into your own CRM or dialer?

MonmacLabs builds marketing and automation systems for operators. [monmaclabs.com](https://monmaclabs.com)
