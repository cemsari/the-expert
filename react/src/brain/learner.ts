// The Expert — learning brain (pure). Ported from learner.py / web edition.
// Buckets by difficulty, applies directives > learned-best > experiments.
import { Tier, Effort, AnyTier, TIER_ORDER, DEFAULT_EFFORT, MODELS } from "./models";
import { Decision, heuristic, bucketOf } from "./router";

export const MIN_SAMPLES = 3;
export const TARGET_SAT = 0.75; // aim for 4/5
export const EXPLORE_MIN = 2;
export const EXPLORE_TRIAL = 3;

export interface BucketStat { n: number; sat: number; }
export interface Directive { tier?: AnyTier; effort?: Effort; comment: string; ts: number; msgId?: string; }
export interface Experiment {
  status: "running" | "adopted" | "reverted";
  trial: Tier; from: Tier; baseline: number; seen: number; sat: number;
}
export interface NoteEntry { text: string; bucket: Tier; topic?: string; msgId?: string; ts: number; }

export interface Profile {
  buckets: Record<string, Record<string, BucketStat>>;
  directives: Record<string, Directive>;
  noteLog: NoteEntry[];
  experiments: Record<string, Experiment>;
  effortSat: Record<string, number>;
}

export function emptyProfile(): Profile {
  return { buckets: {}, directives: {}, noteLog: [], experiments: {}, effortSat: {} };
}

// Apply learning to a heuristic decision. Returns a possibly-modified decision.
export function decide(prompt: string, profile: Profile): { d: Decision; bucket: Tier } {
  let d = heuristic(prompt);
  const bucket = d.tier as Tier;  // heuristic only returns core tiers

  // 1. directive wins
  const dr = profile.directives[bucket];
  if (dr && (dr.tier || dr.effort)) {
    if (dr.tier && MODELS[dr.tier]) d = { ...d, tier: dr.tier as Tier };
    if (dr.effort) d = { ...d, effort: dr.effort };
    d.src = "directed";
    d.reason = `your instruction: “${(dr.comment || "").slice(0, 40)}”`;
    return { d, bucket };
  }

  const stats = profile.buckets[bucket] || {};

  // 2. best-rated tier
  const rated = Object.entries(stats).filter(
    ([t, s]) => (TIER_ORDER as string[]).includes(t) && s.n >= MIN_SAMPLES
  );
  if (rated.length) {
    rated.sort((a, b) =>
      b[1].sat / b[1].n - a[1].sat / a[1].n ||
      TIER_ORDER.indexOf(a[0] as Tier) - TIER_ORDER.indexOf(b[0] as Tier)
    );
    const [best, bs] = rated[0];
    if (best !== d.tier && bs.sat / bs.n >= 0.5) {
      d = { ...d, tier: best as Tier, src: "learned",
        reason: `you prefer ${best} here (${fmt(bs.sat)}/${bs.n}👍)` };
      return { d, bucket };
    }
  }

  // 3. running experiment
  const exp = profile.experiments[bucket];
  if (exp && exp.status === "running") {
    d = { ...d, tier: exp.trial, src: "experiment",
      reason: `trying ${exp.trial} to beat ~${exp.baseline.toFixed(1)}/5 (${exp.seen}/${EXPLORE_TRIAL})` };
    return { d, bucket };
  }

  // 4. start an experiment if this bucket is mediocre
  const coreTier = d.tier as Tier;  // unchanged from heuristic at this point
  const own = stats[coreTier];
  if (own && own.n >= EXPLORE_MIN) {
    const rate = own.sat / own.n;
    const idx = TIER_ORDER.indexOf(coreTier);
    if (rate < TARGET_SAT && idx < TIER_ORDER.length - 1) {
      const trial = TIER_ORDER[idx + 1];
      const prior = profile.experiments[bucket];
      if (!(prior && prior.status === "reverted" && prior.trial === trial)) {
        profile.experiments[bucket] = {
          status: "running", trial, from: coreTier,
          baseline: rate * 4 + 1, seen: 0, sat: 0,
        };
        d = { ...d, tier: trial, src: "experiment",
          reason: `~${(rate * 4 + 1).toFixed(1)}/5 on ${coreTier} — trying ${trial} to chase 4+` };
        return { d, bucket };
      }
    }
  }

  return { d, bucket };
}

export function parseDirective(comment: string): { tier?: AnyTier; effort?: Effort } {
  if (!comment) return {};
  const toks = comment.toLowerCase().replace(/,/g, " ").split(/\s+/);
  const tier = toks.find((t) => (t as AnyTier) in MODELS) as AnyTier | undefined;
  const effort = toks.find((t) => ["low", "medium", "high"].includes(t)) as Effort | undefined;
  return { tier, effort };
}

// Record a rating. Returns an optional experiment-conclusion note.
export function recordRating(
  profile: Profile,
  bucket: Tier,
  tier: AnyTier,
  effort: Effort,
  score: number,
  comment: string,
  opts: { msgId?: string; topic?: string } = {}
): string | null {
  const signal = (score - 1) / 4;
  let overridden = false;

  if (comment) {
    const { tier: dt, effort: de } = parseDirective(comment);
    if (dt || de) {
      profile.directives[bucket] = { tier: dt, effort: de, comment, ts: Date.now(), msgId: opts.msgId };
      overridden = true;
    } else {
      profile.noteLog.push({ text: comment, bucket, topic: opts.topic, msgId: opts.msgId, ts: Date.now() });
      profile.noteLog = profile.noteLog.slice(-50);
    }
  }

  const w = overridden ? 2 : 1;
  const b = (profile.buckets[bucket] = profile.buckets[bucket] || {});
  const s = (b[tier] = b[tier] || { n: 0, sat: 0 });
  s.n += w;
  s.sat += w * signal;
  if (signal >= 0.75) profile.effortSat[effort] = (profile.effortSat[effort] || 0) + w;

  // conclude a running experiment
  const exp = profile.experiments[bucket];
  let note: string | null = null;
  if (exp && exp.status === "running" && tier === exp.trial) {
    exp.seen += 1;
    exp.sat += signal;
    if (exp.seen >= EXPLORE_TRIAL) {
      const avg = (exp.sat / exp.seen) * 4 + 1;
      if (avg >= exp.baseline + 0.5) {
        exp.status = "adopted";
        note = `✅ ${exp.trial} lifted these from ~${exp.baseline.toFixed(1)} to ~${avg.toFixed(1)}/5 — keeping it`;
      } else {
        exp.status = "reverted";
        note = `↩️ ${exp.trial} only got ~${avg.toFixed(1)}/5 vs ~${exp.baseline.toFixed(1)} — not worth the cost`;
      }
    }
  }
  return note;
}

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}
