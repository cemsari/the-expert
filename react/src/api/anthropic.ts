// The Expert — Anthropic API client (BYOK, direct browser).
// Phase 2: streaming via Server-Sent Events.
import { AnyTier, Effort, MODELS } from "../brain/models";

export interface ChatMessage { role: "user" | "assistant"; content: string; }
export interface CallResult { text: string; tokensIn: number; tokensOut: number; cost: number; }

const MAX_TOK: Record<Effort, number> = { low: 1024, medium: 2048, high: 8192 };

const SYSTEM =
  "When presenting tabular data (lists of records, comparisons, or anything the " +
  "user wants in Excel/CSV/table form), format it as a GitHub-style markdown " +
  "table using | pipes. Do not use plain-text column alignment.";

function buildBody(
  tier: AnyTier, effort: Effort, history: ChatMessage[], prompt: string,
  noThinking: boolean, stream: boolean
): Record<string, unknown> {
  const m = MODELS[tier];
  const messages = [...history.slice(-20), { role: "user" as const, content: prompt }];
  const body: Record<string, unknown> = {
    model: m.id,
    max_tokens: MAX_TOK[effort] ?? 2048,
    system: SYSTEM,
    messages,
  };
  if (stream) body.stream = true;
  if (effort === "high" && !noThinking) {
    if (m.adaptive) body.thinking = { type: "adaptive" };
    else if (tier !== "haiku") body.thinking = { type: "enabled", budget_tokens: 4000 };
  }
  return body;
}

function headers(apiKey: string) {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

/** Non-streaming call (fallback + tests). */
export async function callAnthropic(
  apiKey: string, tier: AnyTier, effort: Effort,
  history: ChatMessage[], prompt: string, noThinking = false
): Promise<CallResult> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(buildBody(tier, effort, history, prompt, noThinking, false)),
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
    .map((b: { text: string }) => b.text).join("");
  const u = data.usage || {};
  return finish(tier, text, u.input_tokens || 0, u.output_tokens || 0);
}

/** Parse one SSE payload line; returns a delta/usage update. Exported for tests. */
export interface StreamEvent { text?: string; tokensIn?: number; tokensOut?: number; error?: string; }
export function parseSseLine(line: string): StreamEvent | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  let ev: any;
  try { ev = JSON.parse(payload); } catch { return null; }
  if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta")
    return { text: ev.delta.text };
  if (ev.type === "message_start")
    return { tokensIn: ev.message?.usage?.input_tokens };
  if (ev.type === "message_delta")
    return { tokensOut: ev.usage?.output_tokens };
  if (ev.type === "error")
    return { error: ev.error?.message || "stream error" };
  return null;
}

/**
 * Streaming call. Calls onDelta(chunk) as tokens arrive; resolves with the
 * full result. Falls back to non-streaming if the body isn't readable.
 */
export async function streamAnthropic(
  apiKey: string, tier: AnyTier, effort: Effort,
  history: ChatMessage[], prompt: string,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
  noThinking = false
): Promise<CallResult> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(buildBody(tier, effort, history, prompt, noThinking, true)),
    signal,
  });

  if (!r.ok) {
    const errTxt = await r.text();
    if (r.status === 400 && /thinking/i.test(errTxt) && !noThinking) {
      return streamAnthropic(apiKey, tier, effort, history, prompt, onDelta, signal, true);
    }
    throw new Error(r.status + " " + errTxt.slice(0, 160));
  }
  if (!r.body) return callAnthropic(apiKey, tier, effort, history, prompt, noThinking);

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", text = "", tokensIn = 0, tokensOut = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        const ev = parseSseLine(line);
        if (!ev) continue;
        if (ev.error) throw new Error(ev.error);
        if (ev.text) { text += ev.text; onDelta(ev.text); }
        if (ev.tokensIn != null) tokensIn = ev.tokensIn;
        if (ev.tokensOut != null) tokensOut = ev.tokensOut;
      }
    }
  }
  return finish(tier, text, tokensIn, tokensOut);
}

function finish(tier: AnyTier, text: string, tokensIn: number, tokensOut: number): CallResult {
  const [pi, po] = MODELS[tier].price;
  return { text, tokensIn, tokensOut, cost: (tokensIn * pi + tokensOut * po) / 1e6 };
}

export function friendlyError(err: Error): string {
  const m = (err.message || "").toLowerCase();
  if (m.includes("abort")) return "Stopped.";
  if (m.includes("credit balance"))
    return "Your Anthropic API account has no credits yet. API billing is separate from a Claude subscription — add credits at console.anthropic.com → Billing, then resend.";
  if (m.includes("401") || m.includes("invalid x-api-key") || m.includes("authentication"))
    return "That API key wasn't accepted. Check it — it should start with sk-ant- and be active in your console.";
  if (m.includes("429") || m.includes("rate")) return "Rate limited. Wait a few seconds and resend.";
  if (m.includes("failed to fetch") || m.includes("networkerror"))
    return "Couldn't reach Anthropic. Check your connection, or an ad-blocker may be blocking api.anthropic.com.";
  return "Couldn't complete that: " + err.message.slice(0, 140);
}


/** Classify an ambiguous prompt with a cheap Haiku call. Fail-open: returns null. */
export async function classifyWithHaiku(
  apiKey: string, prompt: string
): Promise<{ tier: AnyTier; effort: Effort } | null> {
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctl.signal,
      headers: headers(apiKey),
      body: JSON.stringify({
        model: MODELS.haiku.id,
        max_tokens: 100,
        system:
          'You are a routing classifier. Reply ONLY compact JSON ' +
          '{"tier":"haiku|sonnet|opus","effort":"low|medium|high"}. ' +
          "haiku=trivial, sonnet=normal work, opus=architecture/deep reasoning.",
        messages: [{ role: "user", content: prompt.slice(0, 4000) }],
      }),
    });
    clearTimeout(to);
    if (!r.ok) return null;
    const data = await r.json();
    const txt = (data.content || [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text).join("")
      .replace(/```json|```/g, "").trim();
    const p = JSON.parse(txt);
    if (!(p.tier in MODELS)) return null;
    if (!["low", "medium", "high"].includes(p.effort)) return null;
    return { tier: p.tier, effort: p.effort };
  } catch {
    return null;  // fail-open: heuristic stands
  }
}
