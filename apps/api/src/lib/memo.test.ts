import { describe, expect, it } from "vitest";
import { MemoSchema, memoToPaise } from "./memo";

describe("memoToPaise", () => {
  it("converts rupees to paise and keeps nulls", () => {
    const read = MemoSchema.parse({
      date: "2026-11-12",
      total: 48250,
      cash: 21000.5,
      online: 24150,
      expenses_total: null,
      lines: [{ label: "Milk", amount: 1200 }],
      unsure: ["cash"],
      note: null,
    });
    expect(memoToPaise(read)).toEqual({
      date: "2026-11-12",
      total: 4825000,
      cash: 2100050,
      online: 2415000,
      expenses_total: null,
      lines: [{ label: "Milk", amount: 120000 }],
      unsure: ["cash"],
      note: null,
    });
  });
  it("drops a date that isn't YYYY-MM-DD", () => {
    const read = MemoSchema.parse({ date: "12/11", total: null, cash: null, online: null, expenses_total: null, lines: [], unsure: [], note: null });
    expect(memoToPaise(read).date).toBeNull();
  });
});

describe("readMemo", () => {
  it("sends the image with structured output and fallbacks, and parses the reply", async () => {
    let sent: any = null;
    let headers: Headers | null = null;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      headers = new Headers(init.headers);
      const out = { date: "2026-11-12", total: 1000, cash: 500, online: 300, expenses_total: 200, lines: [{ label: "Milk", amount: 200 }], unsure: [], note: null };
      return new Response(
        JSON.stringify({
          id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify(out) }],
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const { readMemo } = await import("./memo");
    const r = await readMemo("sk-test", "claude-opus-5-5", { data: new Uint8Array([1, 2, 3]).buffer, mediaType: "image/jpeg" }, fakeFetch);
    expect(r.read.total).toBe(1000);
    expect(sent.model).toBe("claude-opus-5-5");
    expect(sent.fallbacks).toBe("default");
    expect(sent.output_config.format.type).toBe("json_schema");
    expect(sent.messages[0].content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AQID" } });
    expect(headers!.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
  });
});
