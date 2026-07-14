import { describe, it, expect } from "vitest";
import { heuristic, fableWorthy, topicOf, bucketOf } from "./router";

describe("routing brain — parity with terminal", () => {
  it("routes trivial math and greetings to haiku", () => {
    expect(heuristic("2+2").tier).toBe("haiku");
    expect(heuristic("hi").tier).toBe("haiku");
    expect(heuristic("merhaba").tier).toBe("haiku");
  });

  it("routes complexity keywords to opus", () => {
    expect(heuristic("refactor the entire auth module and debug the race condition").tier).toBe("opus");
    expect(heuristic("architect a distributed system and reason about trade-offs").tier).toBe("opus");
  });

  it("routes Turkish complexity keywords to opus", () => {
    expect(heuristic("mimariyi yeniden yapılandır ve hata ayıkla").tier).toBe("opus");
  });

  it("routes standard tasks to sonnet", () => {
    expect(heuristic("what is a closure in javascript").tier).toBe("sonnet");
    expect(heuristic("write a function to parse csv").tier).toBe("sonnet");
  });

  it("very short prompts go to haiku even if wordy-looking", () => {
    // < 25 chars, no code fence
    expect(heuristic("explain closures").tier).toBe("haiku");
  });

  it("assigns effort scaled to tier", () => {
    expect(heuristic("2+2").effort).toBe("low");
    expect(heuristic("refactor the entire distributed system end-to-end").effort).toBe("high");
  });

  it("low-confidence fallback when no signal", () => {
    const d = heuristic("the cat sat quietly by the window sill today");
    expect(d.conf).toBeLessThan(0.6);
  });
});

describe("fableWorthy — conservative", () => {
  it("does not fire on a normal opus prompt", () => {
    expect(fableWorthy("architect a rate limiter and reason about trade-offs")).toBe(false);
  });
  it("fires when heavy signals stack", () => {
    const heavy = "architect and refactor the entire distributed payments system, " +
      "prove correctness, debug race conditions and reason about trade-offs end-to-end";
    expect(fableWorthy(heavy)).toBe(true);
  });
});

describe("topicOf — subject extraction", () => {
  it("prefers proper nouns", () => {
    expect(topicOf("can you list all James Bond movies")).toBe("James Bond");
  });
  it("falls back to key nouns", () => {
    expect(topicOf("how do i cook risotto properly").toLowerCase()).toContain("risotto");
  });
  it("never returns empty", () => {
    expect(topicOf("the of to").length).toBeGreaterThan(0);
  });
});

describe("bucketOf", () => {
  it("mirrors the heuristic tier", () => {
    expect(bucketOf("2+2")).toBe("haiku");
    expect(bucketOf("refactor the whole architecture")).toBe("opus");
  });
});
