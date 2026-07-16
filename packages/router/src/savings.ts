// The Expert — savings math + quips (pure). Ported from tracker.py / web edition.
import { AnyTier, MODELS, modelShort } from "./models";

export interface TurnCost {
  tier: AnyTier;
  tokensIn: number;
  tokensOut: number;
}

export function turnCost(t: TurnCost): number {
  const [pi, po] = MODELS[t.tier].price;
  return (t.tokensIn * pi + t.tokensOut * po) / 1e6;
}

// Baseline = same tokens priced at Opus 4.8 standard rates.
export function opusBaseline(tokensIn: number, tokensOut: number): number {
  const [oi, oo] = MODELS.opus.price;
  return (tokensIn * oi + tokensOut * oo) / 1e6;
}

export function savingsForTurn(t: TurnCost): { cost: number; baseline: number; saved: number } {
  const cost = turnCost(t);
  const baseline = opusBaseline(t.tokensIn, t.tokensOut);
  return { cost, baseline, saved: Math.max(0, baseline - cost) };
}

// --- quips (sloth voice) ---
interface QuipCtx { saved: number; tier: AnyTier; pct: number; }

const SAVED = [
  (s: QuipCtx) => `Saved $${s.saved.toFixed(4)} — the sloth stays hydrated. 🦥`,
  (s: QuipCtx) => `That's ${s.pct}% off the Opus price. Your wallet just did a tiny fist pump.`,
  (s: QuipCtx) => `${modelShort(s.tier)} handled it. Opus never even had to put trousers on.`,
  (s: QuipCtx) => `Routed to ${s.tier} and pocketed $${s.saved.toFixed(4)}. Compound interest, but for laziness. 🦥`,
];
const OPUS = [
  () => `No savings this time — this one needed the big brain. Money well burned. 🔥`,
  () => `Full Opus deployed. Your question was flattered, honestly.`,
];
const ZERO = [
  () => `Barely anything saved — tiny question, tiny stakes. The sloth shrugs. 🦥`,
  () => `Rounding-error savings. Ask me something harder.`,
];

export function quip(
  turn: { saved: number; tier: AnyTier; baseline: number },
  totalSaved: number,
  prevTotal: number,
  rand: () => number = Math.random
): string {
  if (Math.floor(totalSaved / 0.25) > Math.floor(prevTotal / 0.25) && totalSaved > 0) {
    return `🏆 MILESTONE: $${totalSaved.toFixed(2)} saved lifetime. The sloth salutes you. 🦥`;
  }
  const ctx: QuipCtx = {
    saved: turn.saved,
    tier: turn.tier,
    pct: turn.baseline ? Math.round((100 * turn.saved) / turn.baseline) : 0,
  };
  const pick = (a: Array<(c: QuipCtx) => string>) => a[Math.floor(rand() * a.length)](ctx);
  if (turn.tier === "opus" || turn.tier === "fable") return pick(OPUS);
  if (turn.saved < 0.0005) return pick(ZERO);
  return pick(SAVED);
}
