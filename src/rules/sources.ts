/**
 * Every rule in this connector points at one of these sources.
 * If you change a rule, change or add its source in the same commit.
 */
export const SOURCES = {
  fcc_calling_hours: {
    title: "47 CFR 64.1200(c)(1): no telephone solicitation before 8 a.m. or after 9 p.m., called party's local time",
    url: "https://www.law.cornell.edu/cfr/text/47/64.1200",
  },
  fcc_revocation: {
    title:
      '47 CFR 64.1200(a)(10): "stop", "quit", "end", "revoke", "opt out", "cancel" or "unsubscribe" revokes consent; honor within 10 business days',
    url: "https://www.law.cornell.edu/cfr/text/47/64.1200",
  },
  state_mini_tcpa: {
    title: "JustCall, State-by-State Mini-TCPA Laws (updated 2026-09-30)",
    url: "https://justcall.io/blog/state-mini-tcpa-laws.html",
  },
  hbr_short_life: {
    title:
      "Oldroyd, McElheran & Elkington, The Short Life of Online Sales Leads, HBR (2011): contact within 1 hour is ~7x as likely to qualify as 1 hour later, 60x vs 24+ hours",
    url: "https://hbr.org/2011/03/the-short-life-of-online-sales-leads",
  },
  lead_response_mgmt: {
    title:
      "Oldroyd, Lead Response Management study: calling within 5 minutes vs 30 minutes raised contact odds 100x and qualification odds 21x; 4-6 pm best contact window",
    url: "https://www.mortech.com/hs-fs/hub/25649/file-13535879-pdf/docs/mit_study.pdf",
  },
  velocify: {
    title:
      "Velocify sales optimization study (~3.5M leads): 93% of converted leads reached by the 6th call; first voicemail on call 2 converts 31% better; two voicemails over six calls +34%",
    url: "https://www.slideshare.net/Velocify/the-ultimate-contact-strategy",
  },
  monmaclabs_protocol: {
    title:
      "MonmacLabs field calling protocol: 7-day cold sequence (max 4 calls, 1 call a day), timeline-based drip, monthly then quarterly nurture",
    url: "https://github.com/monmacllcapp/seller-lead-followup-mcp/blob/main/SOURCES.md#monmaclabs-field-protocol",
  },
} as const;

export type SourceId = keyof typeof SOURCES;

export const RULES_AS_OF = "2026-10-06";
export const DISCLAIMER =
  "Planning and safety aid, not legal advice. Calling and texting rules change; confirm with a TCPA attorney before running automated outreach.";
