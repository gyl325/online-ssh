import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PreferencesProvider, usePreferences } from "../preferences/PreferencesContext";
import { TerminalPane } from "./TerminalPane";
import { authUnauthorizedEvent } from "../../shared/api/http";
import stylesCss from "../../styles.css?raw";

const terminalMocks = vi.hoisted(() => ({
  terminals: [] as Array<any>,
  fitAddons: [] as Array<{
    fit: ReturnType<typeof vi.fn>;
  }>
}));

vi.mock("xterm", () => ({
  Terminal: vi.fn().mockImplementation(function MockTerminal(options) {
    const writeParsedListeners = new Set<() => void>();
    const renderListeners = new Set<(event: { start: number; end: number }) => void>();
    const scrollListeners = new Set<(viewportY: number) => void>();
    const lines = new Map<number, string>([[0, ""]]);
    let markerId = 0;
    const activeBuffer = {
      type: "normal" as "normal" | "alternate",
      cursorY: 0,
      cursorX: 0,
      viewportY: 0,
      baseY: 0,
      length: 1,
      getLine: vi.fn((line: number) => {
        const value = lines.get(line);
        if (value === undefined) {
          return undefined;
        }
        return {
          isWrapped: false,
          length: value.length,
          translateToString: vi.fn(() => value)
        };
      })
    };
    const terminal = {
      loadAddon: vi.fn(),
      open: vi.fn(),
      writeln: vi.fn(),
      refresh: vi.fn(),
      write: vi.fn((data: string, callback?: () => void) => {
        lines.set(0, data);
        activeBuffer.length = Math.max(activeBuffer.length, 1);
        callback?.();
        writeParsedListeners.forEach((listener) => listener());
      }),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      resize: vi.fn((cols: number, rows: number) => {
        terminal.cols = cols;
        terminal.rows = rows;
      }),
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
      focus: vi.fn(),
      dispose: vi.fn(),
      clearTextureAtlas: vi.fn(),
      registerMarker: vi.fn((offset = 0) => ({
        id: markerId++,
        line: activeBuffer.baseY + activeBuffer.cursorY + offset,
        isDisposed: false,
        onDispose: vi.fn(),
        dispose: vi.fn()
      })),
      registerDecoration: vi.fn((decorationOptions: { marker: { line: number } }) => {
        const decoration = {
          marker: decorationOptions.marker,
          element: undefined,
          isDisposed: false,
          onDispose: vi.fn(),
          onRender: vi.fn(),
          options: {},
          dispose: vi.fn()
        };
        terminal.decorations.push(decoration);
        return decoration;
      }),
      emitRender: (start: number, end: number) => renderListeners.forEach((listener) => listener({ start, end })),
      setBufferType: (type: "normal" | "alternate") => {
        activeBuffer.type = type;
      },
      decorations: [] as Array<{ dispose: ReturnType<typeof vi.fn> }>,
      rows: 36,
      cols: 120,
      buffer: {
        active: activeBuffer
      },
      _core: {
        _charSizeService: {
          measure: vi.fn()
        }
      },
      options
    };
    terminalMocks.terminals.push(terminal);
    return terminal;
  })
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(function MockFitAddon() {
    const addon = {
      fit: vi.fn()
    };
    terminalMocks.fitAddons.push(addon);
    return addon;
  })
}));

class MockWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  static initialReadyState = MockWebSocket.OPEN;

  binaryType = "";
  readyState = MockWebSocket.initialReadyState;
  send = vi.fn();

  constructor(
    public url: string,
    public protocol: string
  ) {
    super();
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  emitControlEvent(payload: unknown) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify(payload)
      })
    );
  }

  emitOutput(text: string) {
    const payload = new TextEncoder().encode(text);
    const data = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
    this.dispatchEvent(
      new MessageEvent("message", {
        data
      })
    );
  }
}

function Wrapper({ children }: PropsWithChildren) {
  return <PreferencesProvider>{children}</PreferencesProvider>;
}

function renderPane(onStateChange = vi.fn(), onOpenConnectionInfo?: () => void) {
  render(
    <TerminalPane
      active
      connectionInfoLabel="Connection info"
      protocol="terminal.v1"
      sessionId="session-1"
      websocketUrl="ws://example.test/ws/terminal?session_id=session-1"
      onStateChange={onStateChange}
      onOpenConnectionInfo={onOpenConnectionInfo}
    />,
    { wrapper: Wrapper }
  );
  return onStateChange;
}

function FontSizeChangeHarness() {
  const { setTerminalFontSize } = usePreferences();
  const [active, setActive] = useState(false);

  return (
    <>
      <button onClick={() => setTerminalFontSize(18)} type="button">Increase font size</button>
      <button onClick={() => setActive(true)} type="button">Return to terminal</button>
      <TerminalPane
        active={active}
        protocol="terminal.v1"
        sessionId="session-1"
        websocketUrl="ws://example.test/ws/terminal?session_id=session-1"
        onStateChange={vi.fn()}
      />
    </>
  );
}

describe("TerminalPane", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.clearAllMocks();
    terminalMocks.terminals.length = 0;
    terminalMocks.fitAddons.length = 0;
    MockWebSocket.instances.length = 0;
    MockWebSocket.initialReadyState = MockWebSocket.OPEN;
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
  });

  afterEach(() => {
    document.documentElement.removeAttribute("style");
    vi.unstubAllGlobals();
    if (originalWebSocket) {
      vi.stubGlobal("WebSocket", originalWebSocket);
    }
  });

  it("reads xterm colors from CSS theme tokens", async () => {
    document.documentElement.style.setProperty("--xterm-background", "#123456");
    document.documentElement.style.setProperty("--xterm-foreground", "#abcdef");
    document.documentElement.style.setProperty("--xterm-cursor", "#fedcba");
    document.documentElement.style.setProperty("--xterm-selection-background", "#2563eb");
    document.documentElement.style.setProperty("--xterm-selection-foreground", "#ffffff");

    renderPane();

    await waitFor(() => expect(terminalMocks.terminals).toHaveLength(1));
    expect(terminalMocks.terminals[0].options.theme).toMatchObject({
      background: "#123456",
      foreground: "#abcdef",
      cursor: "#fedcba",
      selectionBackground: "#2563eb",
      selectionForeground: "#ffffff"
    });
  });

  it("uses the terminal font size from user preferences", async () => {
    window.localStorage.setItem("online-ssh-terminal-font-size", "16");

    renderPane();

    await waitFor(() => expect(terminalMocks.terminals).toHaveLength(1));
    expect(terminalMocks.terminals[0].options.fontSize).toBe(16);
  });

  it("refreshes existing terminal layout after a font-size change when returning to the terminal", async () => {
    const user = userEvent.setup();

    render(<FontSizeChangeHarness />, { wrapper: Wrapper });

    await waitFor(() => expect(terminalMocks.terminals).toHaveLength(1));
    const surface = document.querySelector(".terminal-surface") as HTMLElement;
    Object.defineProperty(surface, "offsetWidth", { configurable: true, value: 720 });
    Object.defineProperty(surface, "offsetHeight", { configurable: true, value: 360 });
    Object.defineProperty(surface, "clientWidth", { configurable: true, value: 720 });
    Object.defineProperty(surface, "clientHeight", { configurable: true, value: 360 });

    const terminal = terminalMocks.terminals[0];
    const fitAddon = terminalMocks.fitAddons[0];
    terminal.refresh.mockClear();
    fitAddon.fit.mockClear();
    terminal._core._charSizeService.measure.mockClear();
    terminal.clearTextureAtlas.mockClear();

    await user.click(screen.getByRole("button", { name: "Increase font size" }));

    await waitFor(() => expect(terminal.options.fontSize).toBe(18));
    expect(terminal.refresh).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Return to terminal" }));

    await waitFor(() => expect(terminal._core._charSizeService.measure).toHaveBeenCalled());
    await waitFor(() => expect(fitAddon.fit).toHaveBeenCalled());
    await waitFor(() => expect(terminal.refresh).toHaveBeenCalledWith(0, terminal.rows - 1));
    expect(terminal.clearTextureAtlas).toHaveBeenCalled();
    expect(terminal._core._charSizeService.measure.mock.invocationCallOrder[0]).toBeLessThan(
      fitAddon.fit.mock.invocationCallOrder[0]
    );
    expect(terminalMocks.terminals).toHaveLength(1);
  });

  it("uses the selected ecosystem terminal theme from user preferences", async () => {
    window.localStorage.setItem("online-ssh-terminal-theme", "dracula");

    renderPane();

    await waitFor(() => expect(terminalMocks.terminals).toHaveLength(1));
    expect(terminalMocks.terminals[0].options.theme).toMatchObject({
      background: "#1e1f29",
      foreground: "#f8f8f2",
      cursor: "#bbbbbb"
    });
  });

  it("wraps a selected dark terminal theme in a matching surface frame", async () => {
    window.localStorage.setItem("online-ssh-theme", "light");
    window.localStorage.setItem("online-ssh-terminal-theme", "dracula");

    renderPane();

    await waitFor(() => expect(terminalMocks.terminals).toHaveLength(1));
    const frame = document.querySelector(".terminal-surface-frame") as HTMLElement;

    expect(frame).toHaveClass("terminal-surface-frame-dark");
    expect(frame).toHaveStyle({ "--terminal-surface-background": "#1e1f29" });
  });

  it("enables xterm decorations and clears highlights when the session changes", async () => {
    window.localStorage.setItem(
      "online-ssh-terminal-highlighting",
      JSON.stringify({
        version: 1,
        enabled: true,
        builtinRules: {},
        customRules: [
          {
            id: "custom-error",
            name: "Custom error",
            enabled: true,
            matchType: "keyword",
            pattern: "error",
            caseSensitive: false,
            foregroundColor: "#ffffff",
            backgroundColor: "#7f1d1d",
            priority: 10
          }
        ]
      })
    );

    const view = render(
      <TerminalPane
        active
        protocol="terminal.v1"
        sessionId="session-1"
        websocketUrl="ws://example.test/ws/terminal?session_id=session-1"
        onStateChange={vi.fn()}
      />,
      { wrapper: Wrapper }
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(terminalMocks.terminals[0].options.allowProposedApi).toBe(true);
    MockWebSocket.instances[0].emitOutput("error: denied");

    await waitFor(() => expect(terminalMocks.terminals[0].registerDecoration).toHaveBeenCalled());
    const firstDecoration = terminalMocks.terminals[0].decorations[0];

    view.rerender(
      <TerminalPane
        active
        protocol="terminal.v1"
        sessionId="session-2"
        websocketUrl="ws://example.test/ws/terminal?session_id=session-2"
        onStateChange={vi.fn()}
      />
    );

    await waitFor(() => expect(terminalMocks.terminals).toHaveLength(2));
    expect(firstDecoration.dispose).toHaveBeenCalledTimes(1);
  });

  it("reports connected state when a ready event is received", async () => {
    const onStateChange = renderPane();

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    MockWebSocket.instances[0].emitControlEvent({
      type: "ready",
      session_id: "session-1",
      host_id: "host-1",
      status: "connected",
      protocol: "terminal.v1",
      attached: true,
      detached_at: null,
      expires_at: "2026-04-25T12:00:00Z",
      keep_alive_until: "2026-04-25T12:00:00Z",
      fingerprint: {
        algorithm: "ssh-ed25519",
        fingerprint: "SHA256:current-fingerprint",
        status: "trusted"
      }
    });

    await waitFor(() =>
      expect(onStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "connected",
          message: "Terminal connected",
          attached: true,
          expiresAt: "2026-04-25T12:00:00Z",
          keepAliveUntil: "2026-04-25T12:00:00Z",
          fingerprint: {
            algorithm: "ssh-ed25519",
            fingerprint: "SHA256:current-fingerprint",
            status: "trusted"
          }
        })
      )
    );
  });

  it("does not write routine lifecycle messages into the terminal buffer", async () => {
    const onStateChange = renderPane();

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(terminalMocks.terminals[0].writeln).not.toHaveBeenCalledWith(
      expect.stringContaining("terminal bootstrap requested")
    );

    MockWebSocket.instances[0].emitControlEvent({
      type: "ready",
      session_id: "session-1",
      host_id: "host-1",
      status: "connected",
      protocol: "terminal.v1",
      attached: true,
      detached_at: null,
      expires_at: "2026-04-25T12:00:00Z",
      keep_alive_until: "2026-04-25T12:00:00Z",
      fingerprint: null
    });

    await waitFor(() => expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ status: "connected" })));
    expect(terminalMocks.terminals[0].writeln).not.toHaveBeenCalledWith(
      expect.stringContaining("session ready")
    );
  });

  it("reports failed state when an error event is received", async () => {
    const onStateChange = renderPane();

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    MockWebSocket.instances[0].emitControlEvent({
      type: "error",
      code: "SSH_AUTH_FAILED",
      message: "Authentication failed"
    });

    await waitFor(() =>
      expect(onStateChange).toHaveBeenCalledWith({
        status: "failed",
        message: "SSH authentication failed. Check the username, password, or key."
      })
    );
  });

  it("requests reconnect when an exit event leaves the runtime open", async () => {
    const onStateChange = renderPane();

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    MockWebSocket.instances[0].emitControlEvent({
      type: "exit",
      status: "disconnected",
      message: "network interrupted",
      runtime_closed: false
    });

    await waitFor(() =>
      expect(onStateChange).toHaveBeenCalledWith({
        status: "reconnecting",
        message: "network interrupted",
        closeOnNormalExit: false,
        reconnectRequested: true,
        runtimeClosed: false
      })
    );
  });

  it("does not reconnect a detached terminal after the auth session is revoked elsewhere", async () => {
    const onStateChange = renderPane();

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    MockWebSocket.instances[0].emitControlEvent({
      type: "exit",
      status: "disconnected",
      message: "account signed in elsewhere",
      runtime_closed: false
    });

    await waitFor(() =>
      expect(onStateChange).toHaveBeenCalledWith({
        status: "disconnected",
        message: "account signed in elsewhere",
        closeOnNormalExit: false,
        reconnectRequested: false,
        runtimeClosed: false
      })
    );
  });

  it("dispatches auth unauthorized and suppresses raw terminal system lines after the auth session is revoked elsewhere", async () => {
    const onUnauthorized = vi.fn();
    window.addEventListener(authUnauthorizedEvent, onUnauthorized);

    try {
      renderPane();

      await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      MockWebSocket.instances[0].emitControlEvent({
        type: "exit",
        status: "disconnected",
        message: "account signed in elsewhere",
        runtime_closed: false
      });
      MockWebSocket.instances[0].close();

      await waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1));
      const event = onUnauthorized.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual({ reason: "session_revoked" });
      expect(terminalMocks.terminals[0].writeln).not.toHaveBeenCalledWith(
        expect.stringContaining("session exit: account signed in elsewhere")
      );
      expect(terminalMocks.terminals[0].writeln).not.toHaveBeenCalledWith(
        expect.stringContaining("websocket closed")
      );
    } finally {
      window.removeEventListener(authUnauthorizedEvent, onUnauthorized);
    }
  });

  it("requests tab close on a normal exit event", async () => {
    const onStateChange = renderPane();

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    MockWebSocket.instances[0].emitControlEvent({
      type: "exit",
      status: "disconnected",
      message: "ssh session ended",
      runtime_closed: true
    });

    await waitFor(() =>
      expect(onStateChange).toHaveBeenCalledWith({
        status: "disconnected",
        message: "ssh session ended",
        closeOnNormalExit: true,
        reconnectRequested: false,
        runtimeClosed: true
      })
    );
  });

  it("freezes the xterm surface size while pane resize is suspended", async () => {
    const view = render(
      <TerminalPane
        active
        protocol="terminal.v1"
        resizeSuspended={false}
        sessionId="session-1"
        websocketUrl="ws://example.test/ws/terminal?session_id=session-1"
        onStateChange={vi.fn()}
      />,
      { wrapper: Wrapper }
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const surface = document.querySelector(".terminal-surface") as HTMLElement;
    Object.defineProperty(surface, "clientWidth", { configurable: true, value: 720 });
    Object.defineProperty(surface, "clientHeight", { configurable: true, value: 360 });

    view.rerender(
      <TerminalPane
        active
        protocol="terminal.v1"
        resizeSuspended
        sessionId="session-1"
        websocketUrl="ws://example.test/ws/terminal?session_id=session-1"
        onStateChange={vi.fn()}
      />
    );

    expect(surface).toHaveStyle({ width: "720px", height: "360px" });
  });

  it("sends narrow resize events using the normalized xterm size", async () => {
    render(
      <TerminalPane
        active
        protocol="terminal.v1"
        sessionId="session-1"
        websocketUrl="ws://example.test/ws/terminal?session_id=session-1"
        onStateChange={vi.fn()}
      />,
      { wrapper: Wrapper }
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const surface = document.querySelector(".terminal-surface") as HTMLElement;
    Object.defineProperty(surface, "offsetWidth", { configurable: true, value: 320 });
    Object.defineProperty(surface, "offsetHeight", { configurable: true, value: 300 });
    Object.defineProperty(surface, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(surface, "clientHeight", { configurable: true, value: 300 });
    const terminal = terminalMocks.terminals[0];
    terminal.rows = 20;
    terminal.cols = 42;

    MockWebSocket.instances[0].emitControlEvent({
      type: "ready",
      session_id: "session-1",
      host_id: "host-1",
      status: "connected",
      protocol: "terminal.v1",
      attached: true,
      detached_at: null,
      expires_at: null,
      keep_alive_until: null,
      fingerprint: null
    });

    expect(terminal.resize).not.toHaveBeenCalledWith(80, 20);
    await waitFor(() =>
      expect(MockWebSocket.instances[0].send).toHaveBeenCalledWith(expect.stringContaining("\"type\":\"resize\""))
    );
    expect(MockWebSocket.instances[0].send).toHaveBeenCalledWith(expect.stringContaining("\"cols\":42"));
  });

  it("sends the fitted size after websocket open even when it was measured while connecting", async () => {
    MockWebSocket.initialReadyState = MockWebSocket.CONNECTING;

    const view = render(
      <TerminalPane
        active={false}
        protocol="terminal.v1"
        sessionId="session-1"
        websocketUrl="ws://example.test/ws/terminal?session_id=session-1"
        onStateChange={vi.fn()}
      />,
      { wrapper: Wrapper }
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const surface = document.querySelector(".terminal-surface") as HTMLElement;
    Object.defineProperty(surface, "offsetWidth", { configurable: true, value: 320 });
    Object.defineProperty(surface, "offsetHeight", { configurable: true, value: 300 });
    Object.defineProperty(surface, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(surface, "clientHeight", { configurable: true, value: 300 });
    const terminal = terminalMocks.terminals[0];
    terminal.rows = 20;
    terminal.cols = 42;

    view.rerender(
      <TerminalPane
        active
        protocol="terminal.v1"
        sessionId="session-1"
        websocketUrl="ws://example.test/ws/terminal?session_id=session-1"
        onStateChange={vi.fn()}
      />
    );

    await waitFor(() => expect(terminalMocks.fitAddons[0].fit).toHaveBeenCalled());
    expect(MockWebSocket.instances[0].send).not.toHaveBeenCalled();

    MockWebSocket.instances[0].open();

    await waitFor(() =>
      expect(MockWebSocket.instances[0].send).toHaveBeenCalledWith(expect.stringContaining("\"type\":\"resize\""))
    );
    expect(MockWebSocket.instances[0].send).toHaveBeenCalledWith(expect.stringContaining("\"cols\":42"));
    expect(MockWebSocket.instances[0].send).toHaveBeenCalledWith(expect.stringContaining("\"rows\":20"));
  });

  it("keeps pane header status chips on one line in narrow columns", () => {
    expect(stylesCss).toContain(".terminal-pane-header-main .terminal-status {");
    expect(stylesCss).toContain("white-space: nowrap;");
    expect(stylesCss).toContain("text-overflow: ellipsis;");
  });

  it("shows hover-revealed terminal controls and requests fullscreen for the terminal frame", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const onOpenConnectionInfo = vi.fn();
    const user = userEvent.setup();

    renderPane(vi.fn(), onOpenConnectionInfo);

    const fullscreenButton = await screen.findByRole("button", { name: "Enter terminal fullscreen" });
    const connectionInfoButton = screen.getByRole("button", { name: "Connection info" });
    const frame = fullscreenButton.closest(".terminal-surface-frame") as HTMLElement | null;
    expect(frame).toBeTruthy();
    Object.defineProperty(frame, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen
    });

    await user.click(connectionInfoButton);
    expect(onOpenConnectionInfo).toHaveBeenCalledTimes(1);

    await user.click(fullscreenButton);

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(stylesCss).toContain(".terminal-surface-actions");
    expect(stylesCss).toContain(".terminal-surface-frame:hover .terminal-surface-actions");
    expect(stylesCss).not.toContain(".terminal-surface-frame:focus-within .terminal-surface-actions");
    expect(stylesCss).toContain(".terminal-surface-frame-light .terminal-surface-action");
    expect(stylesCss).toContain(".terminal-surface-frame-dark .terminal-surface-action");
    expect(stylesCss).toContain("opacity: 0;");
    expect(stylesCss).toContain("opacity: 1;");
  });
});
