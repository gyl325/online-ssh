import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as hostApi from "./api";
import type { Host } from "./types";
import { useHostCatalog } from "./useHostCatalog";

vi.mock("./api", () => ({
  listHosts: vi.fn()
}));

const listHostsMock = vi.mocked(hostApi.listHosts);

function createDeferredHostList() {
  let resolve!: (value: { items: Host[]; page: number; page_size: number; total: number }) => void;
  const promise = new Promise<{ items: Host[]; page: number; page_size: number; total: number }>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function host(overrides: Partial<Host> = {}): Host {
  return {
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
    updated_at: "2026-04-24T00:00:00Z",
    ...overrides
  };
}

describe("useHostCatalog", () => {
  beforeEach(() => {
    listHostsMock.mockReset();
  });

  it("returns hosts and clears loading after loadHosts succeeds", async () => {
    const hosts = [host(), host({ id: "host-2", name: "Backup SSH", host: "10.0.0.2" })];
    listHostsMock.mockResolvedValue({
      items: hosts,
      page: 1,
      page_size: 100,
      total: hosts.length
    });

    const formatLoadError = vi.fn();

    const { result } = renderHook(() => useHostCatalog({ formatLoadError }));

    expect(result.current.hostsLoading).toBe(true);
    await waitFor(() => expect(result.current.hostsLoading).toBe(false));
    expect(result.current.hosts).toEqual(hosts);
    expect(result.current.hostsErrorMessage).toBeNull();
  });

  it("formats load failures, clears hosts, and records the error message", async () => {
    const error = new Error("request failed");
    const formatLoadError = vi.fn().mockReturnValue("Could not load hosts");
    listHostsMock.mockRejectedValue(error);

    const { result } = renderHook(() => useHostCatalog({ formatLoadError }));

    await waitFor(() => expect(result.current.hostsLoading).toBe(false));
    expect(formatLoadError).toHaveBeenCalledWith(error);
    expect(result.current.hosts).toEqual([]);
    expect(result.current.hostsErrorMessage).toBe("Could not load hosts");
  });

  it("upserts hosts by updating existing entries, prepending new entries, and clearing transient state", async () => {
    const prodHost = host();
    const backupHost = host({ id: "host-2", name: "Backup SSH", host: "10.0.0.2" });
    listHostsMock.mockRejectedValue(new Error("request failed"));

    const formatLoadError = vi.fn().mockReturnValue("Could not load hosts");

    const { result } = renderHook(() => useHostCatalog({ formatLoadError }));

    await waitFor(() => expect(result.current.hostsErrorMessage).toBe("Could not load hosts"));

    await act(async () => {
      result.current.upsertHostInCatalog(prodHost);
      result.current.upsertHostInCatalog({ ...prodHost, name: "Prod SSH Updated" });
      result.current.upsertHostInCatalog(backupHost);
    });

    expect(result.current.hosts).toEqual([backupHost, { ...prodHost, name: "Prod SSH Updated" }]);
    expect(result.current.hostsErrorMessage).toBeNull();
    expect(result.current.hostsLoading).toBe(false);
  });

  it("preserves locally upserted hosts when the initial host load resolves later", async () => {
    const initialLoad = createDeferredHostList();
    const prodHost = host();
    const stagingHost = host({
      id: "host-3",
      credential_id: null,
      name: "Staging SSH",
      host: "203.0.113.20",
      username: "deploy"
    });
    listHostsMock.mockReturnValue(initialLoad.promise);

    const formatLoadError = vi.fn();
    const { result } = renderHook(() => useHostCatalog({ formatLoadError }));

    await act(async () => {
      result.current.upsertHostInCatalog(stagingHost);
    });
    expect(result.current.hosts).toEqual([stagingHost]);

    await act(async () => {
      initialLoad.resolve({
        items: [prodHost],
        page: 1,
        page_size: 100,
        total: 1
      });
    });

    await waitFor(() => expect(result.current.hostsLoading).toBe(false));
    expect(result.current.hosts).toEqual([stagingHost, prodHost]);
  });
});
