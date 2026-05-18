import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithPageProviders } from "../test/renderWithProviders";
import type { Host } from "../features/hosts/types";
import { DashboardPage } from "./DashboardPage";

const prodHost: Host = {
  id: "host-1",
  credential_id: "cred-1",
  group_id: null,
  name: "Prod SSH",
  host: "10.0.0.10",
  port: 22,
  username: "root",
  auth_type: "password",
  remark: null,
  is_favorite: false,
  status: "online",
  last_connected_at: "2026-04-29T08:00:00Z",
  created_at: "2026-04-25T00:00:00Z",
  updated_at: "2026-04-29T08:00:00Z"
};

const fileHost: Host = {
  ...prodHost,
  id: "host-2",
  credential_id: "cred-2",
  name: "Log Server",
  host: "10.0.0.20",
  username: "ubuntu",
  is_favorite: true,
  status: "offline",
  last_connected_at: "2026-04-29T09:00:00Z"
};

const neverConnectedHost: Host = {
  ...prodHost,
  id: "host-3",
  credential_id: "cred-3",
  name: "Staging SSH",
  host: "10.0.0.30",
  username: "deploy",
  last_connected_at: null
};

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem("online-ssh-language", "en-US");
  });

  it("shows current terminal and file context in the workbench shortcuts", async () => {
    window.localStorage.setItem("online-ssh-terminal-snapshot", JSON.stringify({
      open_host_ids: ["host-1"],
      active_host_id: "host-1",
      sessions: [{
        session_id: "session-1",
        host_id: "host-1",
        host_label: "Prod",
        rows: 36,
        cols: 120,
        started_at: "2026-04-29T00:00:00Z"
      }],
      active_session_id: "session-1"
    }));
    window.localStorage.setItem("online-ssh-files-snapshot", JSON.stringify({
      selected_host_id: "host-2",
      current_path: "/var/log",
      search_keyword: ""
    }));

    renderWithPageProviders(<DashboardPage hosts={[prodHost, fileHost, neverConnectedHost]} />, { route: "/dashboard" });

    expect(await screen.findByText("Current workbench")).toBeInTheDocument();
    expect(screen.getByText("1 terminal tabs, active host Prod SSH, 1 hosts total.")).toBeInTheDocument();
    expect(screen.getByText("Browsing host Log Server / path /var/log.")).toBeInTheDocument();
    expect(screen.queryByText("Favorite hosts")).not.toBeInTheDocument();
    expect(screen.getByText("Recent connections")).toBeInTheDocument();

    const recentStrip = screen.getByText("Recent connections").closest(".dashboard-recent-strip");
    expect(within(recentStrip as HTMLElement).getByText("2 items")).toBeInTheDocument();
    const recentList = recentStrip?.querySelector(".dashboard-recent-list");
    expect(recentList).toHaveClass("dashboard-recent-list-adaptive");
    const recentConnections = within(recentStrip as HTMLElement).getAllByRole("article");
    expect(recentConnections).toHaveLength(2);
    expect(recentConnections[0]).toHaveAccessibleName("Recent connection Log Server");
    expect(recentConnections[1]).toHaveAccessibleName("Recent connection Prod SSH");
    expect(within(recentConnections[0]).getByText("Log Server")).toBeInTheDocument();
    expect(within(recentConnections[0]).getByText("ubuntu@10.0.0.20:22")).toBeInTheDocument();
    expect(within(recentConnections[0]).getByRole("button", { name: "Open terminal" })).toBeInTheDocument();
    expect(within(recentConnections[0]).getByRole("button", { name: "Open files" })).toBeInTheDocument();
    expect(within(recentStrip as HTMLElement).queryByText("Staging SSH")).not.toBeInTheDocument();
    expect(within(recentStrip as HTMLElement).queryByText("No terminal connection")).not.toBeInTheDocument();

    const terminalActionCard = screen.getAllByText("Terminal")[0].closest(".dashboard-action-card");
    expect(terminalActionCard).not.toBeNull();
    expect(within(terminalActionCard as HTMLElement).queryByRole("button", { name: "New connection" })).not.toBeInTheDocument();
    expect(within(terminalActionCard as HTMLElement).getByRole("button", { name: "Open terminal" })).toBeInTheDocument();
  });
});
