import { describe, it, expect } from "vitest";
import { explainDecision, matchedWords } from "./explain";
import { heuristic } from "./router";
import { emptyProfile, decide, recordRating } from "./learner";

describe("routing transparency", () => {
  it("shows the actual trigger words that fired", () => {
    const p = emptyProfile();
    const prompt = "refactor the entire auth module and debug the race condition";
    const { d, bucket } = decide(prompt, p);
    const lines = explainDecision(prompt, d, p, bucket);
    const text = lines.map((l) => l.text).join(" ");
    expect(text).toMatch(/refactor/);
    expect(text).toMatch(/Complexity words/);
  });

  it("explains broad scope separately", () => {
    const p = emptyProfile();
    const prompt = "review the entire codebase";
    const { d, bucket } = decide(prompt, p);
    const text = explainDecision(prompt, d, p, bucket).map((l) => l.text).join(" ");
    expect(text).toMatch(/Broad-scope/);
  });

  it("admits when there are no signals", () => {
    const p = emptyProfile();
    const prompt = "the cat sat quietly by the window sill this afternoon";
    const { d, bucket } = decide(prompt, p);
    const text = explainDecision(prompt, d, p, bucket).map((l) => l.text).join(" ");
    expect(text).toMatch(/No strong signals/);
  });

  it("always states the classifier's verdict and confidence", () => {
    const p = emptyProfile();
    const text = explainDecision("2+2", heuristic("2+2"), p, "haiku").map((l) => l.text).join(" ");
    expect(text).toMatch(/Classifier's verdict/);
    expect(text).toMatch(/confidence \d+%/);
  });

  it("explains a standing rule when one applies", () => {
    const p = emptyProfile();
    recordRating(p, "sonnet", "sonnet", "medium", 2, "wrong direction, use opus high next time");
    const prompt = "write a function to validate an email";
    const { d, bucket } = decide(prompt, p);
    const text = explainDecision(prompt, d, p, bucket).map((l) => l.text).join(" ");
    expect(text).toMatch(/standing rule/i);
  });

  it("explains a running experiment honestly, including the revert promise", () => {
    const p = emptyProfile();
    for (let i = 0; i < 3; i++) recordRating(p, "sonnet", "sonnet", "medium", 3, "");
    const prompt = "write a function to parse csv";
    const { d, bucket } = decide(prompt, p);
    const text = explainDecision(prompt, d, p, bucket).map((l) => l.text).join(" ");
    expect(text).toMatch(/Experiment running/);
    expect(text).toMatch(/only if your ratings actually improve/);
  });

  it("says top-tier turns save nothing, by design", () => {
    const p = emptyProfile();
    const prompt = "architect a distributed system and reason about trade-offs";
    const { d, bucket } = decide(prompt, p);
    const text = explainDecision(prompt, d, p, bucket).map((l) => l.text).join(" ");
    expect(text).toMatch(/no savings on this turn/i);
  });
});

describe("matchedWords", () => {
  it("returns only words present", () => {
    expect(matchedWords("please refactor this", ["refactor", "debug"])).toEqual(["refactor"]);
  });
});
