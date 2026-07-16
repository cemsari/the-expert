import { describe, it, expect } from "vitest";
import {
  pushHistory, historyStep, makeTemplate, addTemplate, removeTemplate,
  placeholders, fillTemplate, starterTemplates, HISTORY_MAX,
} from "./prompts";

describe("prompt history", () => {
  it("adds newest first", () => {
    const h = pushHistory(pushHistory([], "first"), "second");
    expect(h).toEqual(["second", "first"]);
  });

  it("de-duplicates by moving an old prompt to the top", () => {
    let h = pushHistory([], "a");
    h = pushHistory(h, "b");
    h = pushHistory(h, "a");
    expect(h).toEqual(["a", "b"]);
  });

  it("ignores blank prompts", () => {
    expect(pushHistory(["a"], "   ")).toEqual(["a"]);
  });

  it("caps at HISTORY_MAX", () => {
    let h: string[] = [];
    for (let i = 0; i < HISTORY_MAX + 10; i++) h = pushHistory(h, "p" + i);
    expect(h.length).toBe(HISTORY_MAX);
    expect(h[0]).toBe("p" + (HISTORY_MAX + 9)); // newest kept
  });

  it("steps up through history and back down to the live prompt", () => {
    expect(historyStep(3, -1, "up")).toBe(0);
    expect(historyStep(3, 0, "up")).toBe(1);
    expect(historyStep(3, 2, "up")).toBe(2);   // clamps at the oldest
    expect(historyStep(3, 0, "down")).toBe(-1); // back to live
    expect(historyStep(0, -1, "up")).toBe(-1);  // empty history
  });
});

describe("templates", () => {
  it("creates with a name, body and unique id", () => {
    const a = makeTemplate("Test", "body {x}");
    const b = makeTemplate("Test", "body {x}");
    expect(a.id).not.toBe(b.id);
    expect(a.name).toBe("Test");
  });

  it("names an unnamed template rather than leaving it blank", () => {
    expect(makeTemplate("  ", "body").name).toBe("Untitled");
  });

  it("adds and removes", () => {
    const t = makeTemplate("A", "x");
    const list = addTemplate([], t);
    expect(list).toHaveLength(1);
    expect(removeTemplate(list, t.id)).toHaveLength(0);
  });

  it("finds unique placeholders in order", () => {
    expect(placeholders("Compare {a} and {b} for {a}")).toEqual(["a", "b"]);
  });

  it("fills placeholders", () => {
    expect(fillTemplate("Explain {topic} to {who}", { topic: "closures", who: "a beginner" }))
      .toBe("Explain closures to a beginner");
  });

  it("leaves unfilled placeholders visible rather than silently blanking them", () => {
    expect(fillTemplate("Explain {topic} to {who}", { topic: "closures" }))
      .toBe("Explain closures to {who}");
  });

  it("ships useful starters", () => {
    const s = starterTemplates();
    expect(s.length).toBeGreaterThan(2);
    expect(placeholders(s[0].body).length).toBeGreaterThan(0);
  });
});
