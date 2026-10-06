import { describe, expect, it } from "vitest";
import worker from "../src/worker.js";

const HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "Mcp-Protocol-Version": "2025-06-18" };

async function rpc(method: string, params: object = {}, id = 1) {
  const res = await worker.fetch(
    new Request("https://example.test/mcp", { method: "POST", headers: HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }),
  );
  return { status: res.status, headers: res.headers, body: (await res.json()) as any };
}

describe("worker over Streamable HTTP", () => {
  it("initializes statelessly", async () => {
    const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    expect(r.status).toBe(200);
    expect(r.body.result.serverInfo.name).toBe("seller-lead-followup");
    expect(r.headers.get("mcp-session-id")).toBeNull();
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("lists both tools with read-only annotations and titles", async () => {
    const r = await rpc("tools/list");
    const tools = r.body.result.tools as any[];
    expect(tools.map((t) => t.name).sort()).toEqual(["check_seller_text", "plan_seller_follow_up"]);
    for (const t of tools) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect(t.annotations.title).toBeTruthy();
    }
  });

  it("calls plan_seller_follow_up", async () => {
    const r = await rpc("tools/call", { name: "plan_seller_follow_up", arguments: { source: "ppl", status: "new", seller_state: "FL" } });
    expect(r.body.result.isError).toBeFalsy();
    expect(r.body.result.structuredContent.next_action.action).toBe("Call now.");
    expect(r.body.result.content[0].text).toMatch(/^Next: Call now\./);
  });

  it("calls check_seller_text", async () => {
    const r = await rpc("tools/call", {
      name: "check_seller_text",
      arguments: { message: "Still interested?", last_seller_reply: "STOP", seller_state: "FL" },
    });
    expect(r.body.result.structuredContent.verdict).toBe("do_not_send");
  });

  it("rejects bad input with a tool error instead of crashing", async () => {
    const r = await rpc("tools/call", { name: "plan_seller_follow_up", arguments: { source: "billboard", status: "new" } });
    expect(r.status).toBe(200);
    expect(r.body.result?.isError ?? !!r.body.error).toBe(true);
  });

  it("serves health and 404s", async () => {
    expect((await worker.fetch(new Request("https://example.test/health"))).status).toBe(200);
    expect((await worker.fetch(new Request("https://example.test/nope"))).status).toBe(404);
  });

  it("returns 429 with Retry-After when the global limit is hit, and passes when it is not", async () => {
    const req = () =>
      new Request("https://example.test/mcp", { method: "POST", headers: HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const keys: string[] = [];
    const blocked = await worker.fetch(req(), { RATE_LIMITER: { limit: async ({ key }) => (keys.push(key), { success: false }) } });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(blocked.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await blocked.json()) as any).error.code).toBe(-32000);
    expect(keys).toEqual(["mcp-global"]);
    const allowed = await worker.fetch(req(), { RATE_LIMITER: { limit: async () => ({ success: true }) } });
    expect(allowed.status).toBe(200);
  });

  it("does not rate-limit health checks", async () => {
    let called = false;
    const res = await worker.fetch(new Request("https://example.test/health"), { RATE_LIMITER: { limit: async () => ((called = true), { success: false }) } });
    expect(res.status).toBe(200);
    expect(called).toBe(false);
  });
});
