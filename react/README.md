# The Expert — React edition (v2.0)

The full app: a reference implementation of the routing brain, and the nicest
way to *see* it work.

**What this is:** a bring-your-own-key chat app that shows you which model it
picked and why, learns from your ratings, and tracks what routing saved you.

**What this is not:** a Claude.ai competitor. It calls the plain Anthropic API,
so it has **no web search, no file uploads, no artifacts** — for those, use
[claude.ai](https://claude.ai), which is better at chat and included in a
subscription. This app exists to demonstrate and use the *router*.

**If you're building an app rather than chatting,** you probably want
[`the-expert-router`](../packages/router) instead — the same brain as a
zero-dependency library.

## Status: Phase 1 complete (parity foundation)

- **Routing brain, learner, savings math** ported to TypeScript as pure modules
  in `src/brain/` — with **27 tests** proving parity with the terminal edition.
- **React UI** (`src/components/`) recreates the single-file app: live gauge,
  two-dial override, ratings + directives, experiments, savings panel, notes,
  learnings, CSV export, BYOK key modal, question-aware rating.
- **State** via Zustand (`src/store/`), persisted to localStorage with the
  quota guard built in.

## Run it

```bash
cd react
npm install
npm run dev      # start the dev server
npm test         # run the 27 parity tests
npm run build    # production build
```

## What's next

- **Phase 2:** streaming responses, profile export/import, "why this model?"
  panel, keyboard shortcuts, prompt templates.
- **Phase 3:** optional Supabase sync, shareable profiles, PWA.

The single-file `../web/index.html` remains the canonical app until this reaches
full feature parity in the UI.
