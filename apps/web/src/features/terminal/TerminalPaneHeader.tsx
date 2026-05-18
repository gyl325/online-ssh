import { GripVertical, Info, Maximize2, MoreHorizontal, ShieldCheck, X } from "lucide-react";
import { useLayoutEffect, useRef, type DragEvent, type ReactNode } from "react";

import { IconButton, Popover } from "../../shared/ui";
import { TerminalShareSummary } from "./TerminalShareSummary";
import {
  formatTerminalStatusLabel,
  getTerminalStatusClassName,
  type TerminalTabStatus
} from "./terminalTabLabels";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export type TerminalPaneHeaderTab = {
  expiresAt?: string | null;
  fingerprint?: {
    algorithm: string;
    fingerprint: string;
    status: string;
  } | null;
  hostLabel: string;
  id: string;
  keepAliveUntil?: string | null;
  message?: string | null;
  sessionId: string;
  startedAt: string;
  status: TerminalTabStatus;
};

type TerminalPaneHeaderShare = {
  active: boolean;
  finalMinute: boolean;
  label: string;
  remainingText: string;
};

type TerminalPaneHeaderProps = {
  active: boolean;
  compact: boolean;
  draggable: boolean;
  formatDateTime: (value: string) => string;
  isWorkspacePane: boolean;
  menuOpen: boolean;
  onClosePane: () => void;
  onCompactChange: (compact: boolean) => void;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onExitSplit: () => void;
  onMenuOpenChange: (open: boolean) => void;
  onOpenConnectionInfo: () => void;
  onOpenShare: () => void;
  onToggleBrowserFullscreen: () => void;
  onToggleKeepAlive: () => void;
  share: TerminalPaneHeaderShare;
  t: Translate;
  tab: TerminalPaneHeaderTab;
};

type PaneHeaderShellProps = {
  active: boolean;
  children: ReactNode;
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
};

const compactPaneHeaderWidth = 260;

function PaneHeaderShell({ active, children, compact, onCompactChange }: PaneHeaderShellProps) {
  const headerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = headerRef.current;
    if (!element) {
      return undefined;
    }
    const readInlineContentWidth = () => {
      const style = window.getComputedStyle(element);
      const paddingLeft = Number.parseFloat(style.paddingLeft || "0") || 0;
      const paddingRight = Number.parseFloat(style.paddingRight || "0") || 0;
      const borderLeft = Number.parseFloat(style.borderLeftWidth || "0") || 0;
      const borderRight = Number.parseFloat(style.borderRightWidth || "0") || 0;
      return Math.max(0, element.getBoundingClientRect().width - paddingLeft - paddingRight - borderLeft - borderRight);
    };
    const updateCompact = (width: number) => {
      if (width > 0) {
        onCompactChange(width <= compactPaneHeaderWidth);
      }
    };
    updateCompact(readInlineContentWidth());
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width || readInlineContentWidth();
      updateCompact(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onCompactChange]);

  return (
    <div
      className={[
        "terminal-pane-header",
        active ? "terminal-pane-header-active" : "",
        compact ? "terminal-pane-header-compact" : ""
      ].filter(Boolean).join(" ")}
      data-testid="terminal-pane-header"
      ref={headerRef}
    >
      {children}
    </div>
  );
}

function TerminalStatusDetails({
  formatDateTime,
  tab,
  t
}: {
  formatDateTime: (value: string) => string;
  tab: TerminalPaneHeaderTab;
  t: Translate;
}) {
  return (
    <span className="terminal-status-tooltip">
      {tab.message ? <span>{tab.message}</span> : null}
      {tab.fingerprint ? (
        <span className="mono-wrap">
          {tab.fingerprint.algorithm} / {tab.fingerprint.fingerprint}
        </span>
      ) : null}
      {tab.startedAt ? (
        <span className="mono-wrap">{t("terminal.createdAt")}{formatDateTime(tab.startedAt)}</span>
      ) : null}
      {tab.sessionId ? (
        <span className="terminal-session-id">session:{tab.sessionId}</span>
      ) : null}
      {tab.expiresAt ? (
        <span className="mono-wrap">{t("terminal.expiresAt")}{formatDateTime(tab.expiresAt)}</span>
      ) : null}
      {tab.keepAliveUntil ? (
        <span className="mono-wrap">{t("terminal.keepaliveUntil")}{formatDateTime(tab.keepAliveUntil)}</span>
      ) : null}
    </span>
  );
}

function TerminalStatusWithDetails({
  formatDateTime,
  tab,
  t
}: {
  formatDateTime: (value: string) => string;
  tab: TerminalPaneHeaderTab;
  t: Translate;
}) {
  const statusClassName = getTerminalStatusClassName(tab.status, Boolean(tab.keepAliveUntil));
  return (
    <span className="terminal-status-with-info">
      <span className={statusClassName} tabIndex={0}>
        {tab.keepAliveUntil ? <ShieldCheck aria-hidden="true" /> : null}
        {formatTerminalStatusLabel(tab.status, t)}
        <TerminalStatusDetails formatDateTime={formatDateTime} tab={tab} t={t} />
      </span>
    </span>
  );
}

export function TerminalPaneHeader({
  active,
  compact,
  draggable,
  formatDateTime,
  isWorkspacePane,
  menuOpen,
  onClosePane,
  onCompactChange,
  onDragEnd,
  onDragStart,
  onExitSplit,
  onMenuOpenChange,
  onOpenConnectionInfo,
  onOpenShare,
  onToggleBrowserFullscreen,
  onToggleKeepAlive,
  share,
  t,
  tab
}: TerminalPaneHeaderProps) {
  return (
    <PaneHeaderShell
      active={active}
      compact={compact}
      onCompactChange={onCompactChange}
    >
      <button
        aria-label={`Move ${tab.hostLabel} pane`}
        className="terminal-pane-drag-handle"
        data-testid="terminal-pane-drag-handle"
        draggable={draggable}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        type="button"
      >
        <GripVertical aria-hidden="true" />
      </button>
      <div className="terminal-pane-header-main">
        <strong>{tab.hostLabel}</strong>
        <TerminalStatusWithDetails formatDateTime={formatDateTime} tab={tab} t={t} />
        <TerminalShareSummary
          active={share.active}
          finalMinute={share.finalMinute}
          label={share.label}
          onOpen={onOpenShare}
          remainingText={share.remainingText}
        />
      </div>
      <div className="terminal-pane-header-actions">
        {!compact ? (
          <IconButton
            className="ui-inline-icon-button terminal-pane-header-primary-action"
            label={t("terminal.pane.connectionInfo", { name: tab.hostLabel })}
            onClick={onOpenConnectionInfo}
            variant="ghost"
          >
            <Info aria-hidden="true" />
          </IconButton>
        ) : null}
        {!compact ? (
          <IconButton
            className="ui-inline-icon-button terminal-pane-header-primary-action"
            label={t("terminal.pane.browserFullscreen", { name: tab.hostLabel })}
            onClick={onToggleBrowserFullscreen}
            variant="ghost"
          >
            <Maximize2 aria-hidden="true" />
          </IconButton>
        ) : null}
        {isWorkspacePane && !compact ? (
          <IconButton
            className="ui-inline-icon-button terminal-pane-header-primary-action"
            label={t("terminal.pane.close", { name: tab.hostLabel })}
            onClick={onClosePane}
            variant="ghost"
          >
            <X aria-hidden="true" />
          </IconButton>
        ) : null}
        <Popover
          align="end"
          className={[
            "terminal-pane-actions-menu",
            compact ? "terminal-pane-actions-menu-compact" : ""
          ].filter(Boolean).join(" ")}
          onOpenChange={onMenuOpenChange}
          open={menuOpen}
          side="bottom"
          sideOffset={6}
          trigger={(
            <IconButton
              className="ui-inline-icon-button"
              label={t("terminal.pane.more", { name: tab.hostLabel })}
              variant="ghost"
            >
              <MoreHorizontal aria-hidden="true" />
            </IconButton>
          )}
        >
          {compact ? (
            <button
              className="terminal-pane-menu-compact-action"
              type="button"
              onClick={() => {
                onMenuOpenChange(false);
                onOpenConnectionInfo();
              }}
            >
              {t("terminal.pane.connectionInfo", { name: tab.hostLabel })}
            </button>
          ) : null}
          {compact ? (
            <button
              className="terminal-pane-menu-compact-action"
              type="button"
              onClick={() => {
                onMenuOpenChange(false);
                onToggleBrowserFullscreen();
              }}
            >
              {t("terminal.pane.browserFullscreen", { name: tab.hostLabel })}
            </button>
          ) : null}
          {isWorkspacePane && compact ? (
            <button
              className="terminal-pane-menu-compact-action terminal-pane-menu-compact-danger"
              type="button"
              onClick={() => {
                onMenuOpenChange(false);
                onClosePane();
              }}
            >
              {t("terminal.pane.close", { name: tab.hostLabel })}
            </button>
          ) : null}
          {tab.status === "connected" ? (
            <button
              type="button"
              onClick={() => {
                onMenuOpenChange(false);
                onToggleKeepAlive();
              }}
            >
              {tab.keepAliveUntil ? t("terminal.keepaliveDisable") : t("terminal.keepaliveEnable")}
            </button>
          ) : null}
          {tab.status === "connected" ? (
            <button
              type="button"
              onClick={onOpenShare}
            >
              {share.active ? t("terminal.share.menuManage") : t("terminal.share.menuCreate")}
            </button>
          ) : null}
          {isWorkspacePane ? (
            <button type="button" onClick={onExitSplit}>
              {t("terminal.pane.exitSplit")}
            </button>
          ) : null}
        </Popover>
      </div>
    </PaneHeaderShell>
  );
}
