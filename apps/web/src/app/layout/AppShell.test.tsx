import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";
import { FingerprintDialogProvider } from "../../features/fingerprint/FingerprintDialogContext";
import { PreferencesProvider } from "../../features/preferences/PreferencesContext";
import { ConfirmDialogProvider } from "../../features/ui/ConfirmDialogContext";
import { ToastProvider } from "../../features/ui/ToastContext";
import { WorkspaceProvider } from "../../features/workspace/WorkspaceContext";
import * as adminApi from "../../features/admin/api";
import * as hostApi from "../../features/hosts/api";

const terminalPageState = vi.hoisted(() => ({
  hostCount: 0,
  hostNames: [] as string[],
  hostsLoading: false,
  quickConnectRequestId: 0,
  permissions: ["admin.access"],
  role: "admin",
  visible: false
}));

const transfersPageState = vi.hoisted(() => ({
  hostCount: 0,
  hostNames: [] as string[],
  visible: false
}));

const auditPageState = vi.hoisted(() => ({
  hostCount: 0,
  hostNames: [] as string[],
  visible: false
}));

const filesPageState = vi.hoisted(() => ({
  hostCount: 0,
  hostNames: [] as string[],
  visible: false
}));

const hostsPageState = vi.hoisted(() => ({
  visible: false
}));

const adminPageState = vi.hoisted(() => ({
  visible: false
}));

const routeModuleLoadCounts = vi.hoisted(() => ({
  admin: 0,
  audit: 0,
  credentials: 0,
  dashboard: 0,
  files: 0,
  hosts: 0,
  terminal: 0,
  transfers: 0,
  userCenter: 0
}));

vi.mock("../../features/auth/AuthContext", () => ({
  useAuth: () => ({
    bootError: null,
    signOut: vi.fn(),
    status: "authenticated",
  user: {
      display_name: "Test User",
      email: "test@example.com",
      permissions: terminalPageState.permissions,
      role: terminalPageState.role
    }
  })
}));

vi.mock("../../features/hosts/api", () => ({
  listHosts: vi.fn()
}));

vi.mock("../../features/admin/api", () => ({
  listAdminUsers: vi.fn(),
  listAdminSessions: vi.fn(),
  revokeAdminSession: vi.fn(),
  revokeAdminUserSessions: vi.fn(),
  updateAdminUserRole: vi.fn(),
  updateAdminUserStatus: vi.fn(),
  getAdminGeneralSettings: vi.fn(),
  updateAdminGeneralSettings: vi.fn()
}));

vi.mock("../../routes/AuditPage", () => ({
  AuditPage: (() => {
    routeModuleLoadCounts.audit += 1;
    return ({ hostCatalog, visible }: { hostCatalog?: { hosts: Array<{ name: string }> }; visible?: boolean }) => {
      auditPageState.hostCount = hostCatalog?.hosts.length ?? 0;
      auditPageState.hostNames = hostCatalog?.hosts.map((host) => host.name) ?? [];
      auditPageState.visible = visible ?? false;
      return <div>Audit page</div>;
    };
  })()
}));

vi.mock("../../routes/AdminPage", () => ({
  AdminPage: (() => {
    routeModuleLoadCounts.admin += 1;
    return ({ visible }: { visible?: boolean }) => {
      adminPageState.visible = visible ?? false;
      return <div>Admin settings</div>;
    };
  })()
}));

vi.mock("../../routes/CredentialsPage", () => ({
  CredentialsPage: (() => {
    routeModuleLoadCounts.credentials += 1;
    return () => <div>Credentials page</div>;
  })()
}));

vi.mock("../../routes/DashboardPage", () => ({
  DashboardPage: (() => {
    routeModuleLoadCounts.dashboard += 1;
    return () => <div>Dashboard page</div>;
  })()
}));

vi.mock("../../routes/FilesPage", () => ({
  FilesPage: (() => {
    routeModuleLoadCounts.files += 1;
    return ({ hostCatalog, visible }: { hostCatalog?: { hosts: Array<{ name: string }> }; visible?: boolean }) => {
      filesPageState.hostCount = hostCatalog?.hosts.length ?? 0;
      filesPageState.hostNames = hostCatalog?.hosts.map((host) => host.name) ?? [];
      filesPageState.visible = visible ?? false;
      return <div>Files page</div>;
    };
  })()
}));

vi.mock("../../routes/HostsPage", () => ({
  HostsPage: (() => {
    routeModuleLoadCounts.hosts += 1;
    return ({
      onHostSaved,
      visible
    }: {
      onHostSaved?: (host: {
        id: string;
        credential_id: string | null;
        group_id: string | null;
        name: string;
        host: string;
        port: number;
        username: string;
        auth_type: "password";
        remark: string | null;
        is_favorite: boolean;
        status: string;
        last_connected_at: string | null;
        created_at: string;
        updated_at: string;
      }) => void;
      visible?: boolean;
    }) => {
      hostsPageState.visible = visible ?? false;
      return (
        <div>
          Hosts page
          <button
            type="button"
            onClick={() =>
              onHostSaved?.({
                id: "host-3",
                credential_id: null,
                group_id: null,
                name: "Staging SSH",
                host: "203.0.113.20",
                port: 22,
                username: "deploy",
                auth_type: "password",
                remark: null,
                is_favorite: false,
                status: "active",
                last_connected_at: null,
                created_at: "2026-05-17T00:00:00Z",
                updated_at: "2026-05-17T00:00:00Z"
              })
            }
          >
            Simulate saved host
          </button>
        </div>
      );
    };
  })()
}));

vi.mock("../../routes/UserCenterPage", () => ({
  UserCenterPage: (() => {
    routeModuleLoadCounts.userCenter += 1;
    return () => <div>User center page</div>;
  })()
}));

vi.mock("../../routes/TransfersPage", () => ({
  TransfersPage: (() => {
    routeModuleLoadCounts.transfers += 1;
    return ({ hostCatalog, visible }: { hostCatalog?: { hosts: Array<{ name: string }> }; visible?: boolean }) => {
      transfersPageState.hostCount = hostCatalog?.hosts.length ?? 0;
      transfersPageState.hostNames = hostCatalog?.hosts.map((host) => host.name) ?? [];
      transfersPageState.visible = visible ?? false;
      return <div>Transfers page</div>;
    };
  })()
}));

vi.mock("../../routes/TerminalPage", () => ({
  TerminalPage: (() => {
    routeModuleLoadCounts.terminal += 1;
    return ({
      hostCatalog,
      quickConnectRequestId,
      visible
    }: {
      hostCatalog?: { hosts: Array<{ name: string }>; hostsLoading?: boolean };
      quickConnectRequestId?: number;
      visible?: boolean;
    }) => {
      terminalPageState.hostCount = hostCatalog?.hosts.length ?? 0;
      terminalPageState.hostNames = hostCatalog?.hosts.map((host) => host.name) ?? [];
      terminalPageState.hostsLoading = hostCatalog?.hostsLoading ?? false;
      terminalPageState.quickConnectRequestId = quickConnectRequestId || 0;
      terminalPageState.visible = visible ?? false;
      return <div data-testid="terminal-page">Terminal page</div>;
    };
  })()
}));

const listHostsMock = vi.mocked(hostApi.listHosts);
const listAdminUsersMock = vi.mocked(adminApi.listAdminUsers);
const listAdminSessionsMock = vi.mocked(adminApi.listAdminSessions);

function renderShell(route = "/terminal") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <PreferencesProvider>
        <ToastProvider>
          <WorkspaceProvider>
            <ConfirmDialogProvider>
              <FingerprintDialogProvider>
                <AppShell />
              </FingerprintDialogProvider>
            </ConfirmDialogProvider>
          </WorkspaceProvider>
        </ToastProvider>
      </PreferencesProvider>
    </MemoryRouter>
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("online-ssh-language", "en-US");
    terminalPageState.hostCount = 0;
    terminalPageState.hostNames = [];
    terminalPageState.hostsLoading = false;
    terminalPageState.quickConnectRequestId = 0;
    terminalPageState.permissions = ["admin.access"];
    terminalPageState.role = "admin";
    terminalPageState.visible = false;
    transfersPageState.hostCount = 0;
    transfersPageState.hostNames = [];
    transfersPageState.visible = false;
    auditPageState.hostCount = 0;
    auditPageState.hostNames = [];
    auditPageState.visible = false;
    filesPageState.hostCount = 0;
    filesPageState.hostNames = [];
    filesPageState.visible = false;
    hostsPageState.visible = false;
    adminPageState.visible = false;
    routeModuleLoadCounts.admin = 0;
    routeModuleLoadCounts.audit = 0;
    routeModuleLoadCounts.credentials = 0;
    routeModuleLoadCounts.dashboard = 0;
    routeModuleLoadCounts.files = 0;
    routeModuleLoadCounts.hosts = 0;
    routeModuleLoadCounts.terminal = 0;
    routeModuleLoadCounts.transfers = 0;
    routeModuleLoadCounts.userCenter = 0;
    listHostsMock.mockResolvedValue({
      items: [
        {
          id: "host-1",
          credential_id: "cred-1",
          group_id: null,
          name: "Prod SSH",
          host: "127.0.0.1",
          port: 22,
          username: "root",
          auth_type: "password",
          remark: null,
          is_favorite: false,
          status: "online",
          last_connected_at: null,
          created_at: "2026-04-24T00:00:00Z",
          updated_at: "2026-04-24T00:00:00Z"
        },
        {
          id: "host-2",
          credential_id: "cred-2",
          group_id: null,
          name: "Backup SSH",
          host: "10.0.0.2",
          port: 22,
          username: "ubuntu",
          auth_type: "password",
          remark: null,
          is_favorite: false,
          status: "online",
          last_connected_at: null,
          created_at: "2026-04-24T00:00:00Z",
          updated_at: "2026-04-24T00:00:00Z"
        }
      ],
      page: 1,
      page_size: 100,
      total: 2
    });
    listAdminUsersMock.mockResolvedValue({ items: [] });
    listAdminSessionsMock.mockResolvedValue({ items: [] });
  });

  it("loads route modules only after their keepalive route is first visited", async () => {
    renderShell("/dashboard");

    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
    expect(routeModuleLoadCounts.dashboard).toBe(1);
    expect(routeModuleLoadCounts.terminal).toBe(0);
    expect(routeModuleLoadCounts.files).toBe(0);
    expect(routeModuleLoadCounts.hosts).toBe(0);
    expect(routeModuleLoadCounts.credentials).toBe(0);
    expect(routeModuleLoadCounts.transfers).toBe(0);
    expect(routeModuleLoadCounts.audit).toBe(0);
    expect(routeModuleLoadCounts.admin).toBe(0);
    expect(routeModuleLoadCounts.userCenter).toBe(0);
  });

  it("places quick connect in the terminal topbar and forwards the request to the terminal page", async () => {
    const user = userEvent.setup();
    renderShell("/terminal");

    expect(await screen.findByTestId("terminal-page")).toBeInTheDocument();
    const quickConnectButton = screen.getByRole("button", { name: "Quick connect" });
    expect(quickConnectButton.closest(".topbar-right")).not.toBeNull();
    expect(quickConnectButton.querySelector(".lucide-zap")).not.toBeNull();
    expect(quickConnectButton).toHaveClass("ui-button-secondary");
    await user.click(quickConnectButton);

    await waitFor(() => expect(terminalPageState.quickConnectRequestId).toBe(1));
  });

  it("keeps quick connect visible on other pages and opens it through the terminal workspace", async () => {
    const user = userEvent.setup();
    renderShell("/dashboard");

    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
    const quickConnectButton = screen.getByRole("button", { name: "Quick connect" });
    expect(quickConnectButton.closest(".topbar-right")).not.toBeNull();
    expect(quickConnectButton.querySelector(".lucide-zap")).not.toBeNull();

    await user.click(quickConnectButton);

    expect(await screen.findByTestId("terminal-page")).toBeInTheDocument();
    await waitFor(() => expect(terminalPageState.quickConnectRequestId).toBe(1));
  });

  it("summarizes connected file hosts in the topbar without showing the file path", async () => {
    window.localStorage.setItem("online-ssh-files-snapshot", JSON.stringify({
      selected_host_id: "host-1",
      active_host_id: "host-1",
      open_host_ids: ["host-1", "host-2"],
      current_path: "/tmp/2db89c1e-b6b0-4f5d-a534-very-long-session-id",
      search_keyword: ""
    }));

    renderShell("/terminal");

    const filesLink = await screen.findByTitle("Open files");
    expect(within(filesLink).getByText("Files 2")).toBeInTheDocument();
    expect(within(filesLink).getByText("Active Prod SSH / 2 hosts")).toBeInTheDocument();
    expect(within(filesLink).queryByText(/very-long-session-id/)).not.toBeInTheDocument();
    expect(filesLink.querySelector(".lucide-folder")).not.toBeNull();
  });

  it("shows admin settings only for admin users", async () => {
    terminalPageState.permissions = [];
    terminalPageState.role = "operator";
    renderShell("/dashboard");

    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "管理员设置" })).not.toBeInTheDocument();
  });

  it("opens admin settings from the user menu for admins", async () => {
    const user = userEvent.setup();
    renderShell("/dashboard");

    await user.click(await screen.findByRole("button", { name: "Test User" }));
    await user.click(screen.getByRole("button", { name: "Admin settings" }));

    expect(await screen.findByText("Admin settings")).toBeInTheDocument();
  });

  it("passes the shared host catalog to transfers without a second host request", async () => {
    renderShell("/transfers");

    expect(await screen.findByText("Transfers page")).toBeInTheDocument();
    await waitFor(() => expect(transfersPageState.hostCount).toBe(2));
    expect(transfersPageState.hostNames).toEqual(["Prod SSH", "Backup SSH"]);
    expect(transfersPageState.visible).toBe(true);
    expect(listHostsMock).toHaveBeenCalledTimes(1);
  });

  it("passes the shared host catalog to audit without a second host request", async () => {
    renderShell("/audit");

    expect(await screen.findByText("Audit page")).toBeInTheDocument();
    await waitFor(() => expect(auditPageState.hostCount).toBe(2));
    expect(auditPageState.hostNames).toEqual(["Prod SSH", "Backup SSH"]);
    expect(auditPageState.visible).toBe(true);
    expect(listHostsMock).toHaveBeenCalledTimes(1);
  });

  it("passes the shared host catalog to terminal without a second host request", async () => {
    renderShell("/terminal");

    expect(await screen.findByTestId("terminal-page")).toBeInTheDocument();
    await waitFor(() => expect(terminalPageState.hostCount).toBe(2));
    expect(terminalPageState.hostNames).toEqual(["Prod SSH", "Backup SSH"]);
    expect(terminalPageState.hostsLoading).toBe(false);
    expect(terminalPageState.visible).toBe(true);
    expect(listHostsMock).toHaveBeenCalledTimes(1);
  });

  it("marks the files page visible only on the active files route", async () => {
    renderShell("/files");

    expect(await screen.findByText("Files page")).toBeInTheDocument();
    expect(filesPageState.visible).toBe(true);
  });

  it("passes the shared host catalog to files without a second host request", async () => {
    renderShell("/files");

    expect(await screen.findByText("Files page")).toBeInTheDocument();
    await waitFor(() => expect(filesPageState.hostCount).toBe(2));
    expect(filesPageState.hostNames).toEqual(["Prod SSH", "Backup SSH"]);
    expect(filesPageState.visible).toBe(true);
    expect(listHostsMock).toHaveBeenCalledTimes(1);
  });

  it("marks the hosts page visible only on the active hosts route", async () => {
    renderShell("/hosts");

    expect(await screen.findByText("Hosts page")).toBeInTheDocument();
    expect(hostsPageState.visible).toBe(true);
  });

  it("keeps hosts saved from the hosts page available to terminal and files routes", async () => {
    const user = userEvent.setup();
    renderShell("/hosts");

    expect(await screen.findByText("Hosts page")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Simulate saved host" }));

    await user.click(screen.getByTitle("Open terminal"));
    expect(await screen.findByTestId("terminal-page")).toBeInTheDocument();
    await waitFor(() => expect(terminalPageState.hostNames).toContain("Staging SSH"));

    await user.click(screen.getByTitle("Open files"));
    expect(await screen.findByText("Files page")).toBeInTheDocument();
    await waitFor(() => expect(filesPageState.hostNames).toContain("Staging SSH"));
  });

  it("marks the admin page visible only on the active admin route", async () => {
    renderShell("/admin");

    expect(await screen.findByText("Admin settings")).toBeInTheDocument();
    expect(adminPageState.visible).toBe(true);
  });

  it("opens user center from the user menu", async () => {
    const user = userEvent.setup();
    renderShell("/dashboard");

    await user.click(await screen.findByRole("button", { name: "Test User" }));
    await user.click(screen.getByRole("button", { name: "Profile" }));

    expect(await screen.findByText("User center page")).toBeInTheDocument();
  });
});
