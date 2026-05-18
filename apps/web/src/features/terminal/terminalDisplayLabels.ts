type DuplicateTerminalLabelItem = {
  id: string;
  hostId: string;
  hostLabel: string;
};

export type DuplicateTerminalLabelState = {
  hostIdByItemId: Map<string, string>;
  indexByItemId: Map<string, number>;
  nextIndexByHostId: Map<string, number>;
};

export function createDuplicateTerminalLabelState(): DuplicateTerminalLabelState {
  return {
    hostIdByItemId: new Map(),
    indexByItemId: new Map(),
    nextIndexByHostId: new Map()
  };
}

function baseTerminalLabel(label: string) {
  return label.replace(/\s+\(\d+\)$/, "");
}

export function assignDuplicateTerminalLabels<T extends DuplicateTerminalLabelItem>(
  items: T[],
  state: DuplicateTerminalLabelState
): T[] {
  const activeIds = new Set(items.map((item) => item.id));
  const releasedIndexesByHostId = new Map<string, number[]>();
  for (const itemId of Array.from(state.indexByItemId.keys())) {
    if (!activeIds.has(itemId)) {
      const hostId = state.hostIdByItemId.get(itemId);
      const index = state.indexByItemId.get(itemId);
      if (hostId && index !== undefined) {
        releasedIndexesByHostId.set(hostId, [
          ...(releasedIndexesByHostId.get(hostId) || []),
          index
        ]);
      }
      state.indexByItemId.delete(itemId);
      state.hostIdByItemId.delete(itemId);
    }
  }

  const activeHostIds = new Set(items.map((item) => item.hostId));
  for (const hostId of Array.from(state.nextIndexByHostId.keys())) {
    if (!activeHostIds.has(hostId)) {
      state.nextIndexByHostId.delete(hostId);
    }
  }

  for (const item of items) {
    const previousHostId = state.hostIdByItemId.get(item.id);
    if (previousHostId !== item.hostId) {
      state.indexByItemId.delete(item.id);
    }
    if (!state.indexByItemId.has(item.id)) {
      const releasedIndexes = releasedIndexesByHostId.get(item.hostId) || [];
      const nextIndex = releasedIndexes.length > 0
        ? Math.min(...releasedIndexes)
        : state.nextIndexByHostId.get(item.hostId) || 0;
      releasedIndexesByHostId.set(item.hostId, releasedIndexes.filter((index) => index !== nextIndex));
      state.indexByItemId.set(item.id, nextIndex);
      state.nextIndexByHostId.set(item.hostId, Math.max(state.nextIndexByHostId.get(item.hostId) || 0, nextIndex + 1));
    }
    state.hostIdByItemId.set(item.id, item.hostId);
  }

  return items.map((item) => {
    const index = state.indexByItemId.get(item.id) || 0;
    const baseLabel = baseTerminalLabel(item.hostLabel);
    return {
      ...item,
      hostLabel: index > 0 ? `${baseLabel} (${index})` : baseLabel
    };
  });
}
