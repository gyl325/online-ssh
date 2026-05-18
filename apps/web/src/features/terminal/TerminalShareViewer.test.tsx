import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithPreferences } from "../../test/renderWithProviders";
import { TerminalShareViewer } from "./TerminalShareViewer";

const terminalMocks = vi.hoisted(() => ({
  terminals: [] as Array<{
    loadAddon: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    writeln: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    options: Record<string, unknown>;
  }>
}));

const websocketMocks = vi.hoisted(() => ({
  instances: [] as MockWebSocket[]
}));

vi.mock("xterm", () => ({
  Terminal: vi.fn().mockImplementation(function MockTerminal(options: Record<string, unknown>) {
    const terminal = {
      loadAddon: vi.fn(),
      open: vi.fn(),
      write: vi.fn((_data: string, callback?: () => void) => callback?.()),
      writeln: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      focus: vi.fn(),
      dispose: vi.fn(),
      options
    };
    terminalMocks.terminals.push(terminal);
    return terminal;
  })
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(function MockFitAddon() {
    return {
      fit: vi.fn()
    };
  })
}));

class MockWebSocket extends EventTarget {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  url: string;
  protocol: string;

  constructor(url: string, protocol: string) {
    super();
    this.url = url;
    this.protocol = protocol;
    websocketMocks.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }
}

describe("TerminalShareViewer", () => {
  beforeEach(() => {
    terminalMocks.terminals.length = 0;
    websocketMocks.instances.length = 0;
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("ResizeObserver", class {
      observe = vi.fn();
      disconnect = vi.fn();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders a read-only websocket viewer without registering terminal input handlers", () => {
    renderWithPreferences(
      <TerminalShareViewer
        active
        protocol="terminal-share.v1"
        websocketUrl="ws://app.example.com/ws/terminal/share?viewer_token=viewer-token"
      />
    );

    expect(terminalMocks.terminals).toHaveLength(1);
    expect(terminalMocks.terminals[0].onData).not.toHaveBeenCalled();
  });

  it("maps revoked exits to localized state without writing raw system lines", () => {
    const onStateChange = vi.fn();
    renderWithPreferences(
      <TerminalShareViewer
        active
        onStateChange={onStateChange}
        protocol="terminal-share.v1"
        websocketUrl="ws://app.example.com/ws/terminal/share?viewer_token=viewer-token"
      />
    );

    websocketMocks.instances[0].dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({
        type: "exit",
        status: "disconnected",
        message: "terminal share revoked",
        runtime_closed: false
      })
    }));

    expect(onStateChange).toHaveBeenCalledWith({
      status: "disconnected",
      message: "Terminal share was revoked by the owner."
    });
    expect(terminalMocks.terminals[0].writeln).not.toHaveBeenCalledWith(
      expect.stringContaining("terminal share revoked")
    );
  });

  it("emits updated share expiry from ready and share update events", () => {
    const onStateChange = vi.fn();
    renderWithPreferences(
      <TerminalShareViewer
        active
        onStateChange={onStateChange}
        protocol="terminal-share.v1"
        websocketUrl="ws://app.example.com/ws/terminal/share?viewer_token=viewer-token"
      />
    );

    websocketMocks.instances[0].dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({
        type: "ready",
        session_id: "session-1",
        host_id: "host-1",
        status: "connected",
        protocol: "terminal-share.v1",
        readonly: true,
        share_id: "share-1",
        expires_at: "2026-05-09T10:10:00Z"
      })
    }));
    websocketMocks.instances[0].dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({
        type: "share_update",
        share_id: "share-1",
        expires_at: "2026-05-09T10:30:00Z"
      })
    }));

    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({
      status: "connected",
      expiresAt: "2026-05-09T10:10:00Z"
    }));
    expect(onStateChange).toHaveBeenCalledWith({
      expiresAt: "2026-05-09T10:30:00Z"
    });
  });
});
