# 🦥 The Expert — a model & effort router for Claude

**Most apps send every message to the same Claude model.** A "what's 2+2" costs
the same as "redesign my architecture." The price gap between tiers is 5–25×,
and most questions don't need the expensive one.

The Expert reads each message *before* it's sent, picks the right-sized model
and effort level, learns from your ratings which model you actually prefer for
each kind of question, and keeps honest books on what routing saved you versus
always using the top model.

Its governing rule: **never overspend on faith.** If it wants to try a pricier
model, it must *prove* — from your own ratings — that answers actually improved.
If they don't, it reverts.

---

## 👤 Who this is for

**✅ You're building an application on the Claude API.**
This is the primary audience. You pay per token, at volume, and you have no
routing today. Use the library — [`the-expert-router`](packages/router) — to
route your app's calls and cut spend without cutting quality.

**✅ You want to see the machinery.**
The "why this model?" panel, the savings ledger, the experiment loop. Most tools
hide their routing; this one shows its working.

**✅ You have an API cost problem and no visibility.**
If you don't know how much of your AI spend goes to over-powered answers on
under-powered questions, the ledger answers that in real money.

## 🚫 Who this is *not* for

**❌ You want a better Claude chat app.** Use [Claude](https://claude.ai)
instead — genuinely. It has web search, file uploads, artifacts, and it's
included in a subscription. The chat editions here are **reference
implementations of the router**, not a Claude competitor. They will lose that
comparison and they're not trying to win it.

**❌ You need live/current information.** The web and React editions call the
plain Anthropic API, which has **no web access** — the model answers from
training data and will honestly say so. (The terminal edition *does* have web
search, via the Claude Agent SDK.) Live data is not what this project is about.

**❌ You want free chat.** Bring-your-own-key means you pay per message. If
you're on a Claude subscription, chatting there costs you nothing extra.

---

## 📦 What's in this repo

| | What it is | Who it's for |
|---|---|---|
| **[`packages/router`](packages/router)** | `the-expert-router` — the routing brain as a zero-dependency npm library | **Developers building on the Claude API.** The main event. |
| **[`react/`](react)** | The full app: React + Vite + TypeScript, streaming, profile export, transparency panel | Anyone who wants to *use* the router directly, or see it demonstrated |
| **[`web/`](web)** | The same app as one self-contained HTML file — no build step | Try it with zero install; open the file |
| **[`terminal/`](terminal)** | Python CLI. Runs on your **Claude subscription** (no API key) and **has web search** | Developers who want routing + research, free on an existing plan |

All four share the same routing brain and learning model.

---

## 📦 Use it as a library (recommended)

```bash
npm install the-expert-router
```

```ts
import { Expert } from "the-expert-router";
const expert = new Expert();

const r = expert.route("what is a closure in javascript");
// -> { tier: "sonnet", model: "claude-sonnet-5", effort: "medium", reason: "standard task" }

// ...call Claude with r.model, then:
expert.record(r.id, res.usage.input_tokens, res.usage.output_tokens);
expert.rate(r.id, 5, "perfect, keep using sonnet here");
expert.savings();  // -> { saved: 0.0140, percent: 80, turns: 1 }
```

Full API docs: [`packages/router/README.md`](packages/router/README.md).

## ⚛️ React edition (the full app)

```bash
cd react && npm install && npm run dev
```

Streaming responses, live routing gauge, profile export/import, "why this
model?" transparency, prompt templates. Bring your own Anthropic key — it's
stored only in your browser and sent only to Anthropic.

## 🌐 Single-file edition (zero install)

A single self-contained HTML file. Nothing to install.

1. Open `web/index.html` in a modern browser.
2. Paste your own Anthropic API key when prompted
   (get one at <https://console.anthropic.com/settings/keys>).
   The key is stored **only in your browser** and sent **only to Anthropic**.
3. Start typing — watch the gauge suggest a model before you send.

**What it does:** live model+effort suggestion as you type, one- to five-star
ratings with free-text notes that become standing rules, self-improving
experiments that chase a higher rating only when a stronger model earns it,
a running savings estimate vs. always-Opus, a local API-balance meter, CSV
export for any table, and a panel of everything it has learned about you — all
stored locally in your browser.

## 🖥️ Terminal edition (free with a Claude subscription)

Runs on your Claude Code sign-in, so it uses your subscription rather than an
API key.

```bash
cd terminal
python3 expert.py
```

Or double-click `terminal/install.command` on macOS.

Type `help` inside the app for the full command list (`stats`, `suggest`,
`redo`, `new`, `config`, `reset`).

---

## How the routing works

1. A fast local classifier reads your prompt and buckets it as easy / medium /
   hard, mapping to Haiku / Sonnet / Opus (Fable is available as a manual
   escalation).
2. You can accept the suggestion or override the model and effort.
3. After the answer, you rate it. Ratings teach a per-topic profile; notes that
   mention a model (e.g. *"use opus high next time"*) become standing rules.
4. When a kind of question keeps scoring mediocre, The Expert runs a small
   experiment on the next tier up — and keeps the upgrade **only if your
   ratings actually improve**, otherwise it reverts to the cheaper model.

## Privacy

- Neither edition sends your data to any server run by this project.
- The web edition keeps your key and learning data in `localStorage`.
- The terminal edition keeps learning data in `~/.claude/the-expert/`
  (gitignored; never committed).

See [SECURITY.md](SECURITY.md) for reporting issues and the full data policy.

## Model versions

The model lineup changes often. This project pins current model IDs; when
Anthropic ships or retires a model, update the IDs in
`web/index.html` (the `MODELS` map) and `terminal/tracker.py` (the `PRICES`
map). The terminal edition routes by alias where possible, so it tends to pick
up new versions automatically.

## License

MIT — see [LICENSE](LICENSE).
