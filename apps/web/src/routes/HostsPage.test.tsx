import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocation } from "react-router-dom";

import stylesCss from "../styles.css?raw";
import { renderWithPageProviders } from "../test/renderWithProviders";
import { selectInputOption } from "../test/selectInput";
import { HostsPage } from "./HostsPage";
import * as authApi from "../features/auth/api";
import { confirmHostFingerprint } from "../features/fingerprint/api";
import { HttpError } from "../shared/api/http";
import type { CredentialListResponse } from "../features/credentials/types";
import type {
  Host,
  HostGroupListResponse,
  HostFingerprintConflictResponse,
  HostMetricsResponse,
  HostListResponse,
  TestHostResponse
} from "../features/hosts/types";
import * as credentialApi from "../features/credentials/api";
import * as hostApi from "../features/hosts/api";

vi.mock("../features/auth/api", async () => {
  const actual = await vi.importActual<typeof import("../features/auth/api")>("../features/auth/api");
  return {
    ...actual,
    getAuthConfig: vi.fn()
  };
});

vi.mock("../features/credentials/api", () => ({
  listCredentials: vi.fn()
}));

vi.mock("../features/hosts/api", () => ({
  createHostGroup: vi.fn(),
  createHost: vi.fn(),
  deleteHostGroup: vi.fn(),
  deleteHost: vi.fn(),
  getHost: vi.fn(),
  getHostMetrics: vi.fn(),
  listHostGroups: vi.fn(),
  listHosts: vi.fn(),
  testHost: vi.fn(),
  updateHostGroup: vi.fn(),
  updateHost: vi.fn()
}));

vi.mock("../features/fingerprint/api", () => ({
  confirmHostFingerprint: vi.fn()
}));

const listCredentialsMock = vi.mocked(credentialApi.listCredentials);
const getAuthConfigMock = vi.mocked(authApi.getAuthConfig);
const listHostGroupsMock = vi.mocked(hostApi.listHostGroups);
const listHostsMock = vi.mocked(hostApi.listHosts);
const getHostMock = vi.mocked(hostApi.getHost);
const getHostMetricsMock = vi.mocked(hostApi.getHostMetrics);
const createHostMock = vi.mocked(hostApi.createHost);
const updateHostMock = vi.mocked(hostApi.updateHost);
const createHostGroupMock = vi.mocked(hostApi.createHostGroup);
const updateHostGroupMock = vi.mocked(hostApi.updateHostGroup);
const testHostMock = vi.mocked(hostApi.testHost);
const confirmHostFingerprintMock = vi.mocked(confirmHostFingerprint);

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-probe">{location.pathname}{location.search}</span>;
}

const host: Host = {
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
};

const credentialList: CredentialListResponse = {
  items: [
    {
      id: "cred-1",
      name: "Password Credential",
      auth_type: "password",
      has_secret: true,
      has_private_key: false,
      has_passphrase: false,
      key_version: "1",
      is_default: false,
      created_at: "2026-04-24T00:00:00Z",
      updated_at: "2026-04-24T00:00:00Z"
    },
    {
      id: "cred-2",
      name: "Private Key Credential",
      auth_type: "private_key",
      has_secret: false,
      has_private_key: true,
      has_passphrase: false,
      key_version: "1",
      is_default: false,
      created_at: "2026-04-24T00:00:00Z",
      updated_at: "2026-04-24T00:00:00Z"
    }
  ],
  page: 1,
  page_size: 100,
  total: 2
};

const hostList: HostListResponse = {
  items: [host],
  page: 1,
  page_size: 100,
  total: 1
};

const hostGroupList: HostGroupListResponse = {
  items: [
    {
      id: "group-1",
      user_id: "user-1",
      name: "Ops",
      sort_order: 0,
      created_at: "2026-04-24T00:00:00Z",
      updated_at: "2026-04-24T00:00:00Z"
    }
  ]
};

const fingerprintConflict: HostFingerprintConflictResponse = {
  code: "HOST_FINGERPRINT_CONFLICT",
  message: "fingerprint changed",
  current_fingerprint: {
    algorithm: "ssh-ed25519",
    fingerprint: "SHA256:current-fingerprint",
    status: "changed",
    first_seen_at: "2026-04-24T10:00:00Z",
    last_verified_at: "2026-04-24T11:00:00Z"
  },
  previous_fingerprint: {
    algorithm: "ssh-rsa",
    fingerprint: "SHA256:previous-fingerprint",
    status: "trusted"
  }
};

const successResponse: TestHostResponse = {
  ok: true,
  message: "handshake ok",
  fingerprint: {
    algorithm: "ssh-ed25519",
    fingerprint: "SHA256:current-fingerprint",
    status: "trusted"
  }
};

const hostMetrics: HostMetricsResponse = {
  metrics: {
    host_id: "host-1",
    collected_at: "2026-05-03T12:00:00Z",
    cpu_usage_percent: 12.5,
    memory_usage_percent: 41.8,
    memory_used_bytes: 1717986918,
    memory_total_bytes: 4294967296,
    disk_usage_percent: 67,
    disk_used_bytes: 10737418240,
    disk_total_bytes: 21474836480,
    uptime_seconds: 512088,
    gpu_usage_percent: 64,
    system: {
      hostname: "prod-node",
      os_name: "Ubuntu 22.04.2 LTS",
      kernel: "6.8.0-101-generic"
    },
    ssh: {
      user: "root",
      client: "203.0.113.8 55000 22"
    },
    login: {
      active_login_count: 3,
      last_login: "operator pts/1 198.51.100.43 Sun May 3 19:07 still logged in",
      recent_logins: [
        "operator pts/1 198.51.100.43 Sun May 3 19:07 still logged in",
        "deploy pts/2 198.51.100.20 Sun May 3 18:42 - 18:58  (00:16)",
        "operator pts/3 198.51.100.43 Sun May 3 17:11 - 17:30  (00:19)",
        "operator pts/4 203.0.113.55 Sun May 3 12:13 - 12:22  (00:09)",
        "operator pts/5 203.0.113.55 Sun May 3 08:41 - 08:58  (00:17)"
      ]
    }
  }
} as HostMetricsResponse;

function createDeferredTestHostSuccess() {
  let resolve!: (value: { kind: "success"; data: TestHostResponse }) => void;
  const promise = new Promise<{ kind: "success"; data: TestHostResponse }>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("HostsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthConfigMock.mockResolvedValue({
      allow_registration: true,
      host_connectivity_poll_interval_seconds: 30
    });
    listCredentialsMock.mockResolvedValue(credentialList);
    listHostGroupsMock.mockResolvedValue(hostGroupList);
    listHostsMock.mockResolvedValue(hostList);
    getHostMock.mockResolvedValue({ host });
    getHostMetricsMock.mockResolvedValue(hostMetrics);
    confirmHostFingerprintMock.mockResolvedValue({
      fingerprint: {
        algorithm: "ssh-ed25519",
        fingerprint: "SHA256:current-fingerprint",
        status: "trusted"
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes the host list loading state as a status", () => {
    listHostsMock.mockReturnValue(new Promise(() => {}) as ReturnType<typeof hostApi.listHosts>);

    renderWithPageProviders(<HostsPage />, { route: "/hosts" });

    expect(screen.getByRole("status", { name: "Loading hosts..." })).toBeInTheDocument();
  });

  it("localizes permission errors when host loading is forbidden", async () => {
    window.localStorage.setItem("online-ssh-language", "zh-CN");
    listHostsMock.mockRejectedValue(
      new HttpError(403, { code: "FORBIDDEN", message: "Permission Required" })
    );

    renderWithPageProviders(<HostsPage />, { route: "/hosts" });

    expect(await screen.findAllByText("当前账号没有执行该操作的权限。")).not.toHaveLength(0);
    expect(screen.queryByText(/Permission Required|permission required/)).not.toBeInTheDocument();
    expect(screen.queryByText("主机列表加载失败。")).not.toBeInTheDocument();
  });

  it("does not show frontend implementation notes in the host summary", async () => {
    renderWithPageProviders(<HostsPage />, { route: "/hosts" });

    expect(await screen.findByText("Host list")).toBeInTheDocument();
    expect(screen.getByText("1 / 1 hosts.")).toBeInTheDocument();
    expect(screen.queryByText("1 / 1 hosts. Search and favorite filters run locally.")).not.toBeInTheDocument();
  });

  it("checks visible host connectivity on entry and repeats every 30 seconds", async () => {
    const secondHost: Host = {
      ...host,
      id: "host-2",
      credential_id: "cred-2",
      name: "Backup SSH",
      host: "192.0.2.20",
      username: "ubuntu",
      status: "unknown"
    };
    listHostsMock.mockResolvedValue({
      items: [host, secondHost],
      page: 1,
      page_size: 100,
      total: 2
    });
    testHostMock.mockResolvedValue({ kind: "success", data: successResponse });
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderWithPageProviders(<HostsPage />, { route: "/hosts" });

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    expect(await screen.findByText("Backup SSH")).toBeInTheDocument();

    await waitFor(() => {
      expect(testHostMock).toHaveBeenCalledWith("host-1", {});
      expect(testHostMock).toHaveBeenCalledWith("host-2", {});
    });

    const prodCard = screen.getByText("Prod SSH").closest("article") as HTMLElement;
    const backupCard = screen.getByText("Backup SSH").closest("article") as HTMLElement;
    expect(within(prodCard).getByLabelText("Reachable")).toBeInTheDocument();
    expect(within(backupCard).getByLabelText("Reachable")).toBeInTheDocument();

    vi.advanceTimersByTime(30000);

    await waitFor(() => expect(testHostMock).toHaveBeenCalledTimes(4));
  });

  it("uses the server configured connectivity poll interval", async () => {
    getAuthConfigMock.mockResolvedValue({
      allow_registration: true,
      host_connectivity_poll_interval_seconds: 7
    });
    testHostMock.mockResolvedValue({ kind: "success", data: successResponse });
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderWithPageProviders(<HostsPage />, { route: "/hosts" });

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    await waitFor(() => expect(testHostMock).toHaveBeenCalledTimes(1));

    vi.advanceTimersByTime(6000);
    expect(testHostMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    await waitFor(() => expect(testHostMock).toHaveBeenCalledTimes(2));
  });

  it("does not show a checking spinner after the first automatic connectivity check", async () => {
    const firstCheck = createDeferredTestHostSuccess();
    const secondCheck = createDeferredTestHostSuccess();
    getHostMetricsMock.mockImplementation(() => new Promise(() => {}));
    testHostMock
      .mockImplementationOnce(() => firstCheck.promise)
      .mockImplementationOnce(() => secondCheck.promise);
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderWithPageProviders(<HostsPage />, { route: "/hosts" });

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    const prodCard = screen.getByText("Prod SSH").closest("article") as HTMLElement;
    expect(within(prodCard).getByLabelText("Checking connection")).toBeInTheDocument();

    firstCheck.resolve({ kind: "success", data: successResponse });
    await waitFor(() => expect(within(prodCard).getByLabelText("Reachable")).toBeInTheDocument());

    vi.advanceTimersByTime(30000);
    await waitFor(() => expect(testHostMock).toHaveBeenCalledTimes(2));

    expect(within(prodCard).queryByLabelText("Checking connection")).not.toBeInTheDocument();
    expect(within(prodCard).getByLabelText("Reachable")).toBeInTheDocument();

    secondCheck.resolve({ kind: "success", data: successResponse });
    await waitFor(() => expect(within(prodCard).getByLabelText("Reachable")).toBeInTheDocument());
  });

  it("marks a host unreachable when automatic connectivity testing fails", async () => {
    testHostMock.mockRejectedValue(new Error("connection refused"));

    renderWithPageProviders(<HostsPage />, { route: "/hosts" });

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();

    const prodCard = screen.getByText("Prod SSH").closest("article") as HTMLElement;
    await waitFor(() => expect(within(prodCard).getByLabelText("Unreachable")).toBeInTheDocument());
  });

  it("renders reachable and unreachable states as breathing status dots", async () => {
    const secondHost: Host = {
      ...host,
      id: "host-2",
      credential_id: "cred-2",
      name: "Backup SSH",
      host: "192.0.2.20",
      username: "ubuntu",
      status: "unknown"
    };
    listHostsMock.mockResolvedValue({
      items: [host, secondHost],
      page: 1,
      page_size: 100,
      total: 2
    });
    testHostMock.mockImplementation((hostId) => {
      if (hostId === "host-2") {
        return Promise.reject(new Error("connection refused"));
      }
      return Promise.resolve({ kind: "success", data: successResponse });
    });

    renderWithPageProviders(<HostsPage />, { route: "/hosts" });

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    expect(await screen.findByText("Backup SSH")).toBeInTheDocument();
    const prodCard = screen.getByText("Prod SSH").closest("article") as HTMLElement;
    const backupCard = screen.getByText("Backup SSH").closest("article") as HTMLElement;
    const reachableIndicator = await within(prodCard).findByLabelText("Reachable");
    const unreachableIndicator = await within(backupCard).findByLabelText("Unreachable");
    expect(reachableIndicator.querySelector(".host-connectivity-breathing-dot-reachable")).toBeInTheDocument();
    expect(unreachableIndicator.querySelector(".host-connectivity-breathing-dot-unreachable")).toBeInTheDocument();
    expect(reachableIndicator.querySelector("svg")).not.toBeInTheDocument();
    expect(unreachableIndicator.querySelector("svg")).not.toBeInTheDocument();
  });

  it("does not mark hosts that still require fingerprint confirmation as reachable", async () => {
    testHostMock.mockResolvedValue({ kind: "fingerprint_conflict", data: fingerprintConflict });

    renderWithPageProviders(<HostsPage />, { route: "/hosts" });

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    const prodCard = screen.getByText("Prod SSH").closest("article") as HTMLElement;
    const fingerprintIndicator = await within(prodCard).findByLabelText("Fingerprint required");

    expect(fingerprintIndicator.querySelector(".host-connectivity-breathing-dot-reachable")).not.toBeInTheDocument();
    expect(within(prodCard).queryByLabelText("Reachable")).not.toBeInTheDocument();
  });

  it("marks the host reachable when metrics load before the connectivity probe resolves", async () => {
    const firstCheck = createDeferredTestHostSuccess();
    testHostMock.mockImplementation(() => firstCheck.promise);

    renderWithPageProviders(<HostsPage />, { route: "/hosts" });

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    const prodCard = screen.getByText("Prod SSH").closest("article") as HTMLElement;

    expect(await within(prodCard).findByText("CPU 12.5%")).toBeInTheDocument();
    await waitFor(() => expect(within(prodCard).getByLabelText("Reachable")).toBeInTheDocument());
    expect(within(prodCard).queryByLabelText("Checking connection")).not.toBeInTheDocument();
  });

  it("keeps the reachable status when the first connectivity probe starts after metrics load", async () => {
    let resolveConfig!: (value: { allow_registration: boolean; host_connectivity_poll_interval_seconds: number }) => void;
    getAuthConfigMock.mockReturnValue(new Promise((resolve) => {
      resolveConfig = resolve;
    }));
    const firstCheck = createDeferredTestHostSuccess();
    testHostMock.mockImplementation(() => firstCheck.promise);

    renderWithPageProviders(<HostsPage />, { route: "/hosts" });

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    const prodCard = screen.getByText("Prod SSH").closest("article") as HTMLElement;

    expect(await within(prodCard).findByText("CPU 12.5%")).toBeInTheDocument();
    await waitFor(() => expect(within(prodCard).getByLabelText("Reachable")).toBeInTheDocument());

    resolveConfig({
      allow_registration: true,
      host_connectivity_poll_interval_seconds: 30
    });
    await waitFor(() => expect(testHostMock).toHaveBeenCalledWith("host-1", {}));

    expect(within(prodCard).getByLabelText("Reachable")).toBeInTheDocument();
    expect(within(prodCard).queryByLabelText("Checking connection")).not.toBeInTheDocument();
  });

  it("does not load host metrics while hidden by AppShell keepalive", async () => {
    renderWithPageProviders(<HostsPage visible={false} />, { route: "/hosts" });

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getHostMetricsMock).not.toHaveBeenCalled();
    expect(testHostMock).not.toHaveBeenCalled();
  });

  it("shows a compact host card with inline status, connection text, a horizontal tag row, and actions", async () => {
    listHostsMock.mockResolvedValue({
      items: [{ ...host, group_id: "group-1", is_favorite: true }],
      page: 1,
      page_size: 100,
      total: 1
    });

    renderWithPageProviders(<HostsPage />, { route: "/hosts" });

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    const prodCard = screen.getByText("Prod SSH").closest("article") as HTMLElement;

    expect(await within(prodCard).findByText("CPU 12.5%")).toBeInTheDocument();
    expect(within(prodCard).getByText("MEM 41.8%")).toBeInTheDocument();
    expect(within(prodCard).getByText("root@127.0.0.1:22")).toBeInTheDocument();
    expect(prodCard.querySelector(".host-card-header .host-connectivity-indicator")).toBeInTheDocument();
    expect(prodCard.querySelector(".host-card-body")).toBeInTheDocument();
    const tagRow = prodCard.querySelector(".host-card-tags") as HTMLElement;
    expect(tagRow).toBeInTheDocument();
    expect(tagRow).toHaveClass("chip-row");
    expect(within(tagRow).getByText("Favorite")).toBeInTheDocument();
    expect(within(tagRow).getByText("Ops")).toBeInTheDocument();
    expect(within(tagRow).getByText("Password")).toBeInTheDocument();
    expect(prodCard.querySelector(".host-card-footer .chip-row")).not.toBeInTheDocument();
    expect(prodCard.querySelector(".host-card-footer .resource-card-actions")).toBeInTheDocument();
    expect(Array.from(prodCard.children).map((child) => child.className)).toEqual([
      "host-card-header",
      "host-card-body",
      "chip-row host-card-tags",
      "host-card-footer"
    ]);
    expect(within(prodCard).queryByText("online")).not.toBeInTheDocument();
    expect(within(prodCard).queryByText(/GPU/i)).not.toBeInTheDocument();
  });

  it("opens the file manager from the host card action area", async () => {
    const user = userEvent.setup();
    renderWithPageProviders(
      <>
        <HostsPage />
        <LocationProbe />
      </>,
      { route: "/hosts" }
    );

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    const prodCard = screen.getByText("Prod SSH").closest("article") as HTMLElement;
    const fileManagerButton = within(prodCard).getByRole("button", { name: "Open file manager" });

    await user.click(fileManagerButton);

    expect(screen.getByTestId("location-probe")).toHaveTextContent("/files?host_id=host-1");
  });

  it("loads running, system, GPU, SSH, and login metrics in the host detail dialog", async () => {
    const user = userEvent.setup();
    renderWithPageProviders(<HostsPage />, { route: "/hosts" });

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View details" }));

    const dialog = await screen.findByRole("dialog", { name: "Host details" });
    expect(within(dialog).getByText("Overview")).toBeInTheDocument();
    expect(within(dialog).getByText("root@127.0.0.1:22")).toBeInTheDocument();
    const overview = dialog.querySelector(".host-detail-overview") as HTMLElement;
    expect(overview.querySelector(".host-connectivity-indicator-reachable")).toBeInTheDocument();
    expect(within(overview).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(await within(dialog).findByText("Runtime monitoring")).toBeInTheDocument();
    expect(dialog.querySelector(".host-detail-top-grid")).toBeInTheDocument();
    expect(dialog.querySelector(".host-detail-secondary-grid")).toBeInTheDocument();
    expect(dialog.querySelector(".host-detail-login-section")).toBeInTheDocument();
    const cpuMetric = within(dialog).getByText("CPU usage").closest(".host-runtime-metric") as HTMLElement;
    const memoryMetric = within(dialog).getByText("Memory usage").closest(".host-runtime-metric") as HTMLElement;
    const diskMetric = within(dialog).getByText("Disk usage").closest(".host-runtime-metric") as HTMLElement;
    const gpuMetric = within(dialog).getByText("GPU usage").closest(".host-runtime-metric") as HTMLElement;
    expect(within(cpuMetric).getByText("12.5%")).toBeInTheDocument();
    expect(within(memoryMetric).getByText("41.8%")).toBeInTheDocument();
    expect(within(memoryMetric).getByText("1.6 GiB / 4.0 GiB")).toBeInTheDocument();
    expect(within(diskMetric).getByText("67%")).toBeInTheDocument();
    expect(within(gpuMetric).getByText("64%")).toBeInTheDocument();
    expect(cpuMetric.querySelector(".host-runtime-progress-fill")).toBeInTheDocument();
    expect(cpuMetric.querySelector(".host-runtime-progress-track")).toBeInTheDocument();
    expect(within(dialog).getByText("Uptime")).toBeInTheDocument();
    expect(within(dialog).getByText("5d 22h 14m")).toBeInTheDocument();
    expect(within(dialog).getByText("System information")).toBeInTheDocument();
    expect(within(dialog).getByText("prod-node")).toBeInTheDocument();
    expect(within(dialog).getByText("Ubuntu 22.04.2 LTS")).toBeInTheDocument();
    expect(within(dialog).getByText("6.8.0-101-generic")).toBeInTheDocument();
    expect(within(dialog).getByText("SSH login information")).toBeInTheDocument();
    expect(within(dialog).getByText("root")).toBeInTheDocument();
    expect(within(dialog).getByText("203.0.113.8 55000 22")).toBeInTheDocument();
    const secondaryGrid = dialog.querySelector(".host-detail-secondary-grid") as HTMLElement;
    expect(within(secondaryGrid).getByText("System information")).toBeInTheDocument();
    expect(within(secondaryGrid).getByText("SSH login information")).toBeInTheDocument();
    expect(within(dialog).getByText("Login statistics")).toBeInTheDocument();
    const loginSection = dialog.querySelector(".host-detail-login-section") as HTMLElement;
    expect(within(loginSection).getAllByText("Recent login records")).toHaveLength(2);
    const summaryCards = loginSection.querySelectorAll(".host-login-summary-card");
    const activeLoginCard = summaryCards[0] as HTMLElement;
    const recentLoginCard = summaryCards[1] as HTMLElement;
    const uniqueSourceCard = summaryCards[2] as HTMLElement;
    expect(within(activeLoginCard).getByText("3")).toBeInTheDocument();
    expect(within(recentLoginCard).getByText("5")).toBeInTheDocument();
    expect(within(loginSection).getByText("Unique source IPs")).toBeInTheDocument();
    expect(within(uniqueSourceCard).getByText("3")).toBeInTheDocument();
    expect(loginSection.querySelectorAll(".host-login-record")).toHaveLength(3);
    expect(within(loginSection).getAllByText("operator")).toHaveLength(2);
    expect(within(loginSection).getByText("deploy")).toBeInTheDocument();
    expect(within(loginSection).getByText("pts/1")).toBeInTheDocument();
    expect(within(loginSection).getAllByText("198.51.100.43")).toHaveLength(2);
    expect(within(loginSection).getByText("198.51.100.20")).toBeInTheDocument();
    expect(within(loginSection).getByText("Still online")).toBeInTheDocument();
    expect(within(loginSection).getAllByText("Ended")).toHaveLength(2);
    expect(within(loginSection).getByText(/19:07/)).toBeInTheDocument();
    expect(within(loginSection).queryByText("203.0.113.55")).not.toBeInTheDocument();
    expect(within(loginSection).queryByText(/still logged in/i)).not.toBeInTheDocument();
    const bottomActions = dialog.querySelector(".editor-actions") as HTMLElement;
    expect(within(bottomActions).getByRole("button", { name: "Open terminal" })).toBeInTheDocument();
    expect(within(bottomActions).getByRole("button", { name: "Open file manager" })).toBeInTheDocument();
    expect(within(bottomActions).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(getHostMetricsMock).toHaveBeenCalledWith("host-1");
  });

  it("keeps the overview label selector from overriding the reachable breathing dot color", async () => {
    const user = userEvent.setup();
    renderWithPageProviders(<HostsPage />, { route: "/hosts" });

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View details" }));

    const dialog = await screen.findByRole("dialog", { name: "Host details" });
    const overview = dialog.querySelector(".host-detail-overview") as HTMLElement;
    const overviewTitle = within(overview).getByText("Overview");
    const breathingDot = overview.querySelector(".host-connectivity-breathing-dot-reachable") as HTMLElement;
    const selectorMatch = stylesCss.match(/([^{}]*host-detail-overview-title[^{}]*)\{\s*color:\s*var\(--ui-subtle\);\s*font-size:\s*0\.76rem;\s*font-weight:\s*700;\s*text-transform:\s*uppercase;\s*letter-spacing:\s*0\.08em;\s*\}/);
    const overviewLabelSelector = selectorMatch?.[1].trim();

    expect(overviewLabelSelector).toBeTruthy();
    expect(overviewTitle.matches(overviewLabelSelector as string)).toBe(true);
    expect(breathingDot.matches(overviewLabelSelector as string)).toBe(false);
  });

  it("shows an unreachable status in the host detail overview when no connectivity result is available", async () => {
    getAuthConfigMock.mockReturnValue(new Promise(() => {}));
    getHostMetricsMock.mockRejectedValue(new Error("metrics unavailable"));

    const user = userEvent.setup();
    renderWithPageProviders(<HostsPage />, { route: "/hosts" });

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View details" }));

    const dialog = await screen.findByRole("dialog", { name: "Host details" });
    expect(await within(dialog).findByText("Unavailable")).toBeInTheDocument();
    const overview = dialog.querySelector(".host-detail-overview") as HTMLElement;
    expect(within(overview).getByLabelText("Unreachable")).toBeInTheDocument();
    expect(overview.querySelector(".host-connectivity-breathing-dot-unreachable")).toBeInTheDocument();
    expect(within(overview).queryByLabelText("Not checked")).not.toBeInTheDocument();
  });

  it("retries host testing after fingerprint confirmation and reports success through toast only", async () => {
    testHostMock
      .mockResolvedValueOnce({ kind: "fingerprint_conflict", data: fingerprintConflict })
      .mockResolvedValueOnce({ kind: "success", data: successResponse });

    const user = userEvent.setup();
    renderWithPageProviders(<HostsPage />);

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View details" }));

    expect(await screen.findByRole("heading", { name: "Host details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test connection" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit host" });
    expect(within(dialog).queryByText("Temporarily override saved credentials for this test")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Test connection" }));

    expect(
      await screen.findByRole("heading", {
        name: /host fingerprint confirmation required|需要确认主机指纹/i
      })
    ).toBeInTheDocument();
    expect(screen.getByText("fingerprint changed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /confirm fingerprint and continue|确认 fingerprint 并继续/i }));

    await waitFor(() => expect(testHostMock).toHaveBeenCalledTimes(2));
    expect(testHostMock).toHaveBeenNthCalledWith(1, "host-1", {
      host: "127.0.0.1",
      port: 22,
      username: "root",
      auth_type: "password",
      credential_id: "cred-1"
    });
    expect(testHostMock).toHaveBeenNthCalledWith(2, "host-1", {
      host: "127.0.0.1",
      port: 22,
      username: "root",
      auth_type: "password",
      credential_id: "cred-1"
    });
    expect(confirmHostFingerprintMock).toHaveBeenCalledWith("host-1", {
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:current-fingerprint"
    });
    await waitFor(() => expect(within(dialog).queryByText("Connected")).not.toBeInTheDocument());
    expect(await screen.findByText("Connected · ssh-ed25519 SHA256:current-fingerprint")).toBeInTheDocument();
  });

  it("tests an edited host with the current auth method and bound credential", async () => {
    testHostMock.mockResolvedValueOnce({ kind: "success", data: successResponse });

    const user = userEvent.setup();
    renderWithPageProviders(<HostsPage />);

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit host" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit host" });
    await selectInputOption(user, within(dialog).getByRole("combobox", { name: "Auth type" }), "private_key");
    await selectInputOption(user, within(dialog).getByRole("combobox", { name: "Bound credential" }), "cred-2");
    await user.click(within(dialog).getByRole("button", { name: "Test connection" }));

    await waitFor(() =>
      expect(testHostMock).toHaveBeenCalledWith("host-1", {
        host: "127.0.0.1",
        port: 22,
        username: "root",
        auth_type: "private_key",
        credential_id: "cred-2"
      })
    );
    expect(within(dialog).queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.getByText("Connected · ssh-ed25519 SHA256:current-fingerprint")).toBeInTheDocument();
  });

  it("localizes backend SSH probe messages when host testing fails", async () => {
    testHostMock.mockResolvedValueOnce({
      kind: "success",
      data: {
        ...successResponse,
        ok: false,
        message: "SSH authentication failed"
      }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<HostsPage />);

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit host" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit host" });
    await user.click(within(dialog).getByRole("button", { name: "Test connection" }));

    const friendlyMessage = "SSH authentication failed. Check the username, password, or key.";
    expect(await screen.findByText(friendlyMessage, { selector: ".toast-content p" })).toBeInTheDocument();
    expect(screen.queryByText("SSH authentication failed", { selector: ".toast-content p" })).not.toBeInTheDocument();
  });

  it("refreshes credential options when the kept-alive hosts page becomes active again", async () => {
    const freshCredential = {
      id: "cred-3",
      name: "Fresh Password Credential",
      auth_type: "password" as const,
      has_secret: true,
      has_private_key: false,
      has_passphrase: false,
      key_version: "1",
      is_default: false,
      created_at: "2026-05-17T00:00:00Z",
      updated_at: "2026-05-17T00:00:00Z"
    };
    listCredentialsMock
      .mockResolvedValueOnce(credentialList)
      .mockResolvedValueOnce({
        ...credentialList,
        items: [...credentialList.items, freshCredential],
        total: 3
      });

    const user = userEvent.setup();
    const { rerender } = renderWithPageProviders(<HostsPage visible />, { route: "/hosts" });

    await waitFor(() => expect(listCredentialsMock).toHaveBeenCalledTimes(1));

    rerender(<HostsPage visible={false} />);
    rerender(<HostsPage visible />);

    await waitFor(() => expect(listCredentialsMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit host" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit host" });
    const credentialSelect = within(dialog).getByRole("combobox", { name: "Bound credential" });
    await selectInputOption(user, credentialSelect, "cred-3");
    expect(credentialSelect).toHaveTextContent("Fresh Password Credential");
  });

  it("reloads hosts when a group filter is selected", async () => {
    const user = userEvent.setup();
    renderWithPageProviders(<HostsPage />);

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Group" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ops" }));

    await waitFor(() => expect(listHostsMock).toHaveBeenLastCalledWith(undefined, false, "group-1"));
  });

  it("uses a group dropdown when there are more than three groups", async () => {
    listHostGroupsMock.mockResolvedValue({
      items: [
        hostGroupList.items[0],
        {
          id: "group-2",
          user_id: "user-1",
          name: "Database",
          sort_order: 1,
          created_at: "2026-04-30T00:00:00Z",
          updated_at: "2026-04-30T00:00:00Z"
        },
        {
          id: "group-3",
          user_id: "user-1",
          name: "Edge",
          sort_order: 2,
          created_at: "2026-04-30T00:00:00Z",
          updated_at: "2026-04-30T00:00:00Z"
        },
        {
          id: "group-4",
          user_id: "user-1",
          name: "Archive",
          sort_order: 3,
          created_at: "2026-04-30T00:00:00Z",
          updated_at: "2026-04-30T00:00:00Z"
        }
      ]
    });

    const user = userEvent.setup();
    renderWithPageProviders(<HostsPage />);

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ops" })).not.toBeInTheDocument();

    await selectInputOption(user, screen.getByRole("combobox", { name: "Group" }), "group-4");

    await waitFor(() => expect(listHostsMock).toHaveBeenLastCalledWith(undefined, false, "group-4"));
  });

  it("creates a host and refreshes the list", async () => {
    const createdHost: Host = {
      ...host,
      id: "host-2",
      credential_id: null,
      group_id: "group-1",
      name: "Staging SSH",
      host: "203.0.113.20",
      port: 2222,
      username: "deploy",
      is_favorite: true
    };
    listHostsMock
      .mockResolvedValueOnce(hostList)
      .mockResolvedValueOnce({
        items: [host, createdHost],
        page: 1,
        page_size: 100,
        total: 2
      });
    createHostMock.mockResolvedValue({ host: createdHost });

    const user = userEvent.setup();
    const onHostSaved = vi.fn();
    renderWithPageProviders(<HostsPage onHostSaved={onHostSaved} />);

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New host" }));

    const dialog = await screen.findByRole("dialog", { name: "Create host" });
    await user.type(within(dialog).getByLabelText("Name"), "Staging SSH");
    await user.type(within(dialog).getByLabelText("Host address"), "203.0.113.20");
    const portInput = within(dialog).getByLabelText("Port");
    await user.clear(portInput);
    await user.type(portInput, "2222");
    await user.type(within(dialog).getByLabelText("Username"), "deploy");
    await selectInputOption(user, within(dialog).getByLabelText("Group"), "group-1");
    const favoriteToggle = within(dialog).getByLabelText("Add to favorites");
    expect(favoriteToggle.closest("label")).toHaveClass("ui-toggle-row");
    await user.click(favoriteToggle);
    await user.click(within(dialog).getByRole("button", { name: "Create host" }));

    await waitFor(() =>
      expect(createHostMock).toHaveBeenCalledWith({
        name: "Staging SSH",
        group_id: "group-1",
        host: "203.0.113.20",
        port: 2222,
        username: "deploy",
        auth_type: "password",
        is_favorite: true,
        credential_id: null
      })
    );
    await waitFor(() => expect(listHostsMock).toHaveBeenCalledTimes(2));
    expect(onHostSaved).toHaveBeenCalledWith(createdHost);
    expect(await screen.findByText("Host created.")).toBeInTheDocument();
  });

  it("toggles a host favorite from the host card", async () => {
    updateHostMock.mockResolvedValue({
      host: {
        ...host,
        is_favorite: true
      }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<HostsPage />);

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add to favorites" }));

    await waitFor(() =>
      expect(updateHostMock).toHaveBeenCalledWith("host-1", {
        is_favorite: true
      })
    );
    expect(await screen.findByText("Added to favorites.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove favorite" })).toBeInTheDocument();
  });

  it("switches group management between list, create, and edit modes", async () => {
    createHostGroupMock.mockResolvedValue({
      group: {
        id: "group-2",
        user_id: "user-1",
        name: "Database",
        sort_order: 1,
        created_at: "2026-04-30T00:00:00Z",
        updated_at: "2026-04-30T00:00:00Z"
      }
    });
    updateHostGroupMock.mockResolvedValue({
      group: {
        ...hostGroupList.items[0],
        name: "Ops updated"
      }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<HostsPage />);

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage groups" }));

    let dialog = await screen.findByRole("dialog", { name: "Manage host groups" });
    await user.click(within(dialog).getByRole("button", { name: "New group" }));

    dialog = await screen.findByRole("dialog", { name: "New group" });
    expect(within(dialog).queryByLabelText("Sort order")).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Group name"), "Database");
    await user.click(within(dialog).getByRole("button", { name: "Create group" }));

    await waitFor(() =>
      expect(createHostGroupMock).toHaveBeenCalledWith({
        name: "Database",
        sort_order: 1
      })
    );
    expect(await screen.findByRole("dialog", { name: "Manage host groups" })).toBeInTheDocument();

    dialog = screen.getByRole("dialog", { name: "Manage host groups" });
    const editGroupButton = within(dialog).getByRole("button", { name: "Edit" });
    const deleteGroupButton = within(dialog).getByRole("button", { name: "Delete" });
    expect(editGroupButton).toHaveClass("ui-inline-icon-button");
    expect(editGroupButton).not.toHaveClass("ui-icon-button");
    expect(deleteGroupButton).toHaveClass("ui-inline-icon-button-danger");
    await user.click(editGroupButton);

    dialog = await screen.findByRole("dialog", { name: "Edit group" });
    const nameInput = within(dialog).getByLabelText("Group name");
    await user.clear(nameInput);
    await user.type(nameInput, "Ops updated");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateHostGroupMock).toHaveBeenCalledWith("group-1", {
        name: "Ops updated",
        sort_order: 0
      })
    );
    expect(await screen.findByRole("dialog", { name: "Manage host groups" })).toBeInTheDocument();
  });

  it("reorders groups by dragging them in the group manager", async () => {
    listHostGroupsMock.mockResolvedValue({
      items: [
        hostGroupList.items[0],
        {
          id: "group-2",
          user_id: "user-1",
          name: "Database",
          sort_order: 1,
          created_at: "2026-04-30T00:00:00Z",
          updated_at: "2026-04-30T00:00:00Z"
        }
      ]
    });
    updateHostGroupMock.mockResolvedValue({ group: hostGroupList.items[0] });

    const user = userEvent.setup();
    renderWithPageProviders(<HostsPage />);

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage groups" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage host groups" });
    const opsItem = within(dialog).getByText("Ops").closest("article") as HTMLElement;
    const databaseItem = within(dialog).getByText("Database").closest("article") as HTMLElement;
    const transferStore = new Map<string, string>();
    const dataTransfer = {
      dropEffect: "",
      effectAllowed: "",
      setData(type: string, value: string) {
        transferStore.set(type, value);
      },
      getData(type: string) {
        return transferStore.get(type) || "";
      }
    };

    fireEvent.dragStart(databaseItem, { dataTransfer });
    fireEvent.dragOver(opsItem, { dataTransfer });
    fireEvent.drop(opsItem, { dataTransfer });

    await waitFor(() =>
      expect(updateHostGroupMock).toHaveBeenCalledWith("group-2", {
        name: "Database",
        sort_order: 0
      })
    );
    expect(updateHostGroupMock).toHaveBeenCalledWith("group-1", {
      name: "Ops",
      sort_order: 1
    });
  });
});
