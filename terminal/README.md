# THE EXPERT — Claude model & effort router

*It reads each message before it is sent and picks the right Claude model and effort level — then proves the savings.*

A hybrid **model router** for Claude Code. It reads each prompt you submit,
classifies how much model capability it needs, and recommends a tier
(**Haiku / Sonnet / Opus**) and effort level — so trivial prompts don't burn
Opus tokens and hard problems don't get under-served.

## The honest constraint (read this first)

The original idea was "read the prompt, silently switch the model for this
turn." As of now, **Claude Code's `UserPromptSubmit` hook cannot set the model
for the turn it fires on.** Its documented powers are: inject context, block
the prompt, or log. Model selection is not one of its outputs.

So this tool is **advisory**: it classifies the prompt and injects a one-line
recommendation that Claude sees (e.g. *"Suggested tier: haiku"*), and logs
every decision so you can measure the routing. It does **not** silently
retarget the live model, because that capability isn't exposed and pretending
otherwise would ship something that doesn't work.

The routing *brain* (`router_core.route`) is identical to what a true
auto-router would use. See "Upgrade path" for how it becomes a real
auto-switcher with one changed step.

## Architecture

```
prompt ─► route_prompt.py (hook wrapper)
              │  reads stdin JSON, logs, emits advice
              ▼
         router_core.route(prompt)          ◄── the testable "brain"
              │
      ┌───────┴────────┐
      ▼                ▼
 heuristic_decision   haiku_decision (fallback, only for
 (fast, free)          low-confidence / ambiguous prompts)
```

**Hybrid logic:** cheap heuristics settle the obvious cases for free
(short/arithmetic → Haiku; `architect`/`refactor`/`race condition` → Opus;
normal verbs → Sonnet). Only genuinely ambiguous prompts (heuristic confidence
< 0.6) trigger an optional Haiku classifier call. If Haiku is unavailable or
errors, it degrades gracefully to the heuristic guess. It never blocks you.

## Files

| File | Purpose |
|------|---------|
| `.claude/hooks/router_core.py` | The routing brain. Pure logic, no Claude Code coupling. Unit-testable. |
| `.claude/hooks/route_prompt.py` | The `UserPromptSubmit` hook wrapper. |
| `.claude/settings.json` | Registers the hook. |
| `test_router.py` | Runs the brain over representative prompts (heuristic-only, deterministic). |
| `router_stats.py` | Summarises the log: tier distribution + rough cost-vs-always-Opus. |

## Install

1. Copy the `.claude/` folder into your project root (or merge `settings.json`
   into an existing one).
2. In Claude Code, run `/hooks` to review and accept the new hook (config
   changes are snapshotted at session start for safety).
3. Optional — enable the Haiku fallback: `export ANTHROPIC_API_KEY=...`
4. Submit a prompt. You'll see a `[router]` advisory line in context.

## Config (env vars)

| Var | Effect |
|-----|--------|
| `ROUTER_USE_HAIKU=0` | Heuristic-only; no API call, no cost, fully offline. |
| `ROUTER_SILENT=1` | Log only; don't inject advice into the conversation. |
| `ANTHROPIC_API_KEY` | Needed only when the Haiku fallback is enabled. |

## Measure it

```
python3 router_stats.py
```

Shows the tier split, how often the Haiku fallback fired, and a rough saving
estimate versus always running Opus. Tune the keyword lists and
`confidence_gate` in `router_core.py` from what you see.

## Two versions in this package

### 1. Advisory hook (optional — in `extras/claude-code-advisory-hook/`)
Classifies each prompt and *recommends* a tier. Cannot switch the live model,
because `UserPromptSubmit`'s only outputs are context injection / block / log —
there is no model field on any hook event (confirmed against the hooks
reference). Good for use *inside* an interactive Claude Code session.

### 2. True auto-router (`auto_router.py`) — via the Claude Agent SDK
This one **actually switches the live model per prompt.** The Agent SDK's
`ClaudeSDKClient` exposes `async def set_model(model)`, which changes the model
on a persistent session mid-conversation. The loop is:

```
prompt -> router_core.route() -> client.set_model(tier) -> client.query()
```

Same routing brain as the hook — only the final step changed from "print
advice" to "set the model". That decoupling was the point.

```bash
pip install claude-agent-sdk
export ANTHROPIC_API_KEY=sk-...
python3 auto_router.py --demo     # scripted: watch Haiku->Sonnet->Opus
python3 auto_router.py            # interactive REPL
```

### 3. Personalised agent v2 (`agent.py`) — model + effort per message, savings, humour, learning
The full experience. For every message you type, before it's sent: the brain
routes it, your profile may override it from past ratings, and the message
runs on the chosen **model AND effort level**. Real cost/tokens/time from the
SDK's `ResultMessage` are tracked; savings vs always-Opus are announced with a
rotating quip; a `y/n` rating after each answer teaches your profile.

**Auth, ranked (best first):**

*1. Claude subscription (recommended — £0 extra).* Pro/Max/Team plans include a
monthly Agent SDK credit that covers apps like this. Sign in once via
`claude` (log in with your claude.ai account), make sure NO
`ANTHROPIC_API_KEY` is exported, and just run the agent. Note: the optional
Haiku fallback classifier auto-disables on this path (heuristics only).

*2. API key (no subscription / servers / CI).* Create at
console.anthropic.com with an expiry + spend cap, then
`export ANTHROPIC_API_KEY=sk-ant-...`.

⚠️ **Gotcha:** an exported `ANTHROPIC_API_KEY` silently OVERRIDES your
subscription — a revoked key left in `~/.zshrc` makes everything fail as
"invalid". Run `python3 check_auth.py` to see which credential wins.

```bash
python3 check_auth.py       # which auth will be used?
python3 agent.py            # per-turn engine: model+effort fresh each message
python3 agent.py --fast     # persistent client: live set_model, effort fixed/session
```

REPL commands: `!haiku/!sonnet/!opus <msg>` (force a tier; rated overrides
teach double), `stats` (lifetime savings + lessons), `exit`.

**How per-message effort works:** the SDK has no `set_effort`, but
`ClaudeAgentOptions` has `effort` and `resume` (introspection-verified,
SDK 0.2.113; CLI `--effort <level>` confirmed). The default engine runs each
message as a one-shot `query()` with `resume=<session_id>`, so model and
effort are both chosen fresh per message with conversation context preserved —
at the cost of a CLI spawn per turn. `--fast` trades that: live model switches
on one client, effort fixed per session to your learned preference.

**How learning works (transparent, no black box):** each rated turn records
(prompt-bucket, tier, effort, 👍/👎) in `~/.claude/router_v2/<user>_profile.json`
— a human-readable file. With ≥3 ratings in a bucket, the best-rated tier wins
(ties break cheaper); if the brain's own pick scores <50%, it escalates one
tier. Manual `!tier` overrides that get rated count double. Every learned
override prints its reasoning in plain English.

**Per-user:** everything keys off `$ROUTER_USER` (fallback: OS username) —
separate log, separate profile, separate lessons.

**Verified offline (test_v2.py, 18 checks):** the entire pipeline — routing →
personalization → engine → tracking → quips → feedback → learning — using
real SDK message dataclasses behind a fake engine. **Not verified:** live API
runs (needs your key), and the exact accepted `effort` string values
end-to-end (`low/medium/high` match the documented level names; confirm on
first live run). `PRICES`/`SPEED` in `tracker.py` are configurable estimates —
update to current pricing; actual cost prefers the SDK's reported figure.

## Known limitations

- A text-only classifier can't see how big "this file" is, so "summarise this
  file" routes light. Live context (transcript) would fix this.
- Heuristic keyword lists are English-biased and hand-tuned — treat them as a
  starting point and adjust to your own prompt patterns using the log.
- The Haiku fallback adds latency to ambiguous prompts only (by design).
