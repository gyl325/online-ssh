import { describe, expect, it, vi } from "vitest";

import { TerminalHighlightManager } from "./TerminalHighlightManager";
import {
  builtinTerminalHighlightRules,
  defaultTerminalHighlightPreferences,
  type TerminalHighlightCustomRule,
  type TerminalHighlightPreferences
} from "./highlighting";

function customRule(overrides: Partial<TerminalHighlightCustomRule> = {}): TerminalHighlightCustomRule {
  return {
    id: overrides.id || "custom-error",
    name: overrides.name || "Custom error",
    enabled: overrides.enabled ?? true,
    matchType: overrides.matchType || "keyword",
    pattern: overrides.pattern || "error",
    caseSensitive: overrides.caseSensitive ?? false,
    foregroundColor: overrides.foregroundColor || "#ffffff",
    backgroundColor: overrides.backgroundColor || "#7f1d1d",
    priority: overrides.priority ?? 10
  };
}

function preferences(customRules: TerminalHighlightCustomRule[]): TerminalHighlightPreferences {
  return {
    ...defaultTerminalHighlightPreferences,
    builtinRules: Object.fromEntries(builtinTerminalHighlightRules.map((rule) => [rule.id, { enabled: false }])),
    customRules,
    enabled: true
  };
}

function createFakeTerminal() {
  const writeParsedListeners = new Set<() => void>();
  const renderListeners = new Set<(event: { start: number; end: number }) => void>();
  const scrollListeners = new Set<(viewportY: number) => void>();
  const disposedDecorations: Array<ReturnType<typeof vi.fn>> = [];
  const lines = new Map<number, string>([[0, "error denied"], [1, "ok done"]]);
  let markerId = 0;

  const activeBuffer = {
    type: "normal" as "normal" | "alternate",
    cursorY: 0,
    cursorX: 0,
    viewportY: 0,
    baseY: 0,
    length: 2,
    getLine: vi.fn((line: number) => {
      const value = lines.get(line);
      if (value === undefined) {
        return undefined;
      }
      return {
        length: value.length,
        isWrapped: false,
        translateToString: vi.fn(() => value)
      };
    })
  };

  const terminal = {
    rows: 24,
    cols: 120,
    buffer: {
      active: activeBuffer
    },
    onWriteParsed: vi.fn((listener: () => void) => {
      writeParsedListeners.add(listener);
      return { dispose: vi.fn(() => writeParsedListeners.delete(listener)) };
    }),
    onRender: vi.fn((listener: (event: { start: number; end: number }) => void) => {
      renderListeners.add(listener);
      return { dispose: vi.fn(() => renderListeners.delete(listener)) };
    }),
    onScroll: vi.fn((listener: (viewportY: number) => void) => {
      scrollListeners.add(listener);
      return { dispose: vi.fn(() => scrollListeners.delete(listener)) };
    }),
    registerMarker: vi.fn((offset = 0) => ({
      id: markerId++,
      line: activeBuffer.baseY + activeBuffer.cursorY + offset,
      isDisposed: false,
      onDispose: vi.fn(),
      dispose: vi.fn()
    })),
    registerDecoration: vi.fn((options: { marker: { line: number } }) => {
      const decoration = {
        marker: options.marker,
        element: undefined,
        isDisposed: false,
        onDispose: vi.fn(),
        onRender: vi.fn(),
        options: {},
        dispose: vi.fn(() => {
          disposedDecorations.push(decoration.dispose);
        })
      };
      return decoration;
    }),
    emitWriteParsed() {
      writeParsedListeners.forEach((listener) => listener());
    },
    emitRender(start: number, end: number) {
      renderListeners.forEach((listener) => listener({ start, end }));
    },
    setBufferType(type: "normal" | "alternate") {
      activeBuffer.type = type;
    },
    setLine(line: number, value: string) {
      lines.set(line, value);
      activeBuffer.length = Math.max(activeBuffer.length, line + 1);
    },
    disposedDecorations
  };

  return terminal;
}

describe("TerminalHighlightManager", () => {
  it("caches decorations by line and disposes old decorations before refreshing", () => {
    const terminal = createFakeTerminal();
    const manager = new TerminalHighlightManager(terminal, preferences([customRule()]));

    manager.refreshLines([0]);
    const firstDecoration = terminal.registerDecoration.mock.results[0].value;
    terminal.setLine(0, "error failed");
    manager.refreshLines([0]);

    expect(firstDecoration.dispose).toHaveBeenCalledTimes(1);
    expect(terminal.registerDecoration).toHaveBeenCalledTimes(2);
    expect(manager.getDecorationCount()).toBe(1);
  });

  it("clears decorations when a rule is deleted", () => {
    const terminal = createFakeTerminal();
    const manager = new TerminalHighlightManager(terminal, preferences([customRule()]));

    manager.refreshLines([0]);
    const firstDecoration = terminal.registerDecoration.mock.results[0].value;
    manager.updatePreferences(preferences([]));

    expect(firstDecoration.dispose).toHaveBeenCalledTimes(1);
    expect(manager.getDecorationCount()).toBe(0);
  });

  it("pauses and clears highlights while the alternate buffer is active", () => {
    const terminal = createFakeTerminal();
    const manager = new TerminalHighlightManager(terminal, preferences([customRule()]));

    manager.refreshLines([0]);
    const firstDecoration = terminal.registerDecoration.mock.results[0].value;
    terminal.setBufferType("alternate");
    manager.refreshViewport();

    expect(firstDecoration.dispose).toHaveBeenCalledTimes(1);
    expect(terminal.registerDecoration).toHaveBeenCalledTimes(1);
    expect(manager.getDecorationCount()).toBe(0);
  });

  it("refreshes only local cursor and viewport ranges from xterm events", () => {
    const terminal = createFakeTerminal();
    terminal.setLine(20, "error at viewport edge");
    terminal.buffer.active.cursorY = 1;
    terminal.buffer.active.viewportY = 20;
    terminal.buffer.active.length = 80;
    const manager = new TerminalHighlightManager(terminal, preferences([customRule()]));

    terminal.emitWriteParsed();
    terminal.emitRender(0, 2);

    expect(manager.getScannedLineCount()).toBeLessThanOrEqual(80);
    expect(terminal.registerDecoration).toHaveBeenCalled();
  });

  it("falls back safely when registerDecoration is unavailable", () => {
    const terminal = createFakeTerminal();
    const unsafeTerminal = {
      ...terminal,
      registerDecoration: undefined
    };
    const manager = new TerminalHighlightManager(unsafeTerminal, preferences([customRule()]));

    expect(() => manager.refreshLines([0])).not.toThrow();
    expect(manager.getDecorationCount()).toBe(0);
  });

  it("omits decoration backgroundColor when a match uses transparent background", () => {
    const terminal = createFakeTerminal();
    const manager = new TerminalHighlightManager(terminal, preferences([
      customRule({ backgroundColor: "transparent" })
    ]));

    manager.refreshLines([0]);

    expect(terminal.registerDecoration.mock.calls[0]?.[0]).not.toHaveProperty("backgroundColor");
  });

  it("cleans every decoration and event listener on dispose", () => {
    const terminal = createFakeTerminal();
    const manager = new TerminalHighlightManager(terminal, preferences([customRule()]));

    manager.refreshLines([0, 1]);
    const decorations = terminal.registerDecoration.mock.results.map((result) => result.value);
    manager.dispose();

    for (const decoration of decorations) {
      expect(decoration.dispose).toHaveBeenCalledTimes(1);
    }
    expect(manager.getDecorationCount()).toBe(0);
  });
});
