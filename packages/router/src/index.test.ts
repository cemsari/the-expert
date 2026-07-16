import { describe, it, expect } from "vitest";
import { Expert } from "./index";

describe("Expert — the public API", () => {
  it("routes a trivial prompt to haiku and returns a concrete model id", () => {
    const e = new Expert();
    const r = e.route("2+2");
    expect(r.tier).toBe("haiku");
    expect(r.model).toBe("claude-haiku-4-5-20251001");
    expect(r.id).toBeTruthy();
  });

  it("routes a complex prompt to opus", () => {
    const e = new Expert();
    expect(e.route("refactor the entire auth module and debug the race condition").tier).toBe("opus");
  });

  it("records a turn and computes savings vs always-Opus", () => {
    const e = new Expert();
    const r = e.route("2+2");
    const row = e.record(r.id, 1000, 500);
    expect(row).not.toBeNull();
    expect(row!.cost).toBeCloseTo(0.0035, 6);     // haiku
    expect(row!.baseline).toBeCloseTo(0.0175, 6); // opus
    expect(row!.saved).toBeCloseTo(0.014, 6);
  });

  it("reports lifetime savings", () => {
    const e = new Expert();
    const r = e.route("2+2");
    e.record(r.id, 1000, 500);
    const s = e.savings();
    expect(s.turns).toBe(1);
    expect(s.percent).toBe(80);
  });

  it("learns from a rating with a directive", () => {
    const e = new Expert();
    const r = e.route("write a function to parse csv");
    e.record(r.id, 100, 100);
    e.rate(r.id, 2, "wrong direction, use opus high next time");
    const next = e.route("write a function to validate an email");
    expect(next.tier).toBe("opus");
    expect(next.src).toBe("directed");
  });

  it("explains its reasoning", () => {
    const e = new Expert();
    const lines = e.explain("refactor the entire codebase and debug it");
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.map((l) => l.text).join(" ")).toMatch(/Complexity words/);
  });

  it("lists lessons in plain English", () => {
    const e = new Expert();
    for (let i = 0; i < 3; i++) {
      const r = e.route("2+2");
      e.record(r.id, 10, 10);
      e.rate(r.id, 5, "");
    }
    const lessons = e.lessons();
    expect(lessons.join(" ")).toMatch(/easy questions/);
  });

  it("exports and imports a profile", () => {
    const a = new Expert();
    const r = a.route("2+2");
    a.rate(r.id, 5, "great");
    const json = a.export();
    const b = new Expert();
    const res = b.import(json);
    expect(res.ok).toBe(true);
    expect(b.profile.buckets).toEqual(a.profile.buckets);
  });

  it("refuses a foreign profile rather than corrupting learning", () => {
    const e = new Expert();
    expect(e.import(JSON.stringify({ some: "other tool" })).ok).toBe(false);
  });

  it("can be constructed with an existing profile and ledger", () => {
    const a = new Expert();
    const r = a.route("2+2");
    a.record(r.id, 10, 10);
    const b = new Expert({ profile: a.profile, ledger: a.ledger });
    expect(b.savings().turns).toBe(1);
  });
});
