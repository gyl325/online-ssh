import { describe, expect, it } from "vitest";

import {
  assignDuplicateTerminalLabels,
  createDuplicateTerminalLabelState
} from "./terminalDisplayLabels";

describe("terminal display labels", () => {
  it("keeps duplicate suffixes stable when a middle terminal closes", () => {
    const state = createDuplicateTerminalLabelState();

    const initial = assignDuplicateTerminalLabels([
      { id: "tab-1", hostId: "host-1", hostLabel: "主机" },
      { id: "tab-2", hostId: "host-1", hostLabel: "主机" },
      { id: "tab-3", hostId: "host-1", hostLabel: "主机" }
    ], state);

    expect(initial.map((tab) => tab.hostLabel)).toEqual(["主机", "主机 (1)", "主机 (2)"]);

    const afterClosingMiddle = assignDuplicateTerminalLabels([
      { id: "tab-1", hostId: "host-1", hostLabel: "主机" },
      { id: "tab-3", hostId: "host-1", hostLabel: "主机" }
    ], state);

    expect(afterClosingMiddle.map((tab) => tab.hostLabel)).toEqual(["主机", "主机 (2)"]);
  });

  it("resets numbering after all terminals for a host close", () => {
    const state = createDuplicateTerminalLabelState();

    assignDuplicateTerminalLabels([
      { id: "tab-1", hostId: "host-1", hostLabel: "Prod SSH" },
      { id: "tab-2", hostId: "host-1", hostLabel: "Prod SSH" }
    ], state);
    assignDuplicateTerminalLabels([], state);

    const reopened = assignDuplicateTerminalLabels([
      { id: "tab-3", hostId: "host-1", hostLabel: "Prod SSH" },
      { id: "tab-4", hostId: "host-1", hostLabel: "Prod SSH" }
    ], state);

    expect(reopened.map((tab) => tab.hostLabel)).toEqual(["Prod SSH", "Prod SSH (1)"]);
  });

  it("reuses the pending tab suffix when a creating tab becomes a session tab", () => {
    const state = createDuplicateTerminalLabelState();

    expect(assignDuplicateTerminalLabels([
      { id: "pending-tab", hostId: "host-1", hostLabel: "Prod SSH" }
    ], state).map((tab) => tab.hostLabel)).toEqual(["Prod SSH"]);

    expect(assignDuplicateTerminalLabels([
      { id: "session-1", hostId: "host-1", hostLabel: "Prod SSH" }
    ], state).map((tab) => tab.hostLabel)).toEqual(["Prod SSH"]);
  });
});
