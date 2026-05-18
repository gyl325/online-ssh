import { describe, expect, it } from "vitest";

import type { FileEntry, FileListResponse } from "./types";
import {
  createHomeFileHostContext,
  createIdleFileHostContext,
  nextFileDirectoryErrorState,
  nextFileDirectoryLoadingState,
  nextFileNavigationHistory,
  removeFileHostContext,
  shouldLoadFileHostContextDirectory,
  upsertFileHostContext
} from "./fileHostContext";

const entry: FileEntry = {
  name: "notes.txt",
  path: "/root/notes.txt",
  entry_type: "file",
  size_bytes: 128,
  permissions: "-rw-r--r--",
  modified_at: "2026-04-24T12:00:00Z",
  is_hidden: false
};

const directory: FileListResponse = {
  host_id: "host-1",
  path: "/root",
  items: [entry],
  next_cursor: null
};

describe("file host context model", () => {
  it("creates idle contexts from snapshots and host home paths", () => {
    expect(createIdleFileHostContext()).toEqual({
      currentPath: "/",
      directory: null,
      directoryErrorMessage: null,
      directoryState: "idle",
      navigationHistory: { back: [], forward: [] },
      searchKeyword: "",
      selectedEntry: null
    });
    expect(createIdleFileHostContext({ currentPath: "/var/log", searchKeyword: "nginx" })).toMatchObject({
      currentPath: "/var/log",
      searchKeyword: "nginx"
    });
    expect(createHomeFileHostContext({ username: "root" })).toMatchObject({ currentPath: "/root" });
    expect(createHomeFileHostContext({ username: "deploy" })).toMatchObject({ currentPath: "/home/deploy" });
  });

  it("identifies contexts that need a directory load", () => {
    expect(shouldLoadFileHostContextDirectory(createIdleFileHostContext())).toBe(true);
    expect(shouldLoadFileHostContextDirectory({ ...createIdleFileHostContext(), directoryState: "error" })).toBe(true);
    expect(shouldLoadFileHostContextDirectory({ ...createIdleFileHostContext(), directoryState: "loading" })).toBe(true);
    expect(shouldLoadFileHostContextDirectory({
      ...createIdleFileHostContext(),
      directory,
      directoryState: "ready"
    })).toBe(false);
  });

  it("keeps directory navigation history behavior stable", () => {
    expect(nextFileNavigationHistory({ back: [], forward: [] }, "/root", "/root/logs")).toEqual({
      back: ["/root"],
      forward: []
    });
    expect(nextFileNavigationHistory({ back: ["/root"], forward: [] }, "/root/logs", "/root", "back")).toEqual({
      back: [],
      forward: ["/root/logs"]
    });
    expect(nextFileNavigationHistory({ back: [], forward: ["/root/logs"] }, "/root", "/root/logs", "forward")).toEqual({
      back: ["/root"],
      forward: []
    });
    expect(nextFileNavigationHistory({ back: ["/root"], forward: ["/tmp"] }, "/root", "/root", "replace")).toEqual({
      back: ["/root"],
      forward: ["/tmp"]
    });
  });

  it("updates the context map immutably", () => {
    const firstContext = createIdleFileHostContext({ currentPath: "/root" });
    const secondContext = createIdleFileHostContext({ currentPath: "/home/deploy" });
    const contexts = upsertFileHostContext({}, "host-1", firstContext);
    const nextContexts = upsertFileHostContext(contexts, "host-2", secondContext);

    expect(contexts).toEqual({ "host-1": firstContext });
    expect(nextContexts).toEqual({ "host-1": firstContext, "host-2": secondContext });
    expect(removeFileHostContext(nextContexts, "host-1")).toEqual({ "host-2": secondContext });
  });

  it("models directory loading transitions without page state", () => {
    const current = {
      ...createIdleFileHostContext(),
      directory,
      directoryState: "ready" as const,
      selectedEntry: entry
    };

    expect(nextFileDirectoryLoadingState(current, "")).toMatchObject({
      directory: null,
      directoryState: "idle",
      selectedEntry: null
    });
    expect(nextFileDirectoryLoadingState(current, "host-1")).toMatchObject({
      directory,
      directoryState: "loading",
      selectedEntry: null
    });
    expect(nextFileDirectoryErrorState(current, false)).toMatchObject({
      directory: null,
      directoryState: "error"
    });
    expect(nextFileDirectoryErrorState(current, true)).toMatchObject({
      directory,
      directoryState: "ready"
    });
    expect(nextFileDirectoryErrorState(createIdleFileHostContext(), true)).toMatchObject({
      directory: null,
      directoryState: "error"
    });
  });
});
