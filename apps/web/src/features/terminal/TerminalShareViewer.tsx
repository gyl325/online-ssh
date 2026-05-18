import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";
import { useEffect, useLayoutEffect, useRef } from "react";

import { usePreferences } from "../preferences/PreferencesContext";
import { terminalRuntimeErrorMessage } from "./errors";
import { TerminalHighlightManager } from "./TerminalHighlightManager";
import { terminalFontFamily, terminalThemeFor } from "./theme";
import type {
  TerminalControlEvent,
  TerminalErrorEvent,
  TerminalExitEvent,
  TerminalReadyEvent,
  TerminalShareUpdateEvent
} from "./types";

type TerminalShareViewerStateUpdate = {
  expiresAt?: string | null;
  message?: string;
  status?: "connecting" | "connected" | "disconnected" | "failed";
};

type TerminalShareViewerProps = {
  active: boolean;
  protocol: string;
  websocketUrl: string;
  onStateChange?: (update: TerminalShareViewerStateUpdate) => void;
};

type Translate = (key: string, values?: Record<string, string | number>) => string;

function terminalShareExitMessage(message: string, t: Translate) {
  const normalized = message.trim().toLowerCase();
  if (normalized === "terminal share revoked") {
    return t("terminal.share.viewerRevoked");
  }
  if (normalized === "terminal share expired") {
    return t("terminal.share.viewerExpired");
  }
  if (
    normalized === "terminal session closed by user" ||
    normalized === "terminal share closed" ||
    normalized.includes("session closed")
  ) {
    return t("terminal.share.viewerSessionClosed");
  }
  return message.trim() || t("terminal.share.viewerClosed");
}

export function TerminalShareViewer({
  active,
  protocol,
  websocketUrl,
  onStateChange
}: TerminalShareViewerProps) {
  const { effectiveTheme, terminalFontSize, terminalHighlightPreferences, terminalTheme, t } = usePreferences();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const highlightManagerRef = useRef<TerminalHighlightManager | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const exitReceivedRef = useRef(false);
  const stateChangeRef = useRef(onStateChange);

  useEffect(() => {
    stateChangeRef.current = onStateChange;
  }, [onStateChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    disposedRef.current = false;
    exitReceivedRef.current = false;
    const terminal = new Terminal({
      allowProposedApi: true,
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: terminalFontFamily,
      fontSize: terminalFontSize,
      rows: 36,
      cols: 120,
      scrollback: 4000,
      theme: terminalThemeFor(effectiveTheme, terminalTheme)
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    highlightManagerRef.current = new TerminalHighlightManager(terminal, terminalHighlightPreferences);

    const fit = () => {
      if (disposedRef.current || !containerRef.current || !fitAddonRef.current) {
        return;
      }
      try {
        fitAddonRef.current.fit();
      } catch {
        // The terminal may be hidden during layout transitions.
      }
    };

    const handleControlEvent = (event: TerminalControlEvent) => {
      switch (event.type) {
        case "ready": {
          const readyEvent = event as TerminalReadyEvent;
          stateChangeRef.current?.({
            expiresAt: readyEvent.expires_at ?? null,
            status: "connected",
            message: t("terminal.share.viewerReady")
          });
          fit();
          break;
        }
        case "share_update": {
          const shareUpdateEvent = event as TerminalShareUpdateEvent;
          stateChangeRef.current?.({ expiresAt: shareUpdateEvent.expires_at });
          break;
        }
        case "error": {
          const errorEvent = event as TerminalErrorEvent;
          const message = terminalRuntimeErrorMessage(errorEvent.code, errorEvent.message, t);
          stateChangeRef.current?.({ status: "failed", message });
          break;
        }
        case "exit": {
          const exitEvent = event as TerminalExitEvent;
          exitReceivedRef.current = true;
          stateChangeRef.current?.({
            status: exitEvent.status,
            message: terminalShareExitMessage(exitEvent.message, t)
          });
          break;
        }
        case "pong":
          break;
      }
    };

    const ws = new WebSocket(websocketUrl, protocol);
    ws.binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      if (disposedRef.current) {
        return;
      }
      stateChangeRef.current?.({ status: "connecting", message: t("terminal.share.viewerConnecting") });
      fit();
      pingTimerRef.current = window.setInterval(() => {
        if (!disposedRef.current && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 25000);
    });

    ws.addEventListener("message", (messageEvent) => {
      if (typeof messageEvent.data === "string") {
        try {
          handleControlEvent(JSON.parse(messageEvent.data) as TerminalControlEvent);
        } catch {
          stateChangeRef.current?.({ status: "failed", message: t("terminal.share.viewerFailed") });
        }
        return;
      }

      if (messageEvent.data instanceof ArrayBuffer) {
        const output = new TextDecoder().decode(messageEvent.data);
        highlightManagerRef.current?.handleTerminalOutput(output);
        terminal.write(output);
      }
    });

    ws.addEventListener("close", () => {
      if (pingTimerRef.current) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (!disposedRef.current && !exitReceivedRef.current) {
        stateChangeRef.current?.({ status: "disconnected", message: t("terminal.share.viewerClosed") });
      }
    });

    ws.addEventListener("error", () => {
      if (disposedRef.current) {
        return;
      }
      stateChangeRef.current?.({ status: "failed", message: t("terminal.share.viewerFailed") });
    });

    resizeObserverRef.current = new ResizeObserver(() => {
      window.requestAnimationFrame(fit);
    });
    resizeObserverRef.current.observe(container);
    window.requestAnimationFrame(fit);

    return () => {
      disposedRef.current = true;
      if (pingTimerRef.current) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      ws.close();
      highlightManagerRef.current?.dispose();
      highlightManagerRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [effectiveTheme, protocol, terminalFontSize, terminalHighlightPreferences, terminalTheme, t, websocketUrl]);

  useLayoutEffect(() => {
    highlightManagerRef.current?.updatePreferences(terminalHighlightPreferences);
  }, [terminalHighlightPreferences]);

  useLayoutEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = terminalThemeFor(effectiveTheme, terminalTheme);
    }
  }, [effectiveTheme, terminalTheme]);

  useLayoutEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.fontSize = terminalFontSize;
      window.requestAnimationFrame(() => {
        try {
          fitAddonRef.current?.fit();
        } catch {
          // Ignore fit failures when the viewer is hidden.
        }
      });
    }
  }, [terminalFontSize]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Ignore fit failures when the viewer is not measurable yet.
      }
      terminalRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  return (
    <div className={active ? "terminal-pane terminal-pane-active terminal-share-viewer-pane" : "terminal-pane terminal-share-viewer-pane"}>
      <div className={`terminal-surface-frame terminal-surface-frame-${effectiveTheme}`}>
        <div className="terminal-surface" ref={containerRef} />
      </div>
    </div>
  );
}
