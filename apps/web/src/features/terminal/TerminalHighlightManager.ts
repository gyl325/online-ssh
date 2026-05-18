import {
  buildTerminalHighlightRules,
  maxTerminalHighlightScanLines,
  scanTerminalLine,
  transparentTerminalHighlightBackground,
  type CompiledTerminalHighlightRule,
  type TerminalHighlightPreferences
} from "./highlighting";

type Disposable = {
  dispose: () => void;
};

type TerminalBufferLineLike = {
  translateToString: (trimRight?: boolean, startColumn?: number, endColumn?: number) => string;
};

type TerminalBufferLike = {
  type: "normal" | "alternate";
  cursorY: number;
  viewportY: number;
  baseY: number;
  length: number;
  getLine: (line: number) => TerminalBufferLineLike | undefined;
};

type TerminalMarkerLike = {
  readonly id: number;
  readonly line: number;
  readonly isDisposed: boolean;
  onDispose: (listener: () => void) => Disposable;
  dispose: () => void;
};

type TerminalLike = {
  rows: number;
  cols: number;
  buffer: {
    active: TerminalBufferLike;
  };
  onWriteParsed?: (listener: () => void) => Disposable;
  onRender?: (listener: (event: { start: number; end: number }) => void) => Disposable;
  onScroll?: (listener: (viewportY: number) => void) => Disposable;
  registerMarker?: (cursorYOffset?: number) => TerminalMarkerLike | undefined;
  registerDecoration?: (options: {
    marker: TerminalMarkerLike;
    x: number;
    width: number;
    backgroundColor?: string;
    foregroundColor?: string;
    layer: "bottom";
  }) => Disposable | undefined;
};

const writeScanBacklog = 8;
const writeScanForward = 3;
const viewportScanMargin = 3;

function clampLine(line: number, buffer: TerminalBufferLike) {
  return Math.max(0, Math.min(Math.max(0, buffer.length - 1), line));
}

function range(start: number, end: number, buffer: TerminalBufferLike) {
  const from = clampLine(start, buffer);
  const to = clampLine(end, buffer);
  const lines: number[] = [];
  for (let line = from; line <= to; line += 1) {
    lines.push(line);
  }
  return lines;
}

function hasTerminalResetSequence(data: string) {
  return /\x1bc|\x1b\[[0-?]*[ -/]*[HJ]/.test(data);
}

export class TerminalHighlightManager {
  private readonly terminal: TerminalLike;
  private rules: CompiledTerminalHighlightRule[] = [];
  private readonly decorationsByLine = new Map<number, Disposable[]>();
  private readonly markersByLine = new Map<number, Disposable>();
  private readonly disposables: Disposable[] = [];
  private disposed = false;
  private lastScannedLineCount = 0;

  constructor(terminal: TerminalLike, preferences: TerminalHighlightPreferences) {
    this.terminal = terminal;
    this.rules = buildTerminalHighlightRules(preferences).rules;
    this.disposables.push(terminal.onWriteParsed?.(() => this.handleWriteParsed()) || { dispose: () => undefined });
    this.disposables.push(terminal.onRender?.((event) => this.handleRender(event)) || { dispose: () => undefined });
    this.disposables.push(terminal.onScroll?.(() => this.refreshViewport()) || { dispose: () => undefined });
  }

  updatePreferences(preferences: TerminalHighlightPreferences) {
    if (this.disposed) {
      return;
    }
    this.clearAll();
    this.rules = buildTerminalHighlightRules(preferences).rules;
    this.refreshViewport();
  }

  handleTerminalOutput(data: string) {
    if (hasTerminalResetSequence(data)) {
      this.clearAll();
    }
  }

  handleWriteParsed() {
    if (this.disposed) {
      return;
    }
    const buffer = this.terminal.buffer.active;
    if (buffer.type !== "normal") {
      this.clearAll();
      return;
    }
    const cursorLine = buffer.baseY + buffer.cursorY;
    this.refreshLines(range(cursorLine - writeScanBacklog, cursorLine + writeScanForward, buffer));
  }

  handleRender(event: { start: number; end: number }) {
    if (this.disposed) {
      return;
    }
    const buffer = this.terminal.buffer.active;
    if (buffer.type !== "normal") {
      this.clearAll();
      return;
    }
    this.refreshLines(range(
      buffer.viewportY + event.start - viewportScanMargin,
      buffer.viewportY + event.end + viewportScanMargin,
      buffer
    ));
  }

  refreshViewport() {
    if (this.disposed) {
      return;
    }
    const buffer = this.terminal.buffer.active;
    if (buffer.type !== "normal") {
      this.clearAll();
      return;
    }
    this.refreshLines(range(
      buffer.viewportY - viewportScanMargin,
      buffer.viewportY + this.terminal.rows + viewportScanMargin,
      buffer
    ));
  }

  refreshLines(lines: number[]) {
    if (this.disposed) {
      return;
    }
    const buffer = this.terminal.buffer.active;
    if (buffer.type !== "normal") {
      this.clearAll();
      return;
    }

    const uniqueLines = [...new Set(lines)]
      .filter((line) => line >= 0 && line < buffer.length)
      .slice(0, maxTerminalHighlightScanLines);
    this.lastScannedLineCount = uniqueLines.length;

    for (const lineIndex of uniqueLines) {
      this.refreshLine(lineIndex);
    }
  }

  refreshLine(lineIndex: number) {
    if (this.disposed) {
      return;
    }
    const buffer = this.terminal.buffer.active;
    this.clearLine(lineIndex);
    if (buffer.type !== "normal" || this.rules.length === 0 || typeof this.terminal.registerDecoration !== "function") {
      return;
    }

    const bufferLine = buffer.getLine(lineIndex);
    if (!bufferLine) {
      return;
    }

    const text = bufferLine.translateToString(false, 0, this.terminal.cols);
    const matches = scanTerminalLine(text, this.rules);
    if (matches.length === 0 || typeof this.terminal.registerMarker !== "function") {
      return;
    }

    const cursorLine = buffer.baseY + buffer.cursorY;
    const marker = this.terminal.registerMarker(lineIndex - cursorLine);
    if (!marker || marker.line < 0) {
      return;
    }

    const decorations: Disposable[] = [];
    for (const match of matches) {
      try {
        const backgroundColor = match.backgroundColor === transparentTerminalHighlightBackground
          ? undefined
          : match.backgroundColor;
        const decoration = this.terminal.registerDecoration({
          marker,
          x: match.start,
          width: match.end - match.start,
          ...(backgroundColor ? { backgroundColor } : {}),
          foregroundColor: match.foregroundColor,
          layer: "bottom"
        });
        if (decoration) {
          decorations.push(decoration);
        }
      } catch {
        for (const decoration of decorations) {
          decoration.dispose();
        }
        marker.dispose();
        return;
      }
    }

    if (decorations.length > 0) {
      this.decorationsByLine.set(lineIndex, decorations);
      this.markersByLine.set(lineIndex, marker);
    } else {
      marker.dispose();
    }
  }

  clearLine(lineIndex: number) {
    const decorations = this.decorationsByLine.get(lineIndex);
    if (decorations) {
      for (const decoration of decorations) {
        decoration.dispose();
      }
      this.decorationsByLine.delete(lineIndex);
    }
    const marker = this.markersByLine.get(lineIndex);
    if (marker) {
      marker.dispose();
      this.markersByLine.delete(lineIndex);
    }
  }

  clearAll() {
    for (const lineIndex of [...this.decorationsByLine.keys()]) {
      this.clearLine(lineIndex);
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearAll();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  getDecorationCount() {
    let count = 0;
    for (const decorations of this.decorationsByLine.values()) {
      count += decorations.length;
    }
    return count;
  }

  getScannedLineCount() {
    return this.lastScannedLineCount;
  }
}
