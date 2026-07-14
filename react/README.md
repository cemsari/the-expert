# The Expert — React edition (v2.0, in progress)

The Phase 1 rewrite of the web edition into a maintainable, tested React app.
See `../REACT_SCOPE.md` for the full plan.

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
