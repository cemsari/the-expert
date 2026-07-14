// The Expert — central state store (Zustand). Persists to localStorage.
import { create } from "zustand";
import { AnyTier, Effort } from "../brain/models";
import { Profile, emptyProfile, decide, recordRating } from "../brain/learner";
import { savingsForTurn, quip } from "../brain/savings";
import { topicOf } from "../brain/router";
import { callAnthropic, friendlyError, ChatMessage } from "../api/anthropic";
import { loadLS, saveLS, removeLS } from "./storage";

const LS = { key: "expert_key", profile: "expert_profile", ledger: "expert_ledger", history: "expert_history" };

export interface LedgerRow {
  prompt: string; bucket: string; tier: AnyTier; effort: Effort;
  cost: number; baseline: number; saved: number; rating: number | null; ts: number;
}
export interface Turn {
  id: string; prompt: string; tier: AnyTier; effort: Effort;
  reason: string; src: string; answer: string; quip?: string;
  askedBack?: boolean; error?: string; pending?: boolean;
}

interface ExpertState {
  apiKey: string;
  profile: Profile;
  ledger: LedgerRow[];
  turns: Turn[];
  history: ChatMessage[];
  storageWarning: boolean;

  setKey: (k: string) => void;
  disconnectKey: () => void;
  send: (prompt: string, override?: { tier: AnyTier; effort: Effort } | null) => Promise<void>;
  rate: (turnId: string, score: number, comment: string) => void;
  newChat: () => void;
  resetAll: () => void;
}

export const useExpert = create<ExpertState>((set, get) => ({
  apiKey: localStorage.getItem(LS.key) || "",
  profile: loadLS<Profile>(LS.profile, emptyProfile()),
  ledger: loadLS<LedgerRow[]>(LS.ledger, []),
  turns: [],
  history: loadLS<ChatMessage[]>(LS.history, []),
  storageWarning: false,

  setKey: (k) => { localStorage.setItem(LS.key, k); set({ apiKey: k }); },
  disconnectKey: () => { removeLS(LS.key); set({ apiKey: "" }); },

  send: async (prompt, override) => {
    const { apiKey, profile, history } = get();
    if (!apiKey) return;

    let { d, bucket } = decide(prompt, profile);
    if (override) d = { ...d, tier: override.tier, effort: override.effort, src: "override", reason: "you chose it" };

    const id = "t" + Date.now();
    const turn: Turn = { id, prompt, tier: d.tier, effort: d.effort, reason: d.reason, src: d.src, answer: "", pending: true };
    set((s) => ({ turns: [...s.turns, turn] }));

    try {
      const res = await callAnthropic(apiKey, d.tier, d.effort, history, prompt);
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
          ? { ...t, answer: res.text, quip: q, askedBack, pending: false }
          : t),
      }));
    } catch (e) {
      const msg = friendlyError(e as Error);
      set((s) => ({ turns: s.turns.map((t) => t.id === id ? { ...t, error: msg, pending: false } : t) }));
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

  newChat: () => { removeLS(LS.history); set({ history: [], turns: [] }); },

  resetAll: () => {
    removeLS(LS.profile); removeLS(LS.ledger); removeLS(LS.history);
    set({ profile: emptyProfile(), ledger: [], turns: [], history: [] });
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
