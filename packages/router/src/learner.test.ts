import { describe, it, expect } from "vitest";
import { emptyProfile, decide, recordRating, parseDirective } from "./learner";

describe("directives", () => {
  it("extracts model+effort from a natural comment", () => {
    expect(parseDirective("detailed enough but not the right direction, use opus high next time"))
      .toEqual({ tier: "opus", effort: "high" });
  });
  it("no false directive on a plain note", () => {
    expect(parseDirective("too shallow, go deeper")).toEqual({ tier: undefined, effort: undefined });
  });
  it("a rating+directive becomes a standing rule that outranks routing", () => {
    const p = emptyProfile();
    recordRating(p, "sonnet", "sonnet", "medium", 2, "wrong direction, use opus high next time");
    expect(p.directives["sonnet"]?.tier).toBe("opus");
    const { d } = decide("write a function to validate an email address", p);
    expect(d.tier).toBe("opus");
    expect(d.src).toBe("directed");
  });
});

describe("experiments — chase 4+, adopt or revert", () => {
  it("a mediocre bucket triggers an experiment to the next tier", () => {
    const p = emptyProfile();
    recordRating(p, "sonnet", "sonnet", "medium", 3, "");
    recordRating(p, "sonnet", "sonnet", "medium", 3, "");
    recordRating(p, "sonnet", "sonnet", "medium", 3, "");
    const { d } = decide("write a function to parse csv", p);
    expect(d.src).toBe("experiment");
    expect(d.tier).toBe("opus");
  });

  it("a winning experiment is adopted", () => {
    const p = emptyProfile();
    for (let i = 0; i < 3; i++) recordRating(p, "sonnet", "sonnet", "medium", 3, "");
    decide("write a function to parse csv", p); // starts experiment -> opus
    for (let i = 0; i < 3; i++) recordRating(p, "sonnet", "opus", "high", 5, "");
    expect(p.experiments["sonnet"].status).toBe("adopted");
  });

  it("a non-improving experiment reverts", () => {
    const p = emptyProfile();
    for (let i = 0; i < 3; i++) recordRating(p, "haiku", "haiku", "low", 3, "");
    const { d } = decide("2+2", p); // haiku bucket -> experiment to sonnet
    expect(d.src).toBe("experiment");
    expect(d.tier).toBe("sonnet");
    for (let i = 0; i < 3; i++) recordRating(p, "haiku", "sonnet", "medium", 3, "");
    expect(p.experiments["haiku"].status).toBe("reverted");
  });

  it("top-tier opus never experiments (nowhere higher)", () => {
    const p = emptyProfile();
    for (let i = 0; i < 3; i++) recordRating(p, "opus", "opus", "high", 3, "");
    const { d } = decide("architect a distributed system and reason about trade-offs", p);
    expect(d.src).not.toBe("experiment");
  });
});

describe("graded ratings", () => {
  it("a 3 contributes 0.5, a 5 contributes 1.0", () => {
    const p = emptyProfile();
    recordRating(p, "haiku", "haiku", "low", 3, "");
    recordRating(p, "haiku", "haiku", "low", 5, "");
    const s = p.buckets["haiku"]["haiku"];
    expect(s.n).toBe(2);
    expect(Math.abs(s.sat - 1.5)).toBeLessThan(1e-9);
  });
});
