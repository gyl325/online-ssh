import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  TerminalPaneHeader,
  type TerminalPaneHeaderTab
} from "./TerminalPaneHeader";

const labels: Record<string, string> = {
  "terminal.createdAt": "Created at:",
  "terminal.expiresAt": "Managed until:",
  "terminal.keepaliveDisable": "Disable background keepalive",
  "terminal.keepaliveEnable": "Enable background keepalive",
  "terminal.keepaliveUntil": "Keepalive until:",
  "terminal.pane.browserFullscreen": "Enter {{name}} browser fullscreen",
  "terminal.pane.close": "Close {{name}} pane",
  "terminal.pane.connectionInfo": "Connection info for {{name}}",
  "terminal.pane.exitSplit": "Exit split",
  "terminal.pane.more": "More actions for {{name}}",
  "terminal.share.menuCreate": "Share terminal",
  "terminal.share.menuManage": "Sharing",
  "terminal.status.connected": "Connected",
  "terminal.status.connecting": "Connecting"
};

function t(key: string, values?: Record<string, string | number>) {
  return (labels[key] || key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ""));
}

const tab: TerminalPaneHeaderTab = {
  hostLabel: "Prod SSH",
  id: "tab-1",
  message: "Ready",
  sessionId: "session-1",
  startedAt: "2026-05-15T01:02:03Z",
  status: "connected",
};

function renderHeader(overrides: Partial<ComponentProps<typeof TerminalPaneHeader>> = {}) {
  const props: ComponentProps<typeof TerminalPaneHeader> = {
    active: true,
    compact: false,
    draggable: true,
    formatDateTime: (value) => `formatted:${value}`,
    isWorkspacePane: true,
    menuOpen: false,
    onClosePane: vi.fn(),
    onCompactChange: vi.fn(),
    onDragEnd: vi.fn(),
    onDragStart: vi.fn(),
    onExitSplit: vi.fn(),
    onMenuOpenChange: vi.fn(),
    onOpenConnectionInfo: vi.fn(),
    onOpenShare: vi.fn(),
    onToggleBrowserFullscreen: vi.fn(),
    onToggleKeepAlive: vi.fn(),
    share: {
      active: true,
      finalMinute: true,
      label: "Manage share for Prod SSH, 42s left",
      remainingText: "42s"
    },
    t,
    tab,
    ...overrides
  };

  render(<TerminalPaneHeader {...props} />);
  return props;
}

describe("TerminalPaneHeader", () => {
  it("renders pane identity, status details, share state and primary actions", async () => {
    const user = userEvent.setup();
    const props = renderHeader();

    const header = screen.getByTestId("terminal-pane-header");
    expect(header).toHaveClass("terminal-pane-header-active");
    expect(screen.getByText("Prod SSH")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toHaveClass("terminal-status-connected");
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("session:session-1")).toBeInTheDocument();
    expect(screen.getByText(/Created at:formatted:2026-05-15T01:02:03Z/)).toBeInTheDocument();
    expect(screen.getByTestId("terminal-pane-drag-handle")).toHaveAttribute("draggable", "true");

    await user.click(screen.getByRole("button", { name: "Manage share for Prod SSH, 42s left" }));
    await user.click(screen.getByRole("button", { name: "Connection info for Prod SSH" }));
    await user.click(screen.getByRole("button", { name: "Enter Prod SSH browser fullscreen" }));
    await user.click(screen.getByRole("button", { name: "Close Prod SSH pane" }));

    expect(props.onOpenShare).toHaveBeenCalledTimes(1);
    expect(props.onOpenConnectionInfo).toHaveBeenCalledTimes(1);
    expect(props.onToggleBrowserFullscreen).toHaveBeenCalledTimes(1);
    expect(props.onClosePane).toHaveBeenCalledTimes(1);
  });

  it("keeps compact-only actions in the overflow menu and delegates route events", async () => {
    const user = userEvent.setup();
    const props = renderHeader({
      compact: true,
      menuOpen: true,
      share: {
        active: false,
        finalMinute: false,
        label: "Manage share for Prod SSH",
        remainingText: ""
      }
    });

    expect(screen.queryByRole("button", { name: "Manage share for Prod SSH" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Connection info for Prod SSH" }));
    await user.click(screen.getByRole("button", { name: "Enter Prod SSH browser fullscreen" }));
    await user.click(screen.getByRole("button", { name: "Close Prod SSH pane" }));
    await user.click(screen.getByRole("button", { name: "Enable background keepalive" }));
    await user.click(screen.getByRole("button", { name: "Share terminal" }));
    await user.click(screen.getByRole("button", { name: "Exit split" }));

    expect(props.onOpenConnectionInfo).toHaveBeenCalledTimes(1);
    expect(props.onToggleBrowserFullscreen).toHaveBeenCalledTimes(1);
    expect(props.onClosePane).toHaveBeenCalledTimes(1);
    expect(props.onToggleKeepAlive).toHaveBeenCalledTimes(1);
    expect(props.onOpenShare).toHaveBeenCalledTimes(1);
    expect(props.onExitSplit).toHaveBeenCalledTimes(1);
    expect(props.onMenuOpenChange).toHaveBeenCalledWith(false);
  });
});
