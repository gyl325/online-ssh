import { describe, expect, it } from "vitest";

import {
  createDropLayout,
  formatSplitRatio,
  isTerminalSplitLayoutNode,
  normalizeTerminalLayouts,
  resizeTerminalLayoutAtPath,
  terminalLayoutFitsGridLimit,
  terminalLayoutGeometry,
  terminalLayoutLeafIds,
  type TerminalSplitDirection,
  type TerminalSplitLayoutNode
} from "./terminalLayout";

function leaf(tabId: string): TerminalSplitLayoutNode {
  return { type: "leaf", tabId };
}

function split(
  direction: TerminalSplitDirection,
  ratio: number,
  children: [TerminalSplitLayoutNode, TerminalSplitLayoutNode]
): TerminalSplitLayoutNode {
  return {
    type: "split",
    direction,
    ratio,
    children
  };
}

describe("terminal split layout helpers", () => {
  it("validates persisted split layout nodes and clamps display ratios", () => {
    expect(isTerminalSplitLayoutNode(split("vertical", 0.5, [leaf("a"), leaf("b")]))).toBe(true);
    expect(isTerminalSplitLayoutNode({ type: "split", direction: "diagonal", ratio: 0.5, children: [] })).toBe(false);
    expect(formatSplitRatio(0.123)).toBe("0.2");
    expect(formatSplitRatio(0.678)).toBe("0.68");
    expect(formatSplitRatio(0.95)).toBe("0.8");
  });

  it("normalizes persisted workspaces by dropping singles and duplicate tab signatures", () => {
    const first = split("vertical", 0.5, [leaf("a"), leaf("b")]);
    const duplicate = split("horizontal", 0.6, [leaf("b"), leaf("a")]);
    const second = split("horizontal", 0.5, [leaf("c"), leaf("d")]);

    expect(normalizeTerminalLayouts([leaf("solo"), first, duplicate, null, second])).toEqual([first, second]);
  });

  it("detaches an existing pane before inserting it at the new drop target", () => {
    const layout = split("vertical", 0.5, [
      leaf("left"),
      split("horizontal", 0.5, [leaf("dragging"), leaf("bottom")])
    ]);

    const next = createDropLayout(layout, "left", "dragging", "right");

    expect(terminalLayoutLeafIds(next)).toEqual(["left", "dragging", "bottom"]);
    expect(terminalLayoutGeometry(next).panes.get("dragging")).toEqual({
      left: 25,
      top: 0,
      width: 25,
      height: 100
    });
  });

  it("resizes mixed-layout boundaries while preserving non-adjacent axis groups", () => {
    const layout = split("vertical", 0.5, [
      leaf("a"),
      split("vertical", 0.5, [leaf("b"), leaf("c")])
    ]);

    const next = resizeTerminalLayoutAtPath(layout, [], 0.4, 1000);
    const panes = terminalLayoutGeometry(next).panes;

    expect(panes.get("a")).toEqual({ left: 0, top: 0, width: 40, height: 100 });
    expect(panes.get("b")).toEqual({ left: 40, top: 0, width: 35, height: 100 });
    expect(panes.get("c")).toEqual({ left: 75, top: 0, width: 25, height: 100 });
  });

  it("checks the 4x4 grid limit by cross-section rather than total spans", () => {
    const fourColumns = split("vertical", 0.25, [
      leaf("a"),
      split("vertical", 1 / 3, [
        leaf("b"),
        split("vertical", 0.5, [leaf("c"), leaf("d")])
      ])
    ]);
    const fiveColumns = split("vertical", 0.2, [
      leaf("a"),
      split("vertical", 0.25, [
        leaf("b"),
        split("vertical", 1 / 3, [
          leaf("c"),
          split("vertical", 0.5, [leaf("d"), leaf("e")])
        ])
      ])
    ]);

    expect(terminalLayoutFitsGridLimit(fourColumns)).toBe(true);
    expect(terminalLayoutFitsGridLimit(fiveColumns)).toBe(false);
  });
});
