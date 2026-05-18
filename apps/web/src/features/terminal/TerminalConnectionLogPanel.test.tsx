import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  connectionLogClipboardText,
  TerminalConnectionLogPanel,
  type TerminalConnectionLogEntry
} from "./TerminalConnectionLogPanel";

const labels: Record<string, string> = {
  "terminal.connectionLog.title": "Connection log",
  "terminal.connectionLog.copy": "Copy events for troubleshooting.",
  "terminal.connectionLog.copyAction": "Copy log"
};

function t(key: string) {
  return labels[key] || key;
}

const logs: TerminalConnectionLogEntry[] = [
  {
    id: "log-1",
    level: "info",
    message: "Starting SSH connection",
    occurredAt: "raw-time"
  },
  {
    id: "log-2",
    level: "success",
    message: "Connected",
    occurredAt: "later-time"
  }
];

describe("TerminalConnectionLogPanel", () => {
  it("renders connection log entries and delegates copy action", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();

    render(
      <TerminalConnectionLogPanel
        language="en-US"
        logs={logs}
        onCopy={onCopy}
        t={t}
      />
    );

    const region = screen.getByRole("region", { name: "Connection log" });
    expect(within(region).getByText("Copy events for troubleshooting.")).toBeInTheDocument();
    expect(within(region).getByText("Starting SSH connection")).toBeInTheDocument();
    expect(within(region).getByText("Connected")).toBeInTheDocument();

    await user.click(within(region).getByRole("button", { name: "Copy log" }));

    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("formats clipboard text with timestamps, levels, and messages", () => {
    expect(connectionLogClipboardText(logs, "en-US")).toBe([
      "raw-time [info] Starting SSH connection",
      "later-time [success] Connected"
    ].join("\n"));
  });
});
