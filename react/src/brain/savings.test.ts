import { describe, it, expect } from "vitest";
import { turnCost, opusBaseline, savingsForTurn, quip } from "./savings";

describe("savings math", () => {
  it("prices haiku correctly", () => {
    // 1000 in @ $1/M + 500 out @ $5/M = 0.001 + 0.0025 = 0.0035
    expect(turnCost({ tier: "haiku", tokensIn: 1000, tokensOut: 500 })).toBeCloseTo(0.0035, 6);
  });

  it("opus baseline uses opus prices", () => {
    // 1000@5 + 500@25 = 0.005 + 0.0125 = 0.0175
    expect(opusBaseline(1000, 500)).toBeCloseTo(0.0175, 6);
  });

  it("savings = baseline - actual, floored at 0", () => {
    const r = savingsForTurn({ tier: "haiku", tokensIn: 1000, tokensOut: 500 });
    expect(r.saved).toBeCloseTo(0.014, 6);
  });

  it("opus turn saves nothing vs itself", () => {
    const r = savingsForTurn({ tier: "opus", tokensIn: 1000, tokensOut: 500 });
    expect(r.saved).toBe(0);
  });
});

describe("quips", () => {
  it("fires a milestone when crossing a $0.25 boundary", () => {
    const msg = quip({ saved: 0.05, tier: "haiku", baseline: 0.1 }, 0.26, 0.24, () => 0);
    expect(msg).toContain("MILESTONE");
  });
  it("opus turns get a no-savings quip", () => {
    const msg = quip({ saved: 0, tier: "opus", baseline: 0.02 }, 0.02, 0.02, () => 0);
    expect(msg.toLowerCase()).toMatch(/big brain|flattered/);
  });
});
