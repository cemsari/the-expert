# The Expert — React edition: scope & plan

This document scopes the rewrite of the web edition from a single HTML file into
a proper React app. It exists so the work is planned, not improvised.

---

## Why rewrite at all (the honest case)

The current `web/index.html` is ~60 KB of hand-written HTML/CSS/JS in one file.
It **works** and is feature-rich, but it has hit real ceilings:

- **Maintainability:** every feature makes one giant file harder to touch.
  String-replace edits (how it's currently built) get riskier as it grows.
- **No component reuse:** cards, chips, and the gauge are repeated markup.
- **Hard to add "big" features:** streaming, drag-and-drop layout, and rich
  state all fight the single-file model.
- **No tests:** the terminal has 71 tests; the web app has none, because inline
  code is hard to test.

The routing brain, learning logic, and savings math are all **pure functions**
already — they port to React essentially unchanged. The rewrite is about the
*body*, not the *brain*.

**When NOT to do this:** if the tool stays personal and rarely changes, the
single file is fine. Do the rewrite only if you want to keep adding features or
invite contributors.

---

## Target stack

Matches what you already know from Floth, to minimise new learning:

- **React + Vite** — fast dev, simple build, one-command deploy.
- **TypeScript** — catches the class of bugs that bit us in the single file
  (typos in keys, wrong shapes). Optional but strongly recommended.
- **Tailwind** — keeps styling close to the current look without a CSS file to
  hand-maintain.
- **Zustand** (or React context) for state — light, no boilerplate.
- **localStorage** persistence via a small typed wrapper (with the quota guard
  we just added, built in from day one).
- **Deploy:** Cloudflare Pages (same as Floth). BYOK stays fully client-side.

No backend. Still bring-your-own-key, still everything-in-the-browser.

---

## Proposed structure

```
src/
  brain/
    router.ts         # heuristic + fable_worthy + topicOf (ported, pure)
    learner.ts        # buckets, directives, experiments (ported, pure)
    savings.ts        # cost + baseline math, quips
    models.ts         # MODELS registry (single source of truth)
  api/
    anthropic.ts      # callAnthropic, streaming, error mapping
  store/
    useExpert.ts      # Zustand store: history, profile, ledger, key, config
    storage.ts        # typed localStorage wrapper + quota guard
  components/
    Composer.tsx      # textarea + live gauge + override chips
    Gauge.tsx         # the live verdict gauge
    Message.tsx       # one turn (answer + rating row + CSV button)
    Rating.tsx        # stars + note + directive parsing
    SidePanel/
      BalanceCard.tsx
      SavingsCard.tsx
      NotesCard.tsx
      LearnedCard.tsx
    Onboarding.tsx    # key vs terminal doors
    KeyModal.tsx
  App.tsx
  main.tsx
tests/
  router.test.ts      # port the terminal's routing assertions
  learner.test.ts     # experiments adopt/revert, directives
  savings.test.ts
```

The `brain/` folder is a near-direct port of the terminal's `router_core.py` /
`learner.py` / `tracker.py`, so its logic can be tested the same way — closing
the "web app has no tests" gap.

---

## Phasing (each phase is shippable)

**Phase 1 — parity (the must-do).**
Recreate today's app in React with identical features: routing, live gauge,
ratings, directives, experiments, savings, notes, CSV, resize/reorder, BYOK,
onboarding. Port the brain, wrap in components, add the test suite. Outcome: the
exact same product, now maintainable and tested.

**Phase 2 — the advanced-user features** (the ones that earn attention):
1. **Streaming responses** — token-by-token output via the Anthropic streaming
   API. Biggest perceived-quality jump; advanced users expect it.
2. **Profile export/import** — download/upload your learned preferences as JSON,
   so users aren't locked to one browser.
3. **"Why this model?" panel** — expose the classifier's reasoning (keywords
   that fired, confidence, experiment state). Transparency power users love.
4. **Keyboard shortcuts** — send, new chat, focus, override, rate.
5. **Prompt history / templates** — up-arrow recall, saved reusable prompts.

**Phase 3 — reach (optional, only if going wide):**
- **Optional Supabase sync** for cross-device profiles (still BYOK for the LLM).
- **Shareable routing profiles** — export a tuned profile others can import.
- **PWA** — installable, offline shell.
- **Streaming cost meter** — live token/cost counter during generation.

---

## Honest tradeoffs

- **Cost:** Phase 1 is real work — days, not hours — and produces *no new
  features*, just a better foundation. That's the tax of a rewrite. It pays off
  only across Phase 2+.
- **Risk:** a rewrite can regress features that took many iterations to get
  right (e.g. the clarify-question handling, experiment revert logic). Porting
  the tests first mitigates this — parity is *proven*, not assumed.
- **The single file still wins for one thing:** zero build step. Anyone can open
  it. The React app needs `npm install && npm run build`. Keep the single-file
  edition in the repo as the "just open it" option even after React exists.

---

## Recommended order

1. ✅ Fix the localStorage quota bug — **done** (v2.6, also ported into Phase 1).
2. Phase 1 parity + tests.
3. Phase 2 feature 1 (streaming) — the highest-impact single addition.
4. The rest of Phase 2 by demand.
5. Phase 3 only if the tool goes wide/public.

The single-file `web/index.html` stays the canonical app until the React version
reaches full parity **with tests green** — no cutover before then.
