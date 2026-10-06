import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SERVER_NAME, SERVER_VERSION, createServer } from "./server.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

function withCors(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

/**
 * Stateless MCP over Streamable HTTP. Each request gets a fresh server and transport:
 * nothing is stored between requests, so there is no session or user data to keep.
 */
export async function handleMcp(request: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 64 * 1024,
  });
  const server = createServer();
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // JSON responses are complete once returned, so the per-request server can close.
    void server.close();
  }
}

export type Env = {
  /** Cloudflare rate limit binding (wrangler.jsonc). Absent in tests and plain Node. */
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
};

/**
 * One global ceiling for /mcp. Not per IP: every Claude or ChatGPT user arrives from those
 * companies' shared servers, and Cloudflare advises against IP keys. Limits are per Cloudflare
 * location and approximate by design.
 */
async function rateLimited(env: Env | undefined): Promise<Response | null> {
  if (!env?.RATE_LIMITER) return null;
  const { success } = await env.RATE_LIMITER.limit({ key: "mcp-global" });
  if (success) return null;
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests right now. Try again in a minute." } },
    { status: 429, headers: { "Retry-After": "60" } },
  );
}

export default {
  async fetch(request: Request, env?: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/mcp") return withCors((await rateLimited(env)) ?? (await handleMcp(request)));
    if (url.pathname === "/health") return Response.json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION });
    if (url.pathname === "/")
      return new Response(
        `${SERVER_NAME} ${SERVER_VERSION}\nMCP endpoint: ${url.origin}/mcp\nSource: https://github.com/monmacllcapp/seller-lead-followup-mcp\nBy MonmacLabs.\n`,
        { headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    return new Response("Not found", { status: 404 });
  },
};
