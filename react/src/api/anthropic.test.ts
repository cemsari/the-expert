import { describe, it, expect } from "vitest";
import { parseSseLine } from "./anthropic";

describe("SSE stream parsing", () => {
  it("extracts text deltas", () => {
    const line = 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}';
    expect(parseSseLine(line)).toEqual({ text: "Hello" });
  });

  it("extracts input tokens from message_start", () => {
    const line = 'data: {"type":"message_start","message":{"usage":{"input_tokens":42}}}';
    expect(parseSseLine(line)).toEqual({ tokensIn: 42 });
  });

  it("extracts output tokens from message_delta", () => {
    const line = 'data: {"type":"message_delta","usage":{"output_tokens":17}}';
    expect(parseSseLine(line)).toEqual({ tokensOut: 17 });
  });

  it("surfaces stream errors", () => {
    const line = 'data: {"type":"error","error":{"message":"overloaded"}}';
    expect(parseSseLine(line)?.error).toBe("overloaded");
  });

  it("ignores non-data lines, [DONE], and malformed JSON", () => {
    expect(parseSseLine("event: message_stop")).toBeNull();
    expect(parseSseLine("data: [DONE]")).toBeNull();
    expect(parseSseLine("data: {not json")).toBeNull();
    expect(parseSseLine("")).toBeNull();
  });

  it("ignores block types we don't render (e.g. thinking deltas)", () => {
    const line = 'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}';
    expect(parseSseLine(line)).toBeNull();
  });
});
