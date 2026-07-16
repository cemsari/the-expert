import { describe, it, expect } from "vitest";
import { exportProfile, importProfile, describeProfile, PROFILE_FORMAT } from "./profileIO";
import { emptyProfile, recordRating } from "./learner";

function sampleProfile() {
  const p = emptyProfile();
  recordRating(p, "sonnet", "sonnet", "medium", 5, "");
  recordRating(p, "haiku", "haiku", "low", 2, "use opus high next time");
  recordRating(p, "opus", "opus", "high", 4, "good depth");
  return p;
}

describe("profile export/import", () => {
  it("round-trips a profile losslessly", () => {
    const p = sampleProfile();
    const json = exportProfile(p);
    const res = importProfile(json);
    expect(res.ok).toBe(true);
    expect(res.profile?.buckets).toEqual(p.buckets);
    expect(res.profile?.directives).toEqual(p.directives);
    expect(res.profile?.noteLog).toEqual(p.noteLog);
  });

  it("stamps format and version", () => {
    const file = JSON.parse(exportProfile(sampleProfile()));
    expect(file.format).toBe(PROFILE_FORMAT);
    expect(file.version).toBe(1);
    expect(typeof file.exportedAt).toBe("string");
  });

  it("rejects invalid JSON", () => {
    const res = importProfile("{not json");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/JSON/i);
  });

  it("rejects a foreign file rather than corrupting learning", () => {
    const res = importProfile(JSON.stringify({ some: "other tool" }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not a The Expert profile/i);
  });

  it("rejects a profile from a newer version", () => {
    const res = importProfile(JSON.stringify({ format: PROFILE_FORMAT, version: 99, profile: {} }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/newer version/i);
  });

  it("survives a profile missing optional keys", () => {
    const res = importProfile(JSON.stringify({
      format: PROFILE_FORMAT, version: 1, profile: { buckets: { haiku: {} } },
    }));
    expect(res.ok).toBe(true);
    expect(res.profile?.noteLog).toEqual([]);
    expect(res.profile?.directives).toEqual({});
  });
});

describe("describeProfile", () => {
  it("summarises what's inside", () => {
    const s = describeProfile(sampleProfile());
    expect(s).toMatch(/question type/);
    expect(s).toMatch(/standing rule/);
  });
  it("says so when empty", () => {
    expect(describeProfile(emptyProfile())).toMatch(/empty/i);
  });
});
