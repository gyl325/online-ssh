import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FileHostSidebar, type FileHostSidebarContextMap } from "./FileHostSidebar";
import type { Host } from "../hosts/types";

const labels: Record<string, string> = {
  "dashboard.hostsCount": "{{count}} hosts",
  "files.availableHosts": "Available hosts",
  "files.connectedHostActions": "Actions for {{name}}",
  "files.connectedHostInfo": "Host information",
  "files.connectedHosts": "Connected hosts",
  "files.connectedHostStatus.error": "Failed",
  "files.connectedHostStatus.loading": "Connecting",
  "files.currentHost": "Current host",
  "files.disconnectHost": "Disconnect host",
  "files.hostSearch": "Search hosts",
  "files.hostSearchPlaceholder": "Filter hosts",
  "files.newHostConnection": "New host connection",
  "files.noAvailableHosts": "No available hosts",
  "files.noConnectedHosts": "No connected hosts"
};

function t(key: string, values?: Record<string, string | number>) {
  let value = labels[key] || key;
  Object.entries(values || {}).forEach(([name, replacement]) => {
    value = value.replaceAll(`{{${name}}}`, String(replacement));
  });
  return value;
}

const hosts: Host[] = [
  {
    id: "host-1",
    name: "Prod SSH",
    host: "prod.example.com",
    port: 22,
    username: "root",
    auth_type: "private_key",
    is_favorite: true,
    status: "online",
    created_at: "2026-05-14T00:00:00.000Z",
    updated_at: "2026-05-14T00:00:00.000Z"
  },
  {
    id: "host-2",
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

const contexts: FileHostSidebarContextMap = {
  "host-1": {
    currentPath: "/var/log",
    directoryState: "ready",
    directoryErrorMessage: null
  },
  "host-2": {
    currentPath: "/home/deploy",
    directoryState: "error",
    directoryErrorMessage: "Fingerprint confirmation was canceled."
  }
};

describe("FileHostSidebar", () => {
  it("renders host picker and connected hosts while delegating route events", async () => {
    const user = userEvent.setup();
    const props = {
      availableHosts: [hosts[1]],
      connectedHostContexts: contexts,
      connectedHosts: hosts,
      filter: "work",
      onActivateHost: vi.fn(),
      onDisconnectHost: vi.fn(),
      onFilterChange: vi.fn(),
      onOpenChange: vi.fn(),
      open: true,
      selectedHostId: "host-1",
      t
    };

    render(<FileHostSidebar {...props} />);

    expect(screen.getByRole("heading", { name: "Current host" })).toBeInTheDocument();
    const picker = screen.getByText("Available hosts").closest(".files-host-picker") as HTMLElement;
    expect(within(picker).getByText("1 hosts")).toBeInTheDocument();
    expect(within(picker).getByDisplayValue("work")).toBeInTheDocument();
    expect(within(picker).getByText("deploy@worker.example.com:2222")).toBeInTheDocument();

    const connected = screen.getByRole("region", { name: "Connected hosts" });
    expect(within(connected).getByText("2 hosts")).toBeInTheDocument();
    expect(within(connected).getByRole("button", { name: "Prod SSH" })).toHaveAttribute("aria-current", "true");
    expect(within(connected).getByText("Failed")).toHaveClass("files-connected-host-status-error");
    await user.hover(within(connected).getAllByRole("button", { name: "Host information" })[0]);
    expect(await screen.findAllByText("root@prod.example.com:22")).not.toHaveLength(0);
    expect(screen.getAllByText("/var/log")).not.toHaveLength(0);

    await user.type(within(picker).getByLabelText("Search hosts"), "er");
    await user.click(within(picker).getByRole("button", { name: /Worker SSH/ }));
    await user.click(within(connected).getByRole("button", { name: "Worker SSH" }));
    await user.click(within(connected).getAllByRole("button", { name: "Disconnect host" })[0]);

    expect(props.onFilterChange).toHaveBeenLastCalledWith("workr");
    expect(props.onActivateHost).toHaveBeenNthCalledWith(1, "host-2");
    expect(props.onActivateHost).toHaveBeenNthCalledWith(2, "host-2");
    expect(props.onDisconnectHost).toHaveBeenCalledWith("host-1");
  });

  it("renders empty states and home path fallback", async () => {
    render(
      <FileHostSidebar
        availableHosts={[]}
        connectedHostContexts={{}}
        connectedHosts={[hosts[1]]}
        filter=""
        onActivateHost={vi.fn()}
        onDisconnectHost={vi.fn()}
        onFilterChange={vi.fn()}
        onOpenChange={vi.fn()}
        open
        selectedHostId=""
        t={t}
      />
    );

    expect(screen.getByText("No available hosts")).toHaveClass("files-sidebar-empty");
    await userEvent.hover(screen.getByRole("button", { name: "Host information" }));
    expect(await screen.findAllByText("/home/deploy")).not.toHaveLength(0);
  });

  it("renders a connected-host empty state", () => {
    render(
      <FileHostSidebar
        availableHosts={hosts}
        connectedHostContexts={{}}
        connectedHosts={[]}
        filter=""
        onActivateHost={vi.fn()}
        onDisconnectHost={vi.fn()}
        onFilterChange={vi.fn()}
        onOpenChange={vi.fn()}
        open={false}
        selectedHostId=""
        t={t}
      />
    );

    expect(screen.getByText("No connected hosts")).toHaveClass("files-sidebar-empty");
  });
});
