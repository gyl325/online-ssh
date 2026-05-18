import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { usePreferences } from "../preferences/PreferencesContext";
import { TerminalHighlightManager } from "./TerminalHighlightManager";
import type { TerminalRecordingChunk } from "./types";
import { terminalFontFamily, terminalThemeFor } from "./theme";

type TerminalHistoryReplayProps = {
  ariaLabel: string;
  chunks: TerminalRecordingChunk[];
};

function sanitizeReplayOutput(data: string) {
  return data
    .replace(/\x1b\[[0-?]*[ -/]*[HJ]/g, "")
    .replace(/\x1bc/g, "\r\n")
    .replace(/\x1b\]0;[^\x07]*(?:\x07|\x1b\\)/g, "");
}

export function TerminalHistoryReplay({ ariaLabel, chunks }: TerminalHistoryReplayProps) {
  const { effectiveTheme, terminalFontSize, terminalHighlightPreferences, terminalTheme } = usePreferences();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const highlightManagerRef = useRef<TerminalHighlightManager | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const replayOutput = useMemo(
    () =>
      chunks
        .filter((chunk) => chunk.direction === "output")
        .map((chunk) => sanitizeReplayOutput(chunk.data))
        .join(""),
    [chunks]
  );

  const fitReplay = useCallback(() => {
    try {
      fitAddonRef.current?.fit();
    } catch {
      // The replay remains readable with the default terminal size if fitting is not possible.
    }
  }, []);

  useEffect(() => {
    const terminalHost = terminalHostRef.current;
    if (!terminalHost) {
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: true,
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: terminalFontFamily,
      fontSize: terminalFontSize,
      rows: 30,
      cols: 120,
      scrollback: 8000,
      theme: terminalThemeFor(effectiveTheme, terminalTheme)
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalHost);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    highlightManagerRef.current = new TerminalHighlightManager(terminal, terminalHighlightPreferences);

    const frame = window.requestAnimationFrame(() => {
      fitReplay();
    });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(fitReplay);
      resizeObserver.observe(terminalHost);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      highlightManagerRef.current?.dispose();
      highlightManagerRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [effectiveTheme, fitReplay, terminalFontSize, terminalTheme]);

  useLayoutEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      fitReplay();
      highlightManagerRef.current?.clearAll();
      terminal.reset();
      if (!replayOutput) {
        return;
      }
      terminal.write(replayOutput, () => {
        fitReplay();
        terminal.scrollToBottom();
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitReplay, replayOutput]);

  useLayoutEffect(() => {
    highlightManagerRef.current?.updatePreferences(terminalHighlightPreferences);
  }, [terminalHighlightPreferences]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    terminal.options.theme = terminalThemeFor(effectiveTheme, terminalTheme);
  }, [effectiveTheme, terminalTheme]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    terminal.options.fontSize = terminalFontSize;
    fitReplay();
  }, [fitReplay, terminalFontSize]);

  return (
    <div
      aria-label={ariaLabel}
      className="terminal-history-replay"
      ref={containerRef}
      role="region"
    >
      <div className="terminal-history-replay-xterm" ref={terminalHostRef} />
    </div>
  );
}
