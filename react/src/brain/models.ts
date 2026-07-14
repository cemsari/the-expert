// The Expert — model registry (single source of truth).
// Ported from the web edition's MODELS map. When Anthropic ships or retires a
// model, update IDs/prices here only.

export type Tier = "haiku" | "sonnet" | "opus" | "fable";
export type LegacyTier =
  | "opus-4-7" | "opus-4-6" | "opus-4-5" | "sonnet-4-6" | "sonnet-4-5";
export type AnyTier = Tier | LegacyTier;
export type Effort = "low" | "medium" | "high";

export interface ModelInfo {
  id: string;
  price: [number, number]; // [input $/MTok, output $/MTok]
  label: string;
  ver: string;
  adaptive: boolean;
  legacy?: boolean;
  retires?: string;
}

export const MODELS: Record<AnyTier, ModelInfo> = {
  haiku:  { id: "claude-haiku-4-5-20251001", price: [1, 5],   label: "Haiku",  ver: "4.5", adaptive: false },
  sonnet: { id: "claude-sonnet-5",           price: [2, 10],  label: "Sonnet", ver: "5",   adaptive: true },
  opus:   { id: "claude-opus-4-8",           price: [5, 25],  label: "Opus",   ver: "4.8", adaptive: true },
  fable:  { id: "claude-fable-5",            price: [10, 50], label: "Fable",  ver: "5",   adaptive: true },
  // still-callable legacy models (opt-in)
  "opus-4-7":   { id: "claude-opus-4-7",            price: [5, 25], label: "Opus",   ver: "4.7", adaptive: true,  legacy: true },
  "opus-4-6":   { id: "claude-opus-4-6",            price: [5, 25], label: "Opus",   ver: "4.6", adaptive: true,  legacy: true },
  "opus-4-5":   { id: "claude-opus-4-5-20251101",  price: [5, 25], label: "Opus",   ver: "4.5", adaptive: false, legacy: true },
  "sonnet-4-6": { id: "claude-sonnet-4-6",          price: [3, 15], label: "Sonnet", ver: "4.6", adaptive: true,  legacy: true },
  "sonnet-4-5": { id: "claude-sonnet-4-5-20250929", price: [3, 15], label: "Sonnet", ver: "4.5", adaptive: false, legacy: true, retires: "Sep 29 2026" },
};

export const CORE_TIERS: Tier[] = ["haiku", "sonnet", "opus", "fable"];
export const TIER_ORDER: Tier[] = ["haiku", "sonnet", "opus"]; // auto-routing ladder
export const DEFAULT_EFFORT: Record<AnyTier, Effort> = {
  haiku: "low", sonnet: "medium", opus: "high", fable: "high",
  "opus-4-7": "high", "opus-4-6": "high", "opus-4-5": "high",
  "sonnet-4-6": "medium", "sonnet-4-5": "medium",
};

export const modelName = (t: AnyTier) => `Claude ${MODELS[t].label} ${MODELS[t].ver}`;
export const modelShort = (t: AnyTier) => `${MODELS[t].label} ${MODELS[t].ver}`;
