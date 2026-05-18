import { describe, expect, it } from "vitest";

import {
  formatTerminalShareRemaining,
  isTerminalShareFinalMinute,
  isTerminalShareVisibleAt,
  terminalShareRemainingMs
} from "./terminalShareState";
import type { TerminalShare } from "./types";

function createShare(expiresAt: string, overrides: Partial<TerminalShare> = {}): TerminalShare {
  return {
    id: "share-1",
    terminal_session_id: "session-1",
    host_id: "host-1",
    expires_at: expiresAt,
    revoked_at: null,
    max_accesses: null,
    access_count: 0,
    password_required: false,
    sensitive_prompt: "",
    viewer_count: 0,
    ...overrides
  };
}

describe("terminalShareState", () => {
  it("calculates share visibility and final-minute state from an explicit clock", () => {
    const now = Date.UTC(2026, 4, 15, 12, 0, 0);
    const visibleShare = createShare(new Date(now + 45_000).toISOString());
    const expiredShare = createShare(new Date(now - 1_000).toISOString());
    const revokedShare = createShare(new Date(now + 45_000).toISOString(), { revoked_at: new Date(now).toISOString() });

    expect(terminalShareRemainingMs(visibleShare, now)).toBe(45_000);
    expect(isTerminalShareVisibleAt(visibleShare, now)).toBe(true);
    expect(isTerminalShareFinalMinute(visibleShare, now)).toBe(true);
    expect(isTerminalShareVisibleAt(expiredShare, now)).toBe(false);
    expect(isTerminalShareVisibleAt(revokedShare, now)).toBe(false);
  });

  it("formats remaining share time for supported locales", () => {
    expect(formatTerminalShareRemaining(125_000, "en-US")).toBe("2m 5s");
    expect(formatTerminalShareRemaining(120_000, "en-US")).toBe("2m");
    expect(formatTerminalShareRemaining(12_000, "en-US")).toBe("12s");
    expect(formatTerminalShareRemaining(125_000, "zh-CN")).toBe("2分5秒");
    expect(formatTerminalShareRemaining(120_000, "zh-CN")).toBe("2分");
    expect(formatTerminalShareRemaining(12_000, "zh-CN")).toBe("12秒");
  });
});
