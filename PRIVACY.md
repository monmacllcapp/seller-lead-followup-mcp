# Privacy policy

Seller Lead Follow-Up, by MonmacLabs. Effective 2026-10-06.

**What the server receives.** When Claude, ChatGPT or another app calls a tool, it sends the inputs for that call: lead status, counts, a US state, a planned send time, and for `check_seller_text` the message text and the seller's last reply. The tools do not ask for names, phone numbers or addresses; leave them out of messages you check if you prefer.

**What it keeps.** Nothing. The server is stateless: it computes the answer, returns it, and discards the request. There are no accounts, cookies, sessions, databases or analytics, and Workers logging is turned off in this project's configuration.

**Who else sees it.** The hosted version runs on Cloudflare Workers, so requests pass through Cloudflare's network under [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/). The AI app you use has its own policy for your conversations.

**Self-hosting.** If you run your own copy, you control everything above.

**Contact.** Open an issue at <https://github.com/monmacllcapp/seller-lead-followup-mcp/issues>.
