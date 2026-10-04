# the-expert-router

**Pick the right Claude model for each message — and prove what you saved.**

Most apps built on Claude send every message to the same model. A "what's 2+2"
costs the same as "redesign my architecture." The price gap between tiers is
5–25×, and most questions don't need the expensive one.

This library reads each prompt *before* you send it, picks the right-sized model
and effort level, learns from your users' ratings, and keeps honest books on
what routing saved you versus always using the top model.

Zero dependencies. Framework-free. Works in Node and the browser.

```bash
npm install the-expert-router
```

---

## Who this is for

**✅ You call the Claude API from your own code** — a chatbot, an agent, a
support tool, a pipeline — and every request currently hardcodes one model.

**✅ Your token bill is growing** and you suspect much of it is over-powered
answers to under-powered questions, but you have no way to prove it.

**✅ You want routing you can inspect and defend** — not a black box that
silently picks for you.

## Who this is *not* for

**❌ You just want to chat with Claude.** Use [claude.ai](https://claude.ai) —
it's better at that and it's included in a subscription. This library doesn't
help you.

**❌ You want a proxy or a hosted service.** This is a local decision function.
It makes no network calls, holds no keys, and never sees your traffic. You call
Claude; it just tells you *which* Claude.

**❌ You need routing across providers** (OpenAI, Gemini, local models). This is
Claude-specific by design — it knows Claude's tiers, prices and effort model.
For cross-provider routing, look at OpenRouter or LiteLLM.

---

## Why this and not something else

Honest positioning, because you'll ask anyway:

**vs. hardcoding one model** — the status quo in most codebases. You're paying
Opus rates for "summarise this line." Routing is the only optimisation that cuts
cost *without* cutting quality, because it only ever down-shifts on questions
that don't need the power.

**vs. writing your own if/else** — you can, and for ten prompt types you
probably should. This becomes worth it when you want the parts that are tedious
to build: a learning loop that adapts to *your users'* ratings, experiments that
justify their own cost before adopting a pricier model, honest savings
accounting against a real baseline, and an explanation of every decision.

**vs. OpenRouter / LiteLLM** — those are *gateways*: they proxy your traffic and
route across providers. Different job, different trust model. This is a
**local decision function** — zero dependencies, no network, no proxy, your keys
never leave your process. Use them together if you like: ask The Expert *which*
Claude, then send it wherever you send it.

**vs. "just use the cheap model"** — fine until a hard question lands on it. The
point isn't cheapness; it's *fit*.

**The honest catch:** routing is a heuristic. It reads keywords, length and
scope — it does not understand your prompt semantically. It will misroute
sometimes. That's precisely why ratings, experiments and manual overrides exist,
and why every decision is explainable rather than asserted.

---

## 60-second start

```ts
import { Expert } from "the-expert-router";
import Anthropic from "@anthropic-ai/sdk";

const expert = new Expert();
const claude = new Anthropic();

// 1. Route the prompt
const r = expert.route("what is a closure in javascript");
// -> { tier: "sonnet", effort: "medium", model: "claude-sonnet-5", reason: "standard task", id: "t..." }

// 2. Call Claude with the chosen model
const res = await claude.messages.create({
  model: r.model,
  max_tokens: 2048,
  messages: [{ role: "user", content: prompt }],
});

// 3. Record what it actually cost
expert.record(r.id, res.usage.input_tokens, res.usage.output_tokens);

// 4. Teach it from your user's feedback (1–5)
expert.rate(r.id, 5, "perfect, keep using sonnet here");

// 5. Ask what routing saved you
expert.savings();
// -> { saved: 0.0140, spent: 0.0035, percent: 80, turns: 1 }
```

---

## Why it's different

**It never overspends on faith.** If a kind of question keeps scoring mediocre,
The Expert runs a controlled experiment: it tries the next model up for a few
turns and **keeps the upgrade only if ratings actually improve**. If they don't,
it reverts and remembers not to waste money there again.

**It explains itself.** Every decision can be unpacked into plain English —
which trigger words fired, the confidence, what learning changed and why.

```ts
expert.explain("refactor the entire auth module and debug the race condition");
// [
//   { icon: "📏", text: "Message length: 58 characters" },
//   { icon: "🔬", text: "Complexity words found: “refactor”, “debug”, “race condition”" },
//   { icon: "🌐", text: "Broad-scope wording (“entire/whole/all…”) — suggests a bigger job" },
//   { icon: "⚖️", text: "Classifier's verdict: Opus 4.8 at high effort (confidence 85%)" },
//   ...
// ]
```

**Its accounting is honest.** Savings are measured against a real baseline —
the same tokens priced at Opus rates — and labelled as estimates, because the
top model might have produced a different number of tokens.

---

## API

### `new Expert(opts?)`
```ts
new Expert();                                   // fresh
new Expert({ profile, ledger });                // rehydrate from storage
```

### `route(prompt) → RouteResult`
Returns `{ tier, effort, model, reason, src, conf, bucket, id }`.
`model` is the concrete Anthropic model id. Keep the `id` to `record()` and
`rate()` the turn later.

`src` tells you *why*: `heuristic` · `learned` · `experiment` · `directed`.

### `record(id, tokensIn, tokensOut) → TurnRecord`
Logs actual cost, the always-Opus baseline, and the saving.

### `rate(id, score, comment?) → string | null`
`score` is 1–5 (3 is neutral). A comment naming a model or effort — *"use opus
high next time"* — becomes a standing rule that outranks learned behaviour.
Returns an experiment-conclusion note when one fires.

### `savings() → { saved, spent, baseline, percent, turns }`
### `lessons() → string[]`
### `explain(prompt) → ExplainLine[]`
### `export() → string` / `import(json) → { ok, error?, summary? }`
Portable profiles. Import is strict: it validates format and version and refuses
foreign or corrupt files rather than silently overwriting learning.

### Persistence
The library holds no storage opinion — persist `expert.profile` and
`expert.ledger` wherever you like (localStorage, a database, a file):

```ts
localStorage.setItem("profile", JSON.stringify(expert.profile));
const expert = new Expert({ profile: JSON.parse(saved) });
```

---

## Lower-level pieces

If you want the parts rather than the class:

```ts
import { heuristic, decide, savingsForTurn, explainDecision, MODELS } from "the-expert-router";
```

`heuristic(prompt)` — pure classification, no learning.
`decide(prompt, profile)` — classification + learning.
`savingsForTurn({ tier, tokensIn, tokensOut })` — cost maths.
`MODELS` — the model registry (ids, prices, versions). Update here when
Anthropic ships or retires a model.

---

## How routing works

1. A fast local classifier reads the prompt: length, complexity keywords
   (English and Turkish), scope words, code blocks.
2. Trivial → Haiku. Standard work → Sonnet. Architecture, debugging, deep
   reasoning → Opus. Fable is never auto-routed (it's 2× Opus) but can be
   chosen manually.
3. Learning overrides the classifier once there's evidence: standing rules
   first, then your best-rated model for that kind of question, then
   experiments.

No network calls, no API key needed for routing itself — it's local logic.

## License

MIT © Cem Sari · [github.com/cemsari/the-expert](https://github.com/cemsari/the-expert)
