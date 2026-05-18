import { FitAddon } from "@xterm/addon-fit";
import { Info, Maximize2, Minimize2 } from "lucide-react";
import { Terminal } from "xterm";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type Ref
} from "react";

import { usePreferences } from "../preferences/PreferencesContext";
import { IconButton } from "../../shared/ui";
import { authUnauthorizedEvent } from "../../shared/api/http";
import type {
  TerminalControlEvent,
  TerminalErrorEvent,
  TerminalExitEvent,
  TerminalPongEvent,
  TerminalReadyEvent
} from "./types";
import { terminalRuntimeErrorMessage } from "./errors";
import { TerminalHighlightManager } from "./TerminalHighlightManager";
import { terminalFontFamily, terminalThemeFor, terminalThemeTone } from "./theme";

type TerminalPaneStateUpdate = {
  status?: "connecting" | "connected" | "disconnected" | "failed" | "reconnecting";
  message?: string;
  closeOnNormalExit?: boolean;
  reconnectRequested?: boolean;
  runtimeClosed?: boolean;
  attached?: boolean | null;
  detachedAt?: string | null;
  expiresAt?: string | null;
  keepAliveUntil?: string | null;
  fingerprint?:
  | {
    algorithm: string;
    fingerprint: string;
    status: string;
  }
  | null;
};

export type TerminalPaneHandle = {
  sendInput: (text: string) => boolean;
  toggleBrowserFullscreen: () => void;
};

type TerminalPaneProps = {
  active: boolean;
  connectionInfoLabel?: string;
  protocol: string;
  resizeSuspended?: boolean;
  sessionId: string;
  showSurfaceActions?: boolean;
  websocketUrl: string;
  onActivity?: (kind: "input" | "output") => void;
  onInput?: (data: string) => void;
  onOpenConnectionInfo?: () => void;
  onStateChange: (update: TerminalPaneStateUpdate) => void;
  ref?: Ref<TerminalPaneHandle>;
};

function canResize(container: HTMLDivElement | null) {
  return Boolean(container && container.offsetWidth > 0 && container.offsetHeight > 0);
}

function writeSystemLine(terminalRef: MutableRefObject<Terminal | null>, text: string) {
  terminalRef.current?.writeln(`\r\n[system] ${text}`);
}

function remeasureTerminalFontMetrics(terminal: Terminal) {
  // xterm keeps the previous cell metrics when a font-size change is measured while hidden.
  const core = (terminal as unknown as {
    _core?: {
      _charSizeService?: {
        measure?: () => void;
      };
    };
  })._core;

  core?._charSizeService?.measure?.();
  terminal.clearTextureAtlas();
}

function normalizeTerminalSize(rows: number, cols: number) {
  return {
    rows: Math.max(5, Math.min(200, rows)),
    cols: Math.max(20, Math.min(500, cols))
  };
}

function isAuthRevokedTerminalExit(message: string) {
  const normalized = message.trim().toLowerCase();
  return normalized === "account signed in elsewhere" || normalized === "auth session revoked";
}

export function TerminalPane({
  active,
  connectionInfoLabel,
  protocol,
  resizeSuspended = false,
  sessionId,
  showSurfaceActions = true,
  websocketUrl,
  onActivity,
  onInput,
  onOpenConnectionInfo,
  onStateChange,
  ref
}: TerminalPaneProps) {
  const { effectiveTheme, terminalFontSize, terminalHighlightPreferences, terminalTheme, t } = usePreferences();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const highlightManagerRef = useRef<TerminalHighlightManager | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const fontLayoutRefreshFrameRef = useRef<number | null>(null);
  const pendingFontLayoutRefreshRef = useRef(false);
  const disposedRef = useRef(false);
  const resizeSuspendedRef = useRef(resizeSuspended);
  const terminalExitHandledRef = useRef(false);
  const authRevokedRef = useRef(false);
  const reconnectRequestedRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [frozenSurfaceSize, setFrozenSurfaceSize] = useState<{ width: number; height: number } | null>(null);
  const hasMeasuredRef = useRef(false);
  const lastContainerSizeRef = useRef<{ width: number; height: number } | null>(null);
  const lastSentSizeRef = useRef<{ rows: number; cols: number } | null>(null);
  const activeTerminalTheme = useMemo(
    () => terminalThemeFor(effectiveTheme, terminalTheme),
    [effectiveTheme, terminalTheme]
  );
  const terminalSurfaceTone = terminalThemeTone(activeTerminalTheme);
  const terminalSurfaceFrameStyle = {
    "--terminal-surface-background": activeTerminalTheme.background
  } as CSSProperties;
  const fullscreenButtonLabel = isFullscreen ? t("terminal.fullscreen.exit") : t("terminal.fullscreen.enter");
  const reportState = useEffectEvent((update: TerminalPaneStateUpdate) => {
    if (disposedRef.current) {
      return;
    }

    onStateChange(update);
  });
  const reportActivity = useEffectEvent((kind: "input" | "output") => {
    if (disposedRef.current) {
      return;
    }
    onActivity?.(kind);
  });
  const reportInput = useEffectEvent((data: string) => {
    if (disposedRef.current) {
      return;
    }
    onInput?.(data);
  });

  const sendJson = useEffectEvent((payload: unknown) => {
    if (disposedRef.current || wsRef.current?.readyState !== WebSocket.OPEN) {
      return;
    }

    wsRef.current.send(JSON.stringify(payload));
  });

  const queueResize = useEffectEvent((force = false) => {
    if (!active || disposedRef.current || resizeSuspendedRef.current) {
      return;
    }

    const container = containerRef.current;
    if (!canResize(container) || !terminalRef.current || !fitAddonRef.current) {
      return;
    }

    const liveContainer = container as HTMLDivElement;

    const nextSize = {
      width: liveContainer.clientWidth,
      height: liveContainer.clientHeight
    };

    if (
      !force &&
      lastContainerSizeRef.current &&
      lastContainerSizeRef.current.width === nextSize.width &&
      lastContainerSizeRef.current.height === nextSize.height
    ) {
      return;
    }

    lastContainerSizeRef.current = nextSize;

    if (resizeFrameRef.current) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }

    resizeFrameRef.current = window.requestAnimationFrame(() => {
      if (disposedRef.current) {
        return;
      }

      const liveContainer = containerRef.current;
      const liveTerminal = terminalRef.current;
      const liveFitAddon = fitAddonRef.current;
      if (!canResize(liveContainer) || !liveTerminal || !liveFitAddon) {
        return;
      }

      try {
        liveFitAddon.fit();
      } catch {
        return;
      }

      hasMeasuredRef.current = true;
      const normalized = normalizeTerminalSize(liveTerminal.rows, liveTerminal.cols);

      if (
        lastSentSizeRef.current &&
        lastSentSizeRef.current.rows === normalized.rows &&
        lastSentSizeRef.current.cols === normalized.cols
      ) {
        return;
      }

      lastSentSizeRef.current = normalized;

      sendJson({
        type: "resize",
        rows: normalized.rows,
        cols: normalized.cols
      });
    });
  });

  const scheduleTerminalLayoutRefresh = useEffectEvent(() => {
    pendingFontLayoutRefreshRef.current = true;
    if (!active || disposedRef.current || resizeSuspendedRef.current) {
      return;
    }

    if (fontLayoutRefreshFrameRef.current) {
      window.cancelAnimationFrame(fontLayoutRefreshFrameRef.current);
      fontLayoutRefreshFrameRef.current = null;
    }

    const terminal = terminalRef.current;
    if (!terminal || !canResize(containerRef.current)) {
      return;
    }

    remeasureTerminalFontMetrics(terminal);
    queueResize(true);
    fontLayoutRefreshFrameRef.current = window.requestAnimationFrame(() => {
      fontLayoutRefreshFrameRef.current = window.requestAnimationFrame(() => {
        fontLayoutRefreshFrameRef.current = null;
        if (disposedRef.current) {
          return;
        }

        const terminal = terminalRef.current;
        if (!canResize(containerRef.current) || !terminal || terminal.rows <= 0) {
          return;
        }

        pendingFontLayoutRefreshRef.current = false;
        terminal.refresh(0, terminal.rows - 1);
      });
    });
  });

  useLayoutEffect(() => {
    const wasSuspended = resizeSuspendedRef.current;
    if (!wasSuspended && resizeSuspended) {
      const container = containerRef.current;
      if (container && container.clientWidth > 0 && container.clientHeight > 0) {
        setFrozenSurfaceSize({
          width: container.clientWidth,
          height: container.clientHeight
        });
      }
    }
    resizeSuspendedRef.current = resizeSuspended;
    if (wasSuspended && !resizeSuspended && active) {
      setFrozenSurfaceSize(null);
      if (pendingFontLayoutRefreshRef.current) {
        scheduleTerminalLayoutRefresh();
      } else {
        queueResize(true);
      }
    }
  }, [active, queueResize, resizeSuspended, scheduleTerminalLayoutRefresh]);

  const handleControlEvent = useEffectEvent((event: TerminalControlEvent) => {
    switch (event.type) {
      case "ready": {
        const readyEvent = event as TerminalReadyEvent;
        reportState({
          status: "connected",
          message: t("terminal.ready"),
          attached: readyEvent.attached,
          detachedAt: readyEvent.detached_at,
          expiresAt: readyEvent.expires_at,
          keepAliveUntil: readyEvent.keep_alive_until,
          fingerprint: readyEvent.fingerprint
        });
        queueResize(true);
        break;
      }
      case "pong": {
        const pongEvent = event as TerminalPongEvent;
        void pongEvent;
        break;
      }
      case "error": {
        const errorEvent = event as TerminalErrorEvent;
        const message = terminalRuntimeErrorMessage(errorEvent.code, errorEvent.message, t);
        reportState({
          status: "failed",
          message
        });
        writeSystemLine(terminalRef, `${errorEvent.code}: ${errorEvent.message}`);
        break;
      }
      case "exit": {
        const exitEvent = event as TerminalExitEvent;
        terminalExitHandledRef.current = true;
        const isNormalExit =
          exitEvent.runtime_closed === true &&
          exitEvent.status === "disconnected" &&
          exitEvent.message === "ssh session ended";
        const authRevoked = isAuthRevokedTerminalExit(exitEvent.message);
        const shouldReconnect = exitEvent.runtime_closed === false && !authRevoked;
        reconnectRequestedRef.current = shouldReconnect;
        if (authRevoked) {
          authRevokedRef.current = true;
          window.dispatchEvent(new CustomEvent(authUnauthorizedEvent, { detail: { reason: "session_revoked" } }));
        }
        reportState({
          status: shouldReconnect ? "reconnecting" : exitEvent.status,
          message: exitEvent.message,
          closeOnNormalExit: isNormalExit,
          reconnectRequested: shouldReconnect,
          runtimeClosed: exitEvent.runtime_closed
        });
        if (!isNormalExit && !shouldReconnect && !authRevoked) {
          writeSystemLine(terminalRef, `session exit: ${exitEvent.message}`);
        }
        break;
      }
    }
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    disposedRef.current = false;
    terminalExitHandledRef.current = false;
    authRevokedRef.current = false;
    reconnectRequestedRef.current = false;

    const terminal = new Terminal({
      allowProposedApi: true,
      convertEol: true,
      cursorBlink: true,
      fontFamily: terminalFontFamily,
      fontSize: terminalFontSize,
      rows: 36,
      cols: 120,
      scrollback: 4000,
      theme: activeTerminalTheme
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    highlightManagerRef.current = new TerminalHighlightManager(terminal, terminalHighlightPreferences);

    const handleInput = terminal.onData((data) => {
      reportActivity("input");
      sendJson({
        type: "input",
        data
      });
      reportInput(data);
    });

    const ws = new WebSocket(websocketUrl, protocol);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      if (disposedRef.current) {
        return;
      }

      reportState({ status: "connecting", message: t("terminal.websocketOpen") });
      queueResize(true);
      pingTimerRef.current = window.setInterval(() => {
        sendJson({ type: "ping" });
      }, 25000);
    });

    ws.addEventListener("message", (messageEvent) => {
      if (typeof messageEvent.data === "string") {
        try {
          const event = JSON.parse(messageEvent.data) as TerminalControlEvent;
          handleControlEvent(event);
        } catch {
          writeSystemLine(terminalRef, "received invalid terminal event");
        }
        return;
      }

      if (messageEvent.data instanceof ArrayBuffer) {
        const output = new TextDecoder().decode(messageEvent.data);
        reportActivity("output");
        highlightManagerRef.current?.handleTerminalOutput(output);
        terminal.write(output);
      }
    });

    ws.addEventListener("close", () => {
      if (pingTimerRef.current) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }

      if (!disposedRef.current && terminalRef.current && !authRevokedRef.current) {
        writeSystemLine(terminalRef, "websocket closed");
      }

      if (
        !disposedRef.current &&
        !terminalExitHandledRef.current &&
        !reconnectRequestedRef.current &&
        !authRevokedRef.current
      ) {
        reconnectRequestedRef.current = true;
        reportState({
          status: "reconnecting",
          message: t("terminal.websocketClosedReconnect"),
          reconnectRequested: true,
          runtimeClosed: false
        });
      }
    });

    ws.addEventListener("error", () => {
      if (disposedRef.current) {
        return;
      }

      reportState({ status: "reconnecting", message: t("terminal.websocketFailed") });
      writeSystemLine(terminalRef, "websocket connection error");
    });

    resizeObserverRef.current = new ResizeObserver(() => {
      if (pendingFontLayoutRefreshRef.current) {
        scheduleTerminalLayoutRefresh();
        return;
      }

      if (!hasMeasuredRef.current) {
        return;
      }

      queueResize();
    });
    resizeObserverRef.current.observe(container);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        queueResize(true);
      });
    });

    if ("fonts" in document) {
      void document.fonts.ready.then(() => {
        if (!disposedRef.current) {
          queueResize(true);
        }
      });
    }

    return () => {
      disposedRef.current = true;
      hasMeasuredRef.current = false;
      lastContainerSizeRef.current = null;
      lastSentSizeRef.current = null;
      handleInput.dispose();
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;

      if (pingTimerRef.current) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }

      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }

      if (fontLayoutRefreshFrameRef.current) {
        window.cancelAnimationFrame(fontLayoutRefreshFrameRef.current);
        fontLayoutRefreshFrameRef.current = null;
      }

      wsRef.current?.close();
      wsRef.current = null;
      highlightManagerRef.current?.dispose();
      highlightManagerRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [protocol, sessionId, websocketUrl]);

  useLayoutEffect(() => {
    highlightManagerRef.current?.updatePreferences(terminalHighlightPreferences);
  }, [terminalHighlightPreferences]);

  useLayoutEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = activeTerminalTheme;
    }
  }, [activeTerminalTheme]);

  useLayoutEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) {
      terminal.options.fontSize = terminalFontSize;
      lastContainerSizeRef.current = null;
      scheduleTerminalLayoutRefresh();
    }
  }, [scheduleTerminalLayoutRefresh, terminalFontSize]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (pendingFontLayoutRefreshRef.current) {
        scheduleTerminalLayoutRefresh();
      } else {
        queueResize(true);
      }
      terminalRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [active]);

  useEffect(() => {
    const updateFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement === frameRef.current);
      if (active) {
        window.requestAnimationFrame(() => queueResize(true));
      }
    };

    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
    };
  }, [active]);

  const toggleFullscreen = useCallback(async () => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    try {
      if (document.fullscreenElement === frame) {
        await document.exitFullscreen?.();
      } else {
        await frame.requestFullscreen?.();
      }
    } finally {
      if (active) {
        window.requestAnimationFrame(() => queueResize(true));
      }
    }
  }, [active]);

  useImperativeHandle(
    ref,
    () => ({
      sendInput(text: string) {
        if (disposedRef.current || wsRef.current?.readyState !== WebSocket.OPEN || !text) {
          return false;
        }
        reportActivity("input");
        wsRef.current.send(JSON.stringify({ type: "input", data: text }));
        return true;
      },
      toggleBrowserFullscreen() {
        void toggleFullscreen();
      }
    }),
    [reportActivity, toggleFullscreen]
  );

  return (
    <div className={active ? "terminal-pane terminal-pane-active" : "terminal-pane"}>
      <div
        className={`terminal-surface-frame terminal-surface-frame-${terminalSurfaceTone}`}
        ref={frameRef}
        style={terminalSurfaceFrameStyle}
      >
        {showSurfaceActions ? (
          <div className="terminal-surface-actions">
            {onOpenConnectionInfo ? (
              <IconButton
                className="terminal-surface-action terminal-connection-info-button"
                label={connectionInfoLabel || t("terminal.connectionLog.open")}
                onClick={onOpenConnectionInfo}
                variant="ghost"
              >
                <Info aria-hidden="true" />
              </IconButton>
            ) : null}
            <IconButton
              className="terminal-surface-action terminal-fullscreen-button"
              label={fullscreenButtonLabel}
              onClick={() => void toggleFullscreen()}
              variant="ghost"
            >
              {isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </IconButton>
          </div>
        ) : null}
        <div
          className="terminal-surface"
          ref={containerRef}
          style={frozenSurfaceSize ? {
            width: `${frozenSurfaceSize.width}px`,
            height: `${frozenSurfaceSize.height}px`
          } : undefined}
        />
      </div>
    </div>
  );
}
