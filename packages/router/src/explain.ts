// The Expert — routing transparency (Phase 2).
// Turns a routing decision into a plain-English breakdown a user can inspect.
import { Decision, kw, heuristic } from "./router";
import { Profile, MIN_SAMPLES, EXPLORE_TRIAL } from "./learner";
import { modelShort, Tier } from "./models";

export interface ExplainLine { icon: string; text: string; }

const COMPLEX_WORDS = [
  "architect", "architecture", "refactor", "redesign", "prove", "derive",
  "optimi", "debug", "race condition", "concurren", "distributed", "migrate",
  "security review", "threat model", "root cause", "trade-off", "tradeoff",
  "reason about", "end-to-end", "multi-file", "across the codebase",
  "mimari", "yeniden yapılandır", "hata ayıkla", "kanıtla",
];
const MEDIUM_WORDS = [
  "write", "add", "implement", "fix", "create", "update", "test", "explain",
  "convert", "translate", "summari", "review", "improve",
  "yaz", "açıkla", "özetle", "düzelt", "oluştur", "ekle",
];

/** Which trigger words actually fired, so the user can see the evidence. */
export function matchedWords(prompt: string, list: string[]): string[] {
  const low = prompt.toLowerCase();
  return list.filter((w) => low.includes(w));
}

export function explainDecision(prompt: string, d: Decision, profile: Profile, bucket: Tier): ExplainLine[] {
  const lines: ExplainLine[] = [];
  const base = heuristic(prompt);
  const n = prompt.trim().length;

  // 1. what the classifier saw
  const cx = matchedWords(prompt, COMPLEX_WORDS);
  const md = matchedWords(prompt, MEDIUM_WORDS);
  const scope = /\b(entire|whole|all|across|every|complete)\b/i.test(prompt);
  const code = /```/.test(prompt);

  lines.push({ icon: "📏", text: `Message length: ${n} characters${n <= 25 ? " — short enough to look trivial" : ""}` });
  if (cx.length) lines.push({ icon: "🔬", text: `Complexity words found: ${cx.slice(0, 4).map((w) => `“${w}”`).join(", ")}${cx.length > 4 ? ` +${cx.length - 4} more` : ""}` });
  if (md.length && !cx.length) lines.push({ icon: "🔧", text: `Task words found: ${md.slice(0, 4).map((w) => `“${w}”`).join(", ")}` });
  if (scope) lines.push({ icon: "🌐", text: "Broad-scope wording (“entire/whole/all…”) — suggests a bigger job" });
  if (code) lines.push({ icon: "💻", text: "Contains a code block" });
  if (!cx.length && !md.length && !scope && n > 25)
    lines.push({ icon: "🤷", text: "No strong signals either way — defaulting to the middle tier" });

  // 2. the baseline verdict
  lines.push({
    icon: "⚖️",
    text: `Classifier's verdict: ${modelShort(base.tier)} at ${base.effort} effort (confidence ${Math.round(base.conf * 100)}%)`,
  });

  // 3. what learning did to it
  switch (d.src) {
    case "directed": {
      const dr = profile.directives[bucket];
      lines.push({ icon: "🧭", text: `Your standing rule overrides this: “${dr?.comment ?? ""}”` });
      break;
    }
    case "learned": {
      const s = profile.buckets[bucket]?.[d.tier];
      lines.push({
        icon: "🎓",
        text: s
          ? `You've rated ${modelShort(d.tier)} highest for this kind of question (${Math.round((100 * s.sat) / s.n)}% happy over ${s.n} ratings, min ${MIN_SAMPLES} needed)`
          : `Switched to ${modelShort(d.tier)} based on your past ratings`,
      });
      break;
    }
    case "experiment": {
      const e = profile.experiments[bucket];
      lines.push({
        icon: "🧪",
        text: e
          ? `Experiment running: your ratings here averaged ~${e.baseline.toFixed(1)}/5, so I'm testing ${modelShort(e.trial)} for ${EXPLORE_TRIAL} turns (${e.seen} done). I'll keep it only if your ratings actually improve.`
          : "Experiment in progress",
      });
      break;
    }
    case "override":
      lines.push({ icon: "👤", text: "You chose this model and effort yourself — no routing applied." });
      break;
    case "haiku":
      lines.push({ icon: "🤖", text: "The prompt was ambiguous, so a fast classifier call made the call." });
      break;
    case "continuation":
      lines.push({ icon: "🔗", text: "This is a reply to my own question, so I stayed on the same model to keep context." });
      break;
    default:
      lines.push({ icon: "✅", text: "No learning applied yet — this is the classifier's own call." });
  }

  // 4. the cost consequence
  lines.push({
    icon: "💷",
    text: d.tier === "opus" || d.tier === "fable"
      ? "This is a top-tier model — no savings on this turn, by design."
      : `Cheaper than routing everything to Opus — the saving shows in the panel.`,
  });

  return lines;
}
