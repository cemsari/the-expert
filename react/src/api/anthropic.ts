// The Expert — Anthropic API client (BYOK, direct browser). Ported from web edition.
import { AnyTier, Effort, MODELS } from "../brain/models";

export interface ChatMessage { role: "user" | "assistant"; content: string; }
export interface CallResult { text: string; tokensIn: number; tokensOut: number; cost: number; }

const MAX_TOK: Record<Effort, number> = { low: 1024, medium: 2048, high: 8192 };

const SYSTEM =
  "When presenting tabular data (lists of records, comparisons, or anything the " +
  "user wants in Excel/CSV/table form), format it as a GitHub-style markdown " +
  "table using | pipes. Do not use plain-text column alignment.";

export async function callAnthropic(
  apiKey: string,
  tier: AnyTier,
  effort: Effort,
  history: ChatMessage[],
  prompt: string,
  noThinking = false
): Promise<CallResult> {
  const m = MODELS[tier];
  const messages = [...history.slice(-20), { role: "user" as const, content: prompt }];
  const body: Record<string, unknown> = {
    model: m.id,
    max_tokens: MAX_TOK[effort] ?? 2048,
    system: SYSTEM,
    messages,
  };
  // high effort -> extended thinking. Adaptive models need {type:"adaptive"}.
  if (effort === "high" && !noThinking) {
    if (m.adaptive) body.thinking = { type: "adaptive" };
    else if (tier !== "haiku") body.thinking = { type: "enabled", budget_tokens: 4000 };
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const errTxt = await r.text();
    if (r.status === 400 && /thinking/i.test(errTxt) && !noThinking) {
      return callAnthropic(apiKey, tier, effort, history, prompt, true);
    }
    throw new Error(r.status + " " + errTxt.slice(0, 160));
  }

  const data = await r.json();
  const text = (data.content || [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");
  const u = data.usage || {};
  const tokensIn = u.input_tokens || 0;
  const tokensOut = u.output_tokens || 0;
  const [pi, po] = m.price;
  return { text, tokensIn, tokensOut, cost: (tokensIn * pi + tokensOut * po) / 1e6 };
}

export function friendlyError(err: Error): string {
  const m = (err.message || "").toLowerCase();
  if (m.includes("credit balance"))
    return "Your Anthropic API account has no credits yet. API billing is separate from a Claude subscription — add credits at console.anthropic.com → Billing, then resend.";
  if (m.includes("401") || m.includes("invalid x-api-key") || m.includes("authentication"))
    return "That API key wasn't accepted. Check it — it should start with sk-ant- and be active in your console.";
  if (m.includes("429") || m.includes("rate")) return "Rate limited. Wait a few seconds and resend.";
  if (m.includes("failed to fetch") || m.includes("networkerror"))
    return "Couldn't reach Anthropic. Check your connection, or an ad-blocker may be blocking api.anthropic.com.";
  return "Couldn't complete that: " + err.message.slice(0, 140);
}
