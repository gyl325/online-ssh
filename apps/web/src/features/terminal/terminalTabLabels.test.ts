import { describe, expect, it } from "vitest";

import {
  formatTerminalStatusLabel,
  getTerminalPlaceholderMessage,
  getTerminalStatusClassName,
  getTerminalStatusLabelKey,
  getTerminalTabStatusIndicator,
  type TerminalTabStatus
} from "./terminalTabLabels";

const translations: Record<string, string> = {
  "terminal.status.creating": "Creating",
  "terminal.status.connected": "Connected",
  "terminal.status.reconnecting": "Reconnecting",
  "terminal.status.disconnected": "Disconnected",
  "terminal.status.failed": "Failed",
  "terminal.status.connecting": "Connecting"
};

function t(key: string) {
  return translations[key] || key;
}

describe("terminal tab label helpers", () => {
  it("maps terminal statuses to translation keys and labels", () => {
    const cases: Array<[TerminalTabStatus, string, string]> = [
      ["creating", "terminal.status.creating", "Creating"],
      ["connecting", "terminal.status.connecting", "Connecting"],
      ["connected", "terminal.status.connected", "Connected"],
      ["reconnecting", "terminal.status.reconnecting", "Reconnecting"],
      ["disconnected", "terminal.status.disconnected", "Disconnected"],
      ["failed", "terminal.status.failed", "Failed"]
    ];

    for (const [status, key, label] of cases) {
      expect(getTerminalStatusLabelKey(status)).toBe(key);
      expect(formatTerminalStatusLabel(status, t)).toBe(label);
    }
  });

  it("returns the tab title status indicator without encoding JSX concerns", () => {
    expect(getTerminalTabStatusIndicator("creating")).toBe("spinner");
    expect(getTerminalTabStatusIndicator("connecting")).toBe("spinner");
    expect(getTerminalTabStatusIndicator("reconnecting")).toBe("spinner");
    expect(getTerminalTabStatusIndicator("connected")).toBe("connected");
    expect(getTerminalTabStatusIndicator("disconnected")).toBe("disconnected");
    expect(getTerminalTabStatusIndicator("failed")).toBe("reconnect");
  });

  it("builds status class names and preserves keepalive decoration", () => {
    expect(getTerminalStatusClassName("connected", false)).toBe("terminal-status terminal-status-connected");
    expect(getTerminalStatusClassName("connected", true)).toBe(
      "terminal-status terminal-status-connected terminal-status-keepalive"
    );
  });

  it("prefers terminal messages for placeholders before falling back to status labels", () => {
    expect(getTerminalPlaceholderMessage("failed", "Permission denied", t)).toBe("Permission denied");
    expect(getTerminalPlaceholderMessage("failed", "", t)).toBe("Failed");
  });
});
