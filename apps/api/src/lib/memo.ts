// Reads a photo of the handwritten closing memo with Claude and returns the numbers on it.
// The result is only a suggestion: the manager's typed numbers stay the record.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const Amount = z.number().nullable().describe("Amount in rupees as written, or null if it isn't on the memo or can't be read");

export const MemoSchema = z.object({
  date: z.string().nullable().describe("Date written on the memo as YYYY-MM-DD, or null"),
  total: Amount.describe("Total counter / total sale for the day, in rupees, or null"),
  cash: Amount.describe("Cash left in the counter at closing, in rupees, or null"),
  online: Amount.describe("Online / UPI / card payments, in rupees, or null"),
  expenses_total: Amount.describe("Total of expenses paid from the counter, in rupees, or null"),
  lines: z
    .array(z.object({ label: z.string().describe("What the expense was for, transliterated into English letters"), amount: z.number().describe("Rupees") }))
    .describe("Each expense line written on the memo, in order"),
  unsure: z.array(z.enum(["date", "total", "cash", "online", "expenses_total", "lines"])).describe("Fields you could not read with confidence"),
  note: z.string().nullable().describe("One short sentence about anything unclear, or null"),
});
export type MemoRead = z.infer<typeof MemoSchema>;

const PROMPT = `This is a photo of the handwritten end-of-day closing memo from an Indian restaurant.
The manager writes the day's total counter amount, the cash left in the counter, online payments (UPI, card, Paytm, PhonePe, GPay),
and the expenses paid from the counter, usually as a list of item and amount. Words may be in English, Hindi or Kannada, or a mix.
Their rule is: cash + online + expenses = total.

Read the numbers exactly as written. Don't correct or calculate a number that isn't written; use null instead.
Amounts are in rupees. Ignore struck-out figures. If a figure is ambiguous (for example 1 vs 7, or a smudged digit), give your best reading and list the field in "unsure".`;

export class MemoError extends Error {}

/** Sends one image to Claude and returns the parsed memo, plus the model that answered. */
export async function readMemo(
  apiKey: string,
  model: string,
  image: { data: ArrayBuffer; mediaType: "image/jpeg" | "image/png" | "image/webp" },
  fetchImpl?: typeof fetch, // tests only
): Promise<{ read: MemoRead; model: string }> {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  const response = await client.beta.messages.parse({
    model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(MemoSchema) },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: toBase64(image.data) } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new MemoError("refused");
  if (response.stop_reason === "max_tokens") throw new MemoError("truncated");
  if (!response.parsed_output) throw new MemoError("unparsed");
  return { read: response.parsed_output, model: response.model };
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Converts the model's rupee amounts to paise, as everything else in the app uses. */
export function memoToPaise(r: MemoRead) {
  const p = (v: number | null) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 100));
  return {
    date: r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
    total: p(r.total),
    cash: p(r.cash),
    online: p(r.online),
    expenses_total: p(r.expenses_total),
    lines: r.lines.map((l) => ({ label: l.label, amount: p(l.amount) ?? 0 })),
    unsure: r.unsure,
    note: r.note,
  };
}
