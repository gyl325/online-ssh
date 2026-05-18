import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FileListResponse } from "./types";
import { useDirectoryListing } from "./useDirectoryListing";

function directory(path: string, fileName = "notes.txt"): FileListResponse {
  return {
    host_id: "host-1",
    path,
    items: [
      {
        name: fileName,
        path: `${path}/${fileName}`.replace("//", "/"),
        entry_type: "file",
        size_bytes: 128,
        permissions: "-rw-r--r--",
        modified_at: "2026-04-24T12:00:00Z",
        is_hidden: false
      }
    ],
    next_cursor: null
  };
}

describe("useDirectoryListing", () => {
  it("loads directories and updates navigation history", async () => {
    const loadDirectoryRequest = vi
      .fn()
      .mockResolvedValueOnce(directory("/root"))
      .mockResolvedValueOnce(directory("/root/logs", "app.log"))
      .mockResolvedValueOnce(directory("/root"))
      .mockResolvedValueOnce(directory("/root/logs", "app.log"));
    const onBeforeLoad = vi.fn();
    const onLoadError = vi.fn();

    const { result } = renderHook(() =>
      useDirectoryListing({
        activeHostId: "host-1",
        initialPath: "/root",
        loadDirectoryRequest,
        onBeforeLoad,
        onLoadError
      })
    );

    await act(async () => {
      await result.current.loadDirectory("/root", "host-1", { historyMode: "replace" });
    });
    expect(result.current.currentPath).toBe("/root");
    expect(result.current.directoryState).toBe("ready");
    expect(result.current.navigationHistory).toEqual({ back: [], forward: [] });

    await act(async () => {
      await result.current.loadDirectory("/root/logs", "host-1");
    });
    expect(result.current.currentPath).toBe("/root/logs");
    expect(result.current.directory?.items[0]?.name).toBe("app.log");
    expect(result.current.navigationHistory).toEqual({ back: ["/root"], forward: [] });

    await act(async () => {
      await result.current.goBackDirectory("host-1");
    });
    expect(result.current.currentPath).toBe("/root");
    expect(result.current.navigationHistory).toEqual({ back: [], forward: ["/root/logs"] });

    await act(async () => {
      await result.current.goForwardDirectory("host-1");
    });
    expect(result.current.currentPath).toBe("/root/logs");
    expect(result.current.navigationHistory).toEqual({ back: ["/root"], forward: [] });
    expect(onBeforeLoad).toHaveBeenCalledTimes(4);
    expect(onLoadError).not.toHaveBeenCalled();
  });

  it("preserves the previous directory on recoverable load errors", async () => {
    const error = new Error("load failed");
    const loadDirectoryRequest = vi
      .fn()
      .mockResolvedValueOnce(directory("/root"))
      .mockRejectedValueOnce(error);
    const onLoadError = vi.fn(() => "Could not load directory.");

    const { result } = renderHook(() =>
      useDirectoryListing({
        activeHostId: "host-1",
        initialPath: "/root",
        loadDirectoryRequest,
        onBeforeLoad: vi.fn(),
        onLoadError
      })
    );

    await act(async () => {
      await result.current.loadDirectory("/root", "host-1", { historyMode: "replace" });
    });
    await act(async () => {
      await result.current.loadDirectory("/missing", "host-1", { preserveOnError: true });
    });

    expect(result.current.currentPath).toBe("/root");
    expect(result.current.directoryState).toBe("ready");
    expect(result.current.directory?.path).toBe("/root");
    expect(onLoadError).toHaveBeenCalledWith(error);
    expect(result.current.directoryErrorMessage).toBe("Could not load directory.");
  });

  it("stores a visible error message for unrecoverable directory load failures and clears it on retry", async () => {
    const error = new Error("load failed");
    const loadDirectoryRequest = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(directory("/root"));
    const onLoadError = vi.fn(() => "Could not load directory.");

    const { result } = renderHook(() =>
      useDirectoryListing({
        activeHostId: "host-1",
        initialPath: "/root",
        loadDirectoryRequest,
        onBeforeLoad: vi.fn(),
        onLoadError
      })
    );

    await act(async () => {
      await result.current.loadDirectory("/root", "host-1", { historyMode: "replace" });
    });

    expect(result.current.directoryState).toBe("error");
    expect(result.current.directory).toBeNull();
    expect(result.current.directoryErrorMessage).toBe("Could not load directory.");

    await act(async () => {
      await result.current.loadDirectory("/root", "host-1", { historyMode: "replace" });
    });

    expect(result.current.directoryState).toBe("ready");
    expect(result.current.directoryErrorMessage).toBeNull();
  });

  it("uses the active host when callers do not pass a host id", async () => {
    const loadDirectoryRequest = vi.fn().mockResolvedValueOnce(directory("/root"));

    const { result } = renderHook(() =>
      useDirectoryListing({
        activeHostId: "host-1",
        initialPath: "/root",
        loadDirectoryRequest,
        onBeforeLoad: vi.fn(),
        onLoadError: vi.fn()
      })
    );

    await act(async () => {
      await result.current.loadDirectory("/root");
    });

    expect(loadDirectoryRequest).toHaveBeenCalledWith("host-1", "/root");
    expect(result.current.directoryState).toBe("ready");
  });
});
