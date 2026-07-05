import { describe, expect, it } from "vitest";
import { isBotEligible } from "./eligibility";

const base = {
  assigned_agent_id: null,
  ai_autoreply_disabled: false,
  ai_reply_count: 0,
};

describe("isBotEligible", () => {
  it("allows a fresh, unassigned, enabled conversation under the cap", () => {
    expect(isBotEligible(base, 3)).toBe(true);
  });

  it("blocks when a human agent is assigned", () => {
    expect(isBotEligible({ ...base, assigned_agent_id: "agent-1" }, 3)).toBe(false);
  });

  it("blocks when auto-reply was disabled (handoff, sticky)", () => {
    expect(isBotEligible({ ...base, ai_autoreply_disabled: true }, 3)).toBe(false);
  });

  it("blocks when the per-conversation cap is reached", () => {
    expect(isBotEligible({ ...base, ai_reply_count: 3 }, 3)).toBe(false);
    expect(isBotEligible({ ...base, ai_reply_count: 4 }, 3)).toBe(false);
  });

  it("allows right up to the cap boundary", () => {
    expect(isBotEligible({ ...base, ai_reply_count: 2 }, 3)).toBe(true);
  });
});
