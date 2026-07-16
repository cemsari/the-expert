// The Expert — prompt history & templates (Phase 2, final piece).
// Pure logic so it's testable; the UI just calls these.

export interface Template {
  id: string;
  name: string;
  body: string;
  createdAt: number;
}

export const HISTORY_MAX = 50;

/**
 * Add a prompt to history: newest first, de-duplicated (re-asking an old
 * question moves it to the top rather than creating a second entry), capped.
 */
export function pushHistory(history: string[], prompt: string): string[] {
  const p = prompt.trim();
  if (!p) return history;
  const without = history.filter((h) => h !== p);
  return [p, ...without].slice(0, HISTORY_MAX);
}

/** Step through history with the up/down arrows. Returns the new index. */
export function historyStep(len: number, index: number, dir: "up" | "down"): number {
  if (len === 0) return -1;
  if (dir === "up") return Math.min(index + 1, len - 1);
  return Math.max(index - 1, -1); // -1 == back to the live (empty) prompt
}

// --- templates ---

export function makeTemplate(name: string, body: string): Template {
  return {
    id: "tpl_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim() || "Untitled",
    body,
    createdAt: Date.now(),
  };
}

export function addTemplate(list: Template[], t: Template): Template[] {
  return [...list, t];
}

export function removeTemplate(list: Template[], id: string): Template[] {
  return list.filter((t) => t.id !== id);
}

/**
 * Templates may contain {placeholders}. Returns the unique names, in order,
 * so the UI can prompt for them.
 */
export function placeholders(body: string): string[] {
  const found = body.match(/\{([a-zA-Z0-9_ -]{1,40})\}/g) ?? [];
  const names = found.map((f) => f.slice(1, -1).trim());
  return [...new Set(names)];
}

/** Fill {placeholders}; anything not supplied is left visible, not silently blanked. */
export function fillTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{([a-zA-Z0-9_ -]{1,40})\}/g, (whole, name: string) => {
    const key = name.trim();
    const v = values[key];
    return v != null && v !== "" ? v : whole;
  });
}

/** A few sensible starters so the feature isn't an empty box on first use. */
export function starterTemplates(): Template[] {
  return [
    makeTemplate("Explain simply", "Explain {topic} in plain English, with one concrete example. Keep it under 200 words."),
    makeTemplate("Code review", "Review this code for bugs, readability and edge cases. Be specific and show fixes:\n\n```\n{code}\n```"),
    makeTemplate("Compare options", "Compare {option A} and {option B} for {use case}. Give a table of trade-offs, then a clear recommendation with reasoning."),
    makeTemplate("Summarise to actions", "Summarise the following into decisions made, risks, and owner-assigned next actions:\n\n{text}"),
  ];
}
