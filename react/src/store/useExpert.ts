// The Expert — central state store (Zustand). Persists to localStorage.
import { create } from "zustand";
import { AnyTier, Effort } from "../brain/models";
import { Profile, emptyProfile, decide, recordRating } from "../brain/learner";
import { savingsForTurn, quip } from "../brain/savings";
import { topicOf } from "../brain/router";
import { streamAnthropic, classifyWithHaiku, friendlyError, ChatMessage } from "../api/anthropic";
import { exportProfile, importProfile, describeProfile } from "../brain/profileIO";
import { Template, pushHistory, starterTemplates, addTemplate, removeTemplate, makeTemplate } from "../brain/prompts";
import { loadLS, saveLS, removeLS } from "./storage";

let abortRef: AbortController | null = null;

const LS = { key: "expert_key", profile: "expert_profile", ledger: "expert_ledger", history: "expert_history", prompts: "expert_prompts", templates: "expert_templates", budget: "expert_budget" };

export interface LedgerRow {
  prompt: string; bucket: string; tier: AnyTier; effort: Effort;
  cost: number; baseline: number; saved: number; rating: number | null; ts: number;
}
export interface Turn {
  id: string; prompt: string; tier: AnyTier; effort: Effort;
  reason: string; src: string; answer: string; quip?: string;
  askedBack?: boolean; error?: string; pending?: boolean; streaming?: boolean;
}

interface ExpertState {
  apiKey: string;
  profile: Profile;
  ledger: LedgerRow[];
  turns: Turn[];
  history: ChatMessage[];
  promptHistory: string[];
  templates: Template[];
  budget: { start: number; spendAtSet: number; ts: number } | null;
  storageWarning: boolean;

  setKey: (k: string) => void;
  disconnectKey: () => void;
  send: (prompt: string, override?: { tier: AnyTier; effort: Effort } | null) => Promise<void>;
  rate: (turnId: string, score: number, comment: string) => void;
  newChat: () => void;
  resetAll: () => void;
  stop: () => void;
  saveTemplate: (name: string, body: string) => void;
  setBudget: (start: number) => void;
  deleteTemplate: (id: string) => void;
  exportProfileJson: () => string;
  importProfileJson: (json: string) => { ok: boolean; error?: string; summary?: string };
}

export const useExpert = create<ExpertState>((set, get) => ({
  apiKey: localStorage.getItem(LS.key) || "",
  profile: loadLS<Profile>(LS.profile, emptyProfile()),
  ledger: loadLS<LedgerRow[]>(LS.ledger, []),
  turns: [],
  history: loadLS<ChatMessage[]>(LS.history, []),
  promptHistory: loadLS<string[]>(LS.prompts, []),
  templates: loadLS<Template[]>(LS.templates, starterTemplates()),
  budget: loadLS<{ start: number; spendAtSet: number; ts: number } | null>(LS.budget, null),
  storageWarning: false,

  setKey: (k) => { localStorage.setItem(LS.key, k); set({ apiKey: k }); },
  disconnectKey: () => { removeLS(LS.key); set({ apiKey: "" }); },

  send: async (prompt, override) => {
    const { apiKey, profile, history } = get();
    if (!apiKey) return;

    let { d, bucket } = decide(prompt, profile);
    // Ambiguous + no override -> ask Haiku for a second opinion (fail-open).
    if (!override && d.src === "heuristic" && d.conf < 0.6) {
      const hk = await classifyWithHaiku(apiKey, prompt);
      if (hk) d = { ...d, tier: hk.tier, effort: hk.effort, conf: 0.8, src: "haiku", reason: "classifier call" };
    }
    if (override) d = { ...d, tier: override.tier, effort: override.effort, src: "override", reason: "you chose it" };

    const ph = pushHistory(get().promptHistory, prompt);
    saveLS(LS.prompts, ph, () => set({ storageWarning: true }));
    set({ promptHistory: ph });

    const id = "t" + Date.now();
    const turn: Turn = { id, prompt, tier: d.tier, effort: d.effort, reason: d.reason, src: d.src, answer: "", pending: true };
    set((s) => ({ turns: [...s.turns, turn] }));

    const ctrl = new AbortController();
    abortRef = ctrl;
    try {
      const res = await streamAnthropic(
        apiKey, d.tier, d.effort, history, prompt,
        (chunk) => {
          set((s) => ({
            turns: s.turns.map((t) => t.id === id
              ? { ...t, answer: t.answer + chunk, pending: false, streaming: true }
              : t),
          }));
        },
        ctrl.signal
      );
      const { cost, baseline, saved } = savingsForTurn({ tier: d.tier, tokensIn: res.tokensIn, tokensOut: res.tokensOut });
      const prevTotal = get().ledger.reduce((a, r) => a + (r.saved || 0), 0);
      const row: LedgerRow = { prompt, bucket, tier: d.tier, effort: d.effort, cost, baseline, saved, rating: null, ts: Date.now() };
      const q = "💸 " + quip({ saved, tier: d.tier, baseline }, prevTotal + saved, prevTotal);
      const askedBack = looksLikeQuestion(res.text);

      const newHistory: ChatMessage[] = [...history, { role: "user", content: prompt }, { role: "assistant", content: res.text }];
      const ok1 = saveLS(LS.ledger, [...get().ledger, row], () => set({ storageWarning: true }));
      saveLS(LS.history, newHistory, () => set({ storageWarning: true }));

      set((s) => ({
        ledger: ok1 ? [...s.ledger, row] : s.ledger,
        history: newHistory,
        turns: s.turns.map((t) => t.id === id
          ? { ...t, answer: res.text, quip: q, askedBack, pending: false, streaming: false }
          : t),
      }));
    } catch (e) {
      const msg = friendlyError(e as Error);
      set((s) => ({ turns: s.turns.map((t) => t.id === id ? { ...t, error: msg, pending: false, streaming: false } : t) }));
    } finally {
      abortRef = null;
    }
  },

  rate: (turnId, score, comment) => {
    const { turns, profile } = get();
    const turn = turns.find((t) => t.id === turnId);
    if (!turn) return;
    const topic = topicOf(turn.prompt);
    recordRating(profile, turn.tier as any, turn.tier, turn.effort, score || 3, comment, { msgId: turnId, topic });
    // stamp rating onto the matching ledger row
    const ledger = [...get().ledger];
    for (let i = ledger.length - 1; i >= 0; i--) {
      if (ledger[i].prompt === turn.prompt && ledger[i].rating == null) { ledger[i].rating = score || 3; break; }
    }
    saveLS(LS.profile, profile, () => set({ storageWarning: true }));
    saveLS(LS.ledger, ledger, () => set({ storageWarning: true }));
    set({ profile: { ...profile }, ledger });
  },

  stop: () => { abortRef?.abort(); abortRef = null; },

  setBudget: (start) => {
    const spendAtSet = get().ledger.reduce((a, r) => a + (r.cost || 0), 0);
    const b = { start, spendAtSet, ts: Date.now() };
    saveLS(LS.budget, b, () => set({ storageWarning: true }));
    set({ budget: b });
  },

  saveTemplate: (name, body) => {
    const list = addTemplate(get().templates, makeTemplate(name, body));
    saveLS(LS.templates, list, () => set({ storageWarning: true }));
    set({ templates: list });
  },

  deleteTemplate: (id) => {
    const list = removeTemplate(get().templates, id);
    saveLS(LS.templates, list, () => set({ storageWarning: true }));
    set({ templates: list });
  },

  exportProfileJson: () => exportProfile(get().profile),

  importProfileJson: (json) => {
    const res = importProfile(json);
    if (!res.ok || !res.profile) return { ok: false, error: res.error };
    saveLS(LS.profile, res.profile, () => set({ storageWarning: true }));
    set({ profile: res.profile });
    return { ok: true, summary: describeProfile(res.profile) };
  },

  newChat: () => { removeLS(LS.history); set({ history: [], turns: [] }); },

  resetAll: () => {
    removeLS(LS.profile); removeLS(LS.ledger); removeLS(LS.history); removeLS(LS.prompts);
    set({ profile: emptyProfile(), ledger: [], turns: [], history: [], promptHistory: [] });
  },
}));

// clarify-question detector (ported)
export function looksLikeQuestion(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  const tail = t.slice(-200).toLowerCase();
  const endsQ = t.trimEnd().endsWith("?") || tail.includes("?");
  const asks = ["could you clarify", "did you mean", "which ", "do you want", "can you confirm",
    "would you like", "should i", "let me know", "a few options", "to confirm", "clarify",
    "approve", "approval", "please confirm", "shall i", "want me to",
    "hangi", "ister misin", "edeyim mi", "onayl", "misin", "mısın"].some((p) => tail.includes(p));
  return endsQ && (asks || t.length < 400);
}
