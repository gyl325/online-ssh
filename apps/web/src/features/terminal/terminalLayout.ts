export type TerminalSplitDirection = "vertical" | "horizontal";

export type TerminalSplitLayoutNode =
  | {
    type: "leaf";
    tabId: string;
  }
  | {
    type: "split";
    direction: TerminalSplitDirection;
    ratio: number;
    children: [TerminalSplitLayoutNode, TerminalSplitLayoutNode];
  };

export type TerminalDropZone = "left" | "right" | "top" | "bottom";

export type TerminalPaneRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type TerminalLayoutSplitter = {
  direction: TerminalSplitDirection;
  path: number[];
  ratio: number;
  rect: TerminalPaneRect;
};

export type TerminalDropTarget =
  | {
    tabId: string;
    zone: TerminalDropZone;
    rect: TerminalPaneRect;
  }
  | {
    tabId: null;
    zone: null;
    rect: TerminalPaneRect;
  };

const maxTerminalSplitPanes = 16;
const minimumTerminalPaneWidth = 260;

export function clampSplitRatio(value: number) {
  return Math.max(0.2, Math.min(0.8, value));
}

export function formatSplitRatio(value: number) {
  return String(Math.round(clampSplitRatio(value) * 100) / 100);
}

export function isTerminalSplitLayoutNode(value: unknown): value is TerminalSplitLayoutNode {
  if (!value || typeof value !== "object") {
    return false;
  }
  const node = value as Partial<TerminalSplitLayoutNode>;
  if (node.type === "leaf") {
    return typeof node.tabId === "string" && node.tabId.length > 0;
  }
  if (node.type !== "split") {
    return false;
  }
  const splitNode = node as Partial<Extract<TerminalSplitLayoutNode, { type: "split" }>>;
  return (
    (splitNode.direction === "vertical" || splitNode.direction === "horizontal") &&
    typeof splitNode.ratio === "number" &&
    Array.isArray(splitNode.children) &&
    splitNode.children.length === 2 &&
    splitNode.children.every(isTerminalSplitLayoutNode)
  );
}

function leafNode(tabId: string): TerminalSplitLayoutNode {
  return {
    type: "leaf",
    tabId
  };
}

export function terminalLayoutLeafIds(node: TerminalSplitLayoutNode | null): string[] {
  if (!node) {
    return [];
  }
  if (node.type === "leaf") {
    return [node.tabId];
  }
  return node.children.flatMap(terminalLayoutLeafIds);
}

function terminalLayoutLeafCount(node: TerminalSplitLayoutNode | null) {
  return terminalLayoutLeafIds(node).length;
}

export function terminalLayoutSignature(node: TerminalSplitLayoutNode | null) {
  return terminalLayoutLeafIds(node).slice().sort().join("\n");
}

export function normalizeTerminalLayouts(layouts: Array<TerminalSplitLayoutNode | null>): TerminalSplitLayoutNode[] {
  const seen = new Set<string>();
  const normalized: TerminalSplitLayoutNode[] = [];
  layouts.forEach((layout) => {
    if (terminalLayoutLeafCount(layout) <= 1) {
      return;
    }
    const signature = terminalLayoutSignature(layout);
    if (!signature || seen.has(signature)) {
      return;
    }
    seen.add(signature);
    normalized.push(layout as TerminalSplitLayoutNode);
  });
  return normalized;
}

export function terminalLayoutsEqual(left: TerminalSplitLayoutNode[], right: TerminalSplitLayoutNode[]) {
  return (
    left.length === right.length &&
    left.every((layout, index) => JSON.stringify(layout) === JSON.stringify(right[index]))
  );
}

export function pruneTerminalLayout(
  node: TerminalSplitLayoutNode | null,
  validTabIds: Set<string>
): TerminalSplitLayoutNode | null {
  if (!node) {
    return null;
  }
  if (node.type === "leaf") {
    return validTabIds.has(node.tabId) ? node : null;
  }
  const first = pruneTerminalLayout(node.children[0], validTabIds);
  const second = pruneTerminalLayout(node.children[1], validTabIds);
  if (first && second) {
    return {
      ...node,
      ratio: clampSplitRatio(node.ratio),
      children: [first, second]
    };
  }
  return first || second;
}

export function removeTabFromTerminalLayout(
  node: TerminalSplitLayoutNode | null,
  tabId: string
): TerminalSplitLayoutNode | null {
  if (!node) {
    return null;
  }
  if (node.type === "leaf") {
    return node.tabId === tabId ? null : node;
  }
  const first = removeTabFromTerminalLayout(node.children[0], tabId);
  const second = removeTabFromTerminalLayout(node.children[1], tabId);
  if (first && second) {
    return {
      ...node,
      children: [first, second]
    };
  }
  return first || second;
}

function splitDirectionFromDropZone(zone: TerminalDropZone): TerminalSplitDirection | null {
  if (zone === "left" || zone === "right") {
    return "vertical";
  }
  if (zone === "top" || zone === "bottom") {
    return "horizontal";
  }
  return null;
}

function createSplitForDrop(
  targetTabId: string,
  draggingTabId: string,
  zone: TerminalDropZone
): TerminalSplitLayoutNode | null {
  const direction = splitDirectionFromDropZone(zone);
  if (!direction || targetTabId === draggingTabId) {
    return null;
  }
  const dragging = leafNode(draggingTabId);
  const target = leafNode(targetTabId);
  return {
    type: "split",
    direction,
    ratio: 0.5,
    children: zone === "left" || zone === "top" ? [dragging, target] : [target, dragging]
  };
}

function insertSplitAtLeaf(
  node: TerminalSplitLayoutNode,
  targetTabId: string,
  draggingTabId: string,
  zone: TerminalDropZone
): TerminalSplitLayoutNode {
  if (node.type === "leaf") {
    return node.tabId === targetTabId
      ? createSplitForDrop(targetTabId, draggingTabId, zone) || node
      : node;
  }
  return {
    ...node,
    children: [
      insertSplitAtLeaf(node.children[0], targetTabId, draggingTabId, zone),
      insertSplitAtLeaf(node.children[1], targetTabId, draggingTabId, zone)
    ]
  };
}

export function updateSplitRatioAtPath(
  node: TerminalSplitLayoutNode | null,
  path: number[],
  ratio: number
): TerminalSplitLayoutNode | null {
  if (!node || node.type !== "split") {
    return node;
  }
  if (path.length === 0) {
    return {
      ...node,
      ratio: clampSplitRatio(ratio)
    };
  }
  const [head, ...rest] = path;
  return {
    ...node,
    children: [
      head === 0 ? updateSplitRatioAtPath(node.children[0], rest, ratio) || node.children[0] : node.children[0],
      head === 1 ? updateSplitRatioAtPath(node.children[1], rest, ratio) || node.children[1] : node.children[1]
    ]
  };
}

function splitNodeAtPath(node: TerminalSplitLayoutNode | null, path: number[]) {
  let current = node;
  for (const segment of path) {
    if (!current || current.type !== "split" || (segment !== 0 && segment !== 1)) {
      return null;
    }
    current = current.children[segment];
  }
  return current?.type === "split" ? current : null;
}

function sumSizes(values: number[]) {
  return values.reduce((sum, size) => sum + size, 0);
}

function terminalAxisSplitGroupCount(
  node: TerminalSplitLayoutNode | null,
  direction: TerminalSplitDirection
): number {
  if (!node) {
    return 0;
  }
  if (node.type === "leaf" || node.direction !== direction) {
    return 1;
  }
  return (
    terminalAxisSplitGroupCount(node.children[0], direction) +
    terminalAxisSplitGroupCount(node.children[1], direction)
  );
}

function terminalAxisSplitGroupSizes(
  node: TerminalSplitLayoutNode,
  direction: TerminalSplitDirection,
  availableSize: number
): number[] {
  if (node.type === "leaf" || node.direction !== direction) {
    return [availableSize];
  }
  const ratio = clampSplitRatio(node.ratio);
  const firstSize = availableSize * ratio;
  const secondSize = availableSize - firstSize;
  return [
    ...terminalAxisSplitGroupSizes(node.children[0], direction, firstSize),
    ...terminalAxisSplitGroupSizes(node.children[1], direction, secondSize)
  ];
}

function terminalAxisSplitBoundaryResize(
  node: TerminalSplitLayoutNode,
  direction: TerminalSplitDirection,
  availableSize: number,
  ratio: number
): { ratio: number; sizes: number[] } | null {
  if (node.type !== "split") {
    return null;
  }
  const groupSizes = terminalAxisSplitGroupSizes(node, direction, availableSize);
  const firstGroupCount = terminalAxisSplitGroupCount(node.children[0], direction);
  const leftBoundaryIndex = firstGroupCount - 1;
  const rightBoundaryIndex = firstGroupCount;
  if (leftBoundaryIndex < 0 || rightBoundaryIndex >= groupSizes.length) {
    return null;
  }
  const totalSize = sumSizes(groupSizes);
  const leftFixedSize = sumSizes(groupSizes.slice(0, leftBoundaryIndex));
  const rightFixedSize = sumSizes(groupSizes.slice(rightBoundaryIndex + 1));
  const adjustableSize = totalSize - leftFixedSize - rightFixedSize;
  if (totalSize <= 0 || adjustableSize <= 0) {
    return null;
  }
  const minGroupSize = minimumTerminalAxisResizeSize(direction, totalSize);
  const minBoundarySize = minGroupSize;
  const maxLeftBoundarySize = adjustableSize - minGroupSize;
  if (maxLeftBoundarySize < minBoundarySize) {
    return null;
  }
  const desiredLeftTotalSize = ratio * totalSize;
  const nextLeftBoundarySize = Math.max(
    minBoundarySize,
    Math.min(maxLeftBoundarySize, desiredLeftTotalSize - leftFixedSize)
  );
  const nextSizes = [...groupSizes];
  nextSizes[leftBoundaryIndex] = nextLeftBoundarySize;
  nextSizes[rightBoundaryIndex] = adjustableSize - nextLeftBoundarySize;
  const nextRatio = (leftFixedSize + nextLeftBoundarySize) / totalSize;
  return { ratio: nextRatio, sizes: nextSizes };
}

function minimumTerminalAxisResizeSize(direction: TerminalSplitDirection, totalSize: number) {
  const ratioMinimum = totalSize * 0.2;
  return direction === "vertical"
    ? Math.max(minimumTerminalPaneWidth, ratioMinimum)
    : ratioMinimum;
}

function rebuildTerminalAxisSplitLayout(
  node: TerminalSplitLayoutNode,
  direction: TerminalSplitDirection,
  sizes: number[]
): TerminalSplitLayoutNode {
  if (node.type === "leaf" || node.direction !== direction) {
    return node;
  }
  const firstGroupCount = terminalAxisSplitGroupCount(node.children[0], direction);
  const firstSizes = sizes.slice(0, firstGroupCount);
  const secondSizes = sizes.slice(firstGroupCount);
  const firstTotal = sumSizes(firstSizes);
  const secondTotal = sumSizes(secondSizes);
  const total = firstTotal + secondTotal;
  if (total <= 0) {
    return node;
  }
  return {
    ...node,
    ratio: clampSplitRatio(firstTotal / total),
    children: [
      rebuildTerminalAxisSplitLayout(node.children[0], direction, firstSizes),
      rebuildTerminalAxisSplitLayout(node.children[1], direction, secondSizes)
    ]
  };
}

function replaceTerminalLayoutSubtreeAtPath(
  node: TerminalSplitLayoutNode | null,
  path: number[],
  replacement: TerminalSplitLayoutNode | null
): TerminalSplitLayoutNode | null {
  if (!node || node.type !== "split") {
    return node;
  }
  if (path.length === 0) {
    return replacement || node;
  }
  const [head, ...rest] = path;
  return {
    ...node,
    children: [
      head === 0
        ? replaceTerminalLayoutSubtreeAtPath(node.children[0], rest, replacement) || node.children[0]
        : node.children[0],
      head === 1
        ? replaceTerminalLayoutSubtreeAtPath(node.children[1], rest, replacement) || node.children[1]
        : node.children[1]
    ]
  };
}

export function resizeTerminalLayoutAtPath(
  layout: TerminalSplitLayoutNode | null,
  path: number[],
  ratio: number,
  availableSize: number
): TerminalSplitLayoutNode | null {
  const splitNode = splitNodeAtPath(layout, path);
  if (!splitNode) {
    return updateSplitRatioAtPath(layout, path, ratio);
  }
  const clampedRatio = clampSplitRatioForMinimumWidth(layout, path, ratio, availableSize);
  const resized = terminalAxisSplitBoundaryResize(splitNode, splitNode.direction, availableSize, clampedRatio);
  if (!resized) {
    return layout;
  }
  return replaceTerminalLayoutSubtreeAtPath(
    layout,
    path,
    rebuildTerminalAxisSplitLayout(splitNode, splitNode.direction, resized.sizes)
  );
}

export function clampSplitRatioForMinimumWidth(
  layout: TerminalSplitLayoutNode | null,
  path: number[],
  ratio: number,
  availableWidth: number
) {
  const splitNode = splitNodeAtPath(layout, path);
  if (!splitNode || availableWidth <= 0) {
    return clampSplitRatio(ratio);
  }
  const resized = terminalAxisSplitBoundaryResize(splitNode, splitNode.direction, availableWidth, ratio);
  if (resized) {
    return resized.ratio;
  }
  return clampSplitRatio(ratio);
}

export function rectFromDropZone(rect: TerminalPaneRect, zone: TerminalDropZone): TerminalPaneRect {
  switch (zone) {
    case "left":
      return {
        ...rect,
        width: rect.width / 2
      };
    case "right":
      return {
        ...rect,
        left: rect.left + rect.width / 2,
        width: rect.width / 2
      };
    case "top":
      return {
        ...rect,
        height: rect.height / 2
      };
    case "bottom":
      return {
        ...rect,
        top: rect.top + rect.height / 2,
        height: rect.height / 2
      };
  }
}

export function terminalLayoutGeometry(
  node: TerminalSplitLayoutNode | null,
  rect: TerminalPaneRect = { left: 0, top: 0, width: 100, height: 100 },
  path: number[] = []
) {
  const panes = new Map<string, TerminalPaneRect>();
  const splitters: TerminalLayoutSplitter[] = [];

  const walk = (current: TerminalSplitLayoutNode | null, currentRect: TerminalPaneRect, currentPath: number[]) => {
    if (!current) {
      return;
    }
    if (current.type === "leaf") {
      panes.set(current.tabId, currentRect);
      return;
    }

    const ratio = clampSplitRatio(current.ratio);
    splitters.push({
      direction: current.direction,
      path: currentPath,
      ratio,
      rect: currentRect
    });
    if (current.direction === "vertical") {
      const firstWidth = currentRect.width * ratio;
      walk(current.children[0], {
        ...currentRect,
        width: firstWidth
      }, [...currentPath, 0]);
      walk(current.children[1], {
        left: currentRect.left + firstWidth,
        top: currentRect.top,
        width: currentRect.width - firstWidth,
        height: currentRect.height
      }, [...currentPath, 1]);
      return;
    }

    const firstHeight = currentRect.height * ratio;
    walk(current.children[0], {
      ...currentRect,
      height: firstHeight
    }, [...currentPath, 0]);
    walk(current.children[1], {
      left: currentRect.left,
      top: currentRect.top + firstHeight,
      width: currentRect.width,
      height: currentRect.height - firstHeight
    }, [...currentPath, 1]);
  };

  walk(node, rect, path);
  return { panes, splitters };
}

function canDropIntoTerminalLayout(
  layout: TerminalSplitLayoutNode | null,
  draggingTabId: string
) {
  const draggingWasInLayout = terminalLayoutLeafIds(layout).includes(draggingTabId);
  const withoutDragging = removeTabFromTerminalLayout(layout, draggingTabId);
  if (!draggingWasInLayout && terminalLayoutLeafCount(withoutDragging) >= maxTerminalSplitPanes) {
    return false;
  }
  return true;
}

export function terminalLayoutFitsGridLimit(layout: TerminalSplitLayoutNode | null) {
  const { panes } = terminalLayoutGeometry(layout);
  if (panes.size === 0 || panes.size > maxTerminalSplitPanes) {
    return false;
  }
  const paneRects = Array.from(panes.values());
  const pointsAlong = (axis: "x" | "y") => {
    const edges = new Set<number>();
    paneRects.forEach((rect) => {
      if (axis === "x") {
        edges.add(rect.left);
        edges.add(rect.left + rect.width);
      } else {
        edges.add(rect.top);
        edges.add(rect.top + rect.height);
      }
    });
    const sortedEdges = Array.from(edges).sort((left, right) => left - right);
    return sortedEdges.slice(0, -1).flatMap((edge, index) => {
      const nextEdge = sortedEdges[index + 1];
      return nextEdge > edge ? [(edge + nextEdge) / 2] : [];
    });
  };
  const containsPoint = (start: number, size: number, point: number) => {
    const roundedStart = Math.round(start * 1000);
    const roundedEnd = Math.round((start + size) * 1000);
    const roundedPoint = Math.round(point * 1000);
    return roundedPoint >= roundedStart && roundedPoint < roundedEnd;
  };
  const maxColumnsInAnyRow = Math.max(
    0,
    ...pointsAlong("y").map((point) => (
      paneRects.filter((rect) => containsPoint(rect.top, rect.height, point)).length
    ))
  );
  const maxRowsInAnyColumn = Math.max(
    0,
    ...pointsAlong("x").map((point) => (
      paneRects.filter((rect) => containsPoint(rect.left, rect.width, point)).length
    ))
  );
  return maxColumnsInAnyRow <= 4 && maxRowsInAnyColumn <= 4;
}

export function createDropLayout(
  layout: TerminalSplitLayoutNode | null,
  targetTabId: string,
  draggingTabId: string,
  zone: TerminalDropZone
) {
  const withoutDragging = removeTabFromTerminalLayout(layout, draggingTabId);
  if (!withoutDragging) {
    return createSplitForDrop(targetTabId, draggingTabId, zone);
  }
  if (!terminalLayoutLeafIds(withoutDragging).includes(targetTabId)) {
    return createSplitForDrop(targetTabId, draggingTabId, zone);
  }
  return insertSplitAtLeaf(withoutDragging, targetTabId, draggingTabId, zone);
}

export function canCreateDropLayout(
  layout: TerminalSplitLayoutNode | null,
  targetTabId: string,
  draggingTabId: string,
  zone: TerminalDropZone
) {
  if (!canDropIntoTerminalLayout(layout, draggingTabId)) {
    return false;
  }
  const next = createDropLayout(layout, targetTabId, draggingTabId, zone);
  return terminalLayoutFitsGridLimit(next);
}
