# 🦥 The Expert — a model & effort router for Claude

The Expert reads each message *before* it's sent, picks the right Claude model
and effort level for the job, tracks how much you save versus always using the
most expensive model, and **learns from your ratings** which model you actually
prefer for each kind of question. Easy questions stay cheap; hard ones get the
big brain.

It comes in two editions that share the same routing brain:

| | 🌐 Web edition | 🖥️ Terminal edition |
|---|---|---|
| **How to run** | Open `web/index.html` in a browser | Run the Python app in a terminal |
| **Billing** | Your own Anthropic API key (BYOK) | Your Claude subscription (via Claude Code sign-in) |
| **Live suggestion as you type** | ✅ | — |
| **Renders tables, CSV export** | ✅ | — |
| **Learning, ratings, savings** | ✅ | ✅ |
| **Runs fully offline of any server** | ✅ (in your browser) | ✅ (on your machine) |

---

## 🌐 Web edition (bring your own key)

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
