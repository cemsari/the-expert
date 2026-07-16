/**
 * @the-expert/router — pick the right Claude model for each message.
 *
 * A dependency-free routing brain: classify a prompt, choose a model and effort
 * level, learn from ratings, and account honestly for what you saved.
 *
 * Quick start:
 *
 *   import { Expert } from "@the-expert/router";
 *
 *   const expert = new Expert();
 *   const { tier, effort, reason } = expert.route("what is 2+2");
 *   // -> { tier: "haiku", effort: "low", reason: "short / trivial" }
 *
 *   // ...call the Anthropic API with that model, then teach it:
 *   expert.rate(id, 5, "perfect, keep using haiku here");
 */

import { Tier, AnyTier, Effort, MODELS, TIER_ORDER, DEFAULT_EFFORT, modelName, modelShort } from "./models";
import { Decision, heuristic, bucketOf, fableWorthy, topicOf, kw } from "./router";
import {
  Profile, emptyProfile, decide, recordRating, parseDirective,
  MIN_SAMPLES, TARGET_SAT, EXPLORE_MIN, EXPLORE_TRIAL,
} from "./learner";
import { turnCost, opusBaseline, savingsForTurn, quip, TurnCost } from "./savings";
import { explainDecision, ExplainLine } from "./explain";
import { exportProfile, importProfile, describeProfile, ProfileFile } from "./profileIO";

// --- low-level exports: use these if you want the pieces ---
export {
  // models
  MODELS, TIER_ORDER, DEFAULT_EFFORT, modelName, modelShort,
  // routing
  heuristic, bucketOf, fableWorthy, topicOf, kw,
  // learning
  emptyProfile, decide, recordRating, parseDirective,
  MIN_SAMPLES, TARGET_SAT, EXPLORE_MIN, EXPLORE_TRIAL,
  // savings
  turnCost, opusBaseline, savingsForTurn, quip,
  // transparency
  explainDecision,
  // portability
  exportProfile, importProfile, describeProfile,
};
export type { Tier, AnyTier, Effort, Decision, Profile, TurnCost, ExplainLine, ProfileFile };

export interface RouteResult extends Decision {
  /** The difficulty bucket this prompt was filed under. */
  bucket: Tier;
  /** The concrete Anthropic model id to call, e.g. "claude-haiku-4-5-20251001". */
  model: string;
  /** An id to pass back to rate() after the user judges the answer. */
  id: string;
}

export interface TurnRecord {
  id: string;
  prompt: string;
  bucket: Tier;
  tier: AnyTier;
  effort: Effort;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  baseline: number;
  saved: number;
  rating: number | null;
  ts: number;
}

/**
 * The high-level API. Holds a learning profile and a ledger, so you can route,
 * record, rate, and ask what you saved — without wiring the pieces yourself.
 */
export class Expert {
  profile: Profile;
  ledger: TurnRecord[];
  private pending = new Map<string, { prompt: string; bucket: Tier; tier: AnyTier; effort: Effort }>();

  constructor(opts: { profile?: Profile; ledger?: TurnRecord[] } = {}) {
    this.profile = opts.profile ?? emptyProfile();
    this.ledger = opts.ledger ?? [];
  }

  /** Decide which model and effort should answer this prompt. */
  route(prompt: string): RouteResult {
    const { d, bucket } = decide(prompt, this.profile);
    const id = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.pending.set(id, { prompt, bucket, tier: d.tier, effort: d.effort });
    return { ...d, bucket, model: MODELS[d.tier].id, id };
  }

  /** Explain a routing decision in plain English (for a "why?" UI or logs). */
  explain(prompt: string): ExplainLine[] {
    const { d, bucket } = decide(prompt, this.profile);
    return explainDecision(prompt, d, this.profile, bucket);
  }

  /**
   * Record what a turn actually cost, once you have token counts back from the
   * API. Returns the ledger row, including what you saved vs always-Opus.
   */
  record(id: string, tokensIn: number, tokensOut: number): TurnRecord | null {
    const p = this.pending.get(id);
    if (!p) return null;
    const { cost, baseline, saved } = savingsForTurn({ tier: p.tier, tokensIn, tokensOut });
    const row: TurnRecord = {
      id, prompt: p.prompt, bucket: p.bucket, tier: p.tier, effort: p.effort,
      tokensIn, tokensOut, cost, baseline, saved, rating: null, ts: Date.now(),
    };
    this.ledger.push(row);
    return row;
  }

  /**
   * Teach it. `score` is 1-5 (3 is neutral). An optional comment naming a model
   * or effort ("use opus high next time") becomes a standing rule.
   * Returns an experiment-conclusion note if one fired.
   */
  rate(id: string, score: number, comment = ""): string | null {
    const p = this.pending.get(id);
    if (!p) return null;
    const note = recordRating(this.profile, p.bucket, p.tier, p.effort, score, comment, {
      msgId: id, topic: topicOf(p.prompt),
    });
    const row = this.ledger.find((r) => r.id === id);
    if (row) row.rating = score;
    this.pending.delete(id);
    return note;
  }

  /** Lifetime savings vs routing everything to Opus. */
  savings(): { saved: number; spent: number; baseline: number; percent: number; turns: number } {
    const saved = this.ledger.reduce((a, r) => a + r.saved, 0);
    const spent = this.ledger.reduce((a, r) => a + r.cost, 0);
    const baseline = this.ledger.reduce((a, r) => a + r.baseline, 0);
    return {
      saved, spent, baseline,
      percent: baseline ? Math.round((100 * saved) / baseline) : 0,
      turns: this.ledger.length,
    };
  }

  /** Everything it has learned, as plain sentences. */
  lessons(): string[] {
    const out: string[] = [];
    const label: Record<string, string> = { haiku: "easy questions", sonnet: "medium questions", opus: "hard questions" };
    for (const [b, tiers] of Object.entries(this.profile.buckets)) {
      const rated = Object.entries(tiers).filter(([, s]) => s.n >= MIN_SAMPLES)
        .sort((a, c) => c[1].sat / c[1].n - a[1].sat / a[1].n);
      if (rated.length) {
        const [best, s] = rated[0];
        out.push(`For ${label[b] ?? b}: use ${modelShort(best as AnyTier)} (liked ${Math.round((100 * s.sat) / s.n)}% of ${s.n})`);
      }
    }
    for (const [b, dr] of Object.entries(this.profile.directives)) {
      out.push(`Your rule for ${label[b] ?? b}: ${[dr.tier, dr.effort].filter(Boolean).join("/")}`);
    }
    for (const [b, e] of Object.entries(this.profile.experiments)) {
      if (e.status === "running") out.push(`Testing ${modelShort(e.trial)} on ${label[b] ?? b} (${e.seen}/${EXPLORE_TRIAL})`);
    }
    return out;
  }

  /** Serialise the learned profile (portable across devices). */
  export(): string { return exportProfile(this.profile); }

  /** Load a previously exported profile. Refuses foreign or corrupt files. */
  import(json: string): { ok: boolean; error?: string; summary?: string } {
    const res = importProfile(json);
    if (!res.ok || !res.profile) return { ok: false, error: res.error };
    this.profile = res.profile;
    return { ok: true, summary: describeProfile(res.profile) };
  }
}
