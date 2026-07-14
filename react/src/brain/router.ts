// The Expert — routing brain (pure, testable). Ported from web edition.
import type { Tier, AnyTier, Effort } from "./models";

export interface Decision {
  tier: AnyTier;
  effort: Effort;
  conf: number;
  reason: string;
  src: "heuristic" | "haiku" | "learned" | "experiment" | "directed" | "continuation" | "override";
}

const SIMPLE: RegExp[] = [
  /^\s*\d+\s*[+\-*/x×]\s*\d+\s*=?\s*\??\s*$/i,
  /^\s*(hi|hey|hello|thanks|thank you|yo|ok|okay|merhaba|selam)\b/i,
  /^\s*what('?s| is) the (time|date|day)\b/i,
];

const COMPLEX: string[] = [
  "architect", "architecture", "refactor", "redesign", "design a system",
  "prove", "derive", "optimi", "debug", "race condition", "concurren",
  "distributed", "migrate", "migration", "security review", "threat model",
  "root cause", "trade-off", "tradeoff", "why does", "reason about",
  "end-to-end", "multi-file", "across the codebase", "whole repo",
  "mimari", "yeniden yapılandır", "hata ayıkla", "kanıtla",
];

const MEDIUM: string[] = [
  "write", "add", "implement", "fix", "create", "update", "test", "explain",
  "convert", "translate", "summari", "review", "improve",
  "yaz", "açıkla", "özetle", "düzelt", "oluştur", "ekle", "karşılaştır", "çevir",
];

export function kw(t: string, list: string[]): number {
  const low = t.toLowerCase();
  return list.filter((w) => low.includes(w)).length;
}

export function heuristic(prompt: string): Decision {
  const t = prompt.trim();
  const n = t.length;
  const code = /```/.test(t);
  if (SIMPLE.some((r) => r.test(t)) || (n <= 25 && !code)) {
    return { tier: "haiku", effort: "low", conf: 0.92, reason: "short / trivial", src: "heuristic" };
  }
  const cx = kw(t, COMPLEX);
  const md = kw(t, MEDIUM);
  const scope = /\b(entire|whole|all|across|every|complete)\b/i.test(t);
  if (cx >= 1) {
    return { tier: "opus", effort: "high", conf: cx >= 2 || scope || code ? 0.85 : 0.72, reason: "complex signals", src: "heuristic" };
  }
  if (scope && md >= 1) {
    return { tier: "opus", effort: "high", conf: 0.75, reason: "broad scope", src: "heuristic" };
  }
  if (md >= 1 || code) {
    return { tier: "sonnet", effort: md && cx ? "high" : "medium", conf: 0.7, reason: "standard task", src: "heuristic" };
  }
  return { tier: "sonnet", effort: "medium", conf: 0.4, reason: "no strong signal", src: "heuristic" };
}

export function bucketOf(prompt: string): Tier {
  return heuristic(prompt).tier as Tier;
}

// Should we hint that this prompt is "Fable-grade"? (conservative)
export function fableWorthy(p: string): boolean {
  const t = p.trim();
  const n = t.length;
  const hits = kw(t, COMPLEX);
  const scope = /\b(entire|whole|all|across|every|complete)\b/i.test(t);
  return hits >= 5 || (hits >= 4 && (scope || n > 300)) || (hits >= 3 && n > 1500);
}

// --- topic extraction (word-based, honest 80%) ---
const STOP = new Set(
  ("the a an of to in on for and or is are was were be been what which who how why " +
   "when where can could would should do does did you me my your our this that these " +
   "those with about into from as at it its list give show tell write explain make " +
   "please all their them they he she i we").split(" ")
);

export function topicOf(prompt: string): string {
  const raw = prompt || "";
  const proper = raw.match(/\b([A-ZÇĞİÖŞÜ][a-zçğıöşü]+)\b/g);
  if (proper && proper.length) return proper.slice(0, 3).join(" ");
  const words = raw.toLowerCase().replace(/[^a-zçğıöşü0-9\s]/gi, " ")
    .split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  return words.slice(0, 3).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || "General";
}
