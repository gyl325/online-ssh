import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  TerminalTabStrip,
  type TerminalTabStripTab,
  type TerminalTabStripWorkspace
} from "./TerminalTabStrip";
import type { Host } from "../hosts/types";

const labels: Record<string, string> = {
  "dashboard.hostsCount": "{{count}} hosts",
  "files.availableHosts": "Available hosts",
  "files.hostSearch": "Search hosts",
  "files.hostSearchPlaceholder": "Filter hosts",
  "host.empty1": "No hosts found",
  "quickConnect.newConnection": "New connection",
  "terminal.closeTab": "Close {{name}} tab",
  "terminal.reconnect": "Reconnect",
  "terminal.workspaceBroadcastDisable": "Disable workspace broadcast",
  "terminal.workspaceBroadcastEnable": "Enable workspace broadcast",
  "terminal.workspaceClose": "Close workspace",
  "terminal.workspaceTab": "Workspace"
};

function t(key: string, values?: Record<string, string | number>) {
  let template = labels[key] || key;
  Object.entries(values || {}).forEach(([name, value]) => {
    template = template.replaceAll(`{{${name}}}`, String(value));
  });
  return template;
}

const hosts: Host[] = [
  {
    id: "host-3",
    name: "Worker SSH",
    host: "worker.example.com",
    port: 2222,
    username: "deploy",
    auth_type: "password",
    is_favorite: false,
    status: "online",
    created_at: "2026-05-14T00:00:00.000Z",
    updated_at: "2026-05-14T00:00:00.000Z"
  }
];

const tabs: TerminalTabStripTab[] = [
  {
    hostLabel: "Prod SSH",
    id: "tab-1",
    status: "connected"
  },
  {
    hostLabel: "Failed SSH",
    id: "tab-2",
    status: "failed"
  }
];

const workspaces: TerminalTabStripWorkspace[] = [
  {
    active: true,
    broadcasting: false,
    id: "workspace-1",
    label: "Workspace",
    tabIds: ["tab-3", "tab-4"]
  }
];

describe("TerminalTabStrip", () => {
  it("renders workspaces, visible tabs and the host picker while delegating route events", async () => {
    const user = userEvent.setup();
    const props = {
      activeTabId: "tab-1",
      draggingTabId: "tab-2",
      hostPickerFilter: "work",
      hostPickerHosts: hosts,
      hostPickerOpen: true,
      onCloseTab: vi.fn(),
      onCloseWorkspace: vi.fn(),
      onDragEnd: vi.fn(),
      onDragListDrop: vi.fn(),
      onDragListLeave: vi.fn(),
      onDragListOver: vi.fn(),
      onDragStart: vi.fn(),
      onHostPickerFilterChange: vi.fn(),
      onHostPickerOpenChange: vi.fn(),
      onReconnectTab: vi.fn(),
      onSelectHost: vi.fn(),
      onSelectTab: vi.fn(),
      onSelectWorkspace: vi.fn(),
      onToggleWorkspaceBroadcast: vi.fn(),
      splitActive: true,
      t,
      tabs,
      tabListDropActive: true,
      workspaces
    };

    render(<TerminalTabStrip {...props} />);

    const tabList = screen.getByRole("tablist", { name: "Terminal tabs" });
    expect(tabList).toHaveClass("terminal-tab-list-split-active");
    expect(tabList).toHaveClass("terminal-tab-list-drop-active");

    await user.click(within(tabList).getByRole("tab", { name: /Workspace/ }));
    await user.click(within(tabList).getByRole("tab", { name: /Prod SSH/ }));
    await user.click(within(tabList).getByRole("button", { name: "Enable workspace broadcast" }));
    await user.click(within(tabList).getByRole("button", { name: "Close workspace" }));
    await user.click(within(tabList).getByRole("button", { name: "Reconnect" }));
    await user.click(within(tabList).getByRole("button", { name: "Close Prod SSH tab" }));

    const picker = screen.getByText("Available hosts").closest(".files-host-picker") as HTMLElement;
    await user.type(within(picker).getByLabelText("Search hosts"), "er");
    await user.click(within(picker).getByRole("button", { name: /Worker SSH/ }));

    expect(props.onSelectWorkspace).toHaveBeenCalledWith("workspace-1", ["tab-3", "tab-4"]);
    expect(props.onSelectTab).toHaveBeenCalledWith("tab-1");
    expect(props.onToggleWorkspaceBroadcast).toHaveBeenCalledWith("workspace-1");
    expect(props.onCloseWorkspace).toHaveBeenCalledWith(["tab-3", "tab-4"]);
    expect(props.onReconnectTab).toHaveBeenCalledWith(tabs[1]);
    expect(props.onCloseTab).toHaveBeenCalledWith(tabs[0]);
    expect(props.onHostPickerFilterChange).toHaveBeenLastCalledWith("workr");
    expect(props.onSelectHost).toHaveBeenCalledWith(hosts[0]);
  });

  it("renders the host picker trigger when the picker is closed", async () => {
    const user = userEvent.setup();
    const onHostPickerOpenChange = vi.fn();

    render(
      <TerminalTabStrip
        activeTabId="tab-1"
        draggingTabId={null}
        hostPickerFilter=""
        hostPickerHosts={hosts}
        hostPickerOpen={false}
        onCloseTab={vi.fn()}
        onCloseWorkspace={vi.fn()}
        onDragEnd={vi.fn()}
        onDragListDrop={vi.fn()}
        onDragListLeave={vi.fn()}
        onDragListOver={vi.fn()}
        onDragStart={vi.fn()}
        onHostPickerFilterChange={vi.fn()}
        onHostPickerOpenChange={onHostPickerOpenChange}
        onReconnectTab={vi.fn()}
        onSelectHost={vi.fn()}
        onSelectTab={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceBroadcast={vi.fn()}
        splitActive={false}
        t={t}
        tabs={[tabs[0]]}
        tabListDropActive={false}
        workspaces={[]}
      />
    );

    await user.click(screen.getByRole("button", { name: "New connection" }));

    expect(onHostPickerOpenChange).toHaveBeenCalledWith(true);
  });
});
