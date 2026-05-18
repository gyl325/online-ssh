import { describe, expect, it } from "vitest";

import {
  buildTerminalWorkspaceSnapshot,
  chooseRestoredTerminalActiveTab,
  createTerminalSnapshotSessionMap,
  terminalSessionSnapshotFromTab,
  type TerminalSnapshotTabLike
} from "./terminalWorkspaceSnapshot";

const connectedTab: TerminalSnapshotTabLike = {
  hostId: "host-1",
  hostLabel: "Prod SSH",
  id: "tab-1",
  rows: 36,
  cols: 120,
  sessionId: "session-1",
  startedAt: "2026-04-24T12:00:00Z",
  status: "connected",
  keepAliveUntil: "2026-04-25T12:00:00Z"
};

describe("terminal workspace snapshot helpers", () => {
  it("serializes only recoverable terminal tabs into session snapshots", () => {
    expect(terminalSessionSnapshotFromTab(connectedTab)).toEqual({
      session_id: "session-1",
      host_id: "host-1",
      host_label: "Prod SSH",
      rows: 36,
      cols: 120,
      started_at: "2026-04-24T12:00:00Z",
      keep_alive_until: "2026-04-25T12:00:00Z"
    });

    expect(terminalSessionSnapshotFromTab({ ...connectedTab, status: "failed" })).toBeNull();
    expect(terminalSessionSnapshotFromTab({ ...connectedTab, status: "disconnected" })).toBeNull();
    expect(terminalSessionSnapshotFromTab({ ...connectedTab, runtimeClosed: true })).toBeNull();
    expect(terminalSessionSnapshotFromTab({ ...connectedTab, sessionId: "" })).toBeNull();
  });

  it("builds a full workspace snapshot with unique open hosts and the current active session", () => {
    const next = buildTerminalWorkspaceSnapshot([
      connectedTab,
      {
        ...connectedTab,
        id: "tab-2",
        sessionId: "session-2",
        hostId: "host-1",
        keepAliveUntil: null
      },
      {
        ...connectedTab,
        id: "tab-3",
        sessionId: "session-3",
        hostId: "host-2",
        status: "failed"
      }
    ], "tab-2");

    expect(next.open_host_ids).toEqual(["host-1"]);
    expect(next.active_host_id).toBe("host-1");
    expect(next.active_session_id).toBe("session-2");
    expect(next.sessions.map((session) => session.session_id)).toEqual(["session-1", "session-2"]);
  });

  it("indexes persisted session snapshots by session id", () => {
    const snapshot = buildTerminalWorkspaceSnapshot([connectedTab], "tab-1");

    expect(createTerminalSnapshotSessionMap(snapshot.sessions).get("session-1")).toEqual(snapshot.sessions[0]);
  });

  it("chooses the restored active tab by active session, then active host, then first tab", () => {
    const tabs = [
      { id: "tab-1", sessionId: "session-1", hostId: "host-1" },
      { id: "tab-2", sessionId: "session-2", hostId: "host-2" }
    ];

    expect(chooseRestoredTerminalActiveTab(tabs, {
      open_host_ids: [],
      active_host_id: "host-2",
      active_session_id: "session-1",
      sessions: []
    })?.id).toBe("tab-1");

    expect(chooseRestoredTerminalActiveTab(tabs, {
      open_host_ids: [],
      active_host_id: "host-2",
      active_session_id: "missing",
      sessions: []
    })?.id).toBe("tab-2");

    expect(chooseRestoredTerminalActiveTab(tabs, {
      open_host_ids: [],
      active_host_id: "missing",
      active_session_id: "missing",
      sessions: []
    })?.id).toBe("tab-1");

    expect(chooseRestoredTerminalActiveTab([], {
      open_host_ids: [],
      active_host_id: "host-1",
      active_session_id: "session-1",
      sessions: []
    })).toBeNull();
  });
});
