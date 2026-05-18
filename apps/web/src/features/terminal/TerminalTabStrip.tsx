import { LayoutPanelTop, Megaphone, Plus, RotateCw, X } from "lucide-react";
import type { DragEvent } from "react";

import type { Host } from "../hosts/types";
import { IconButton, Popover } from "../../shared/ui";
import { TerminalHostPicker } from "./TerminalHostPicker";
import {
  getTerminalTabStatusIndicator,
  type TerminalTabStatus
} from "./terminalTabLabels";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export type TerminalTabStripTab = {
  hostLabel: string;
  id: string;
  status: TerminalTabStatus;
};

export type TerminalTabStripWorkspace = {
  active: boolean;
  broadcasting: boolean;
  id: string;
  label: string;
  tabIds: string[];
};

type TerminalTabStripProps<TTab extends TerminalTabStripTab = TerminalTabStripTab> = {
  activeTabId: string | null;
  draggingTabId: string | null;
  hostPickerFilter: string;
  hostPickerHosts: Host[];
  hostPickerOpen: boolean;
  onCloseTab: (tab: TTab) => void;
  onCloseWorkspace: (tabIds: string[]) => void;
  onDragEnd: () => void;
  onDragListDrop: (event: DragEvent<HTMLElement>) => void;
  onDragListLeave: (event: DragEvent<HTMLElement>) => void;
  onDragListOver: (event: DragEvent<HTMLElement>) => void;
  onDragStart: (event: DragEvent<HTMLElement>, tab: TTab) => void;
  onHostPickerFilterChange: (value: string) => void;
  onHostPickerOpenChange: (open: boolean) => void;
  onReconnectTab: (tab: TTab) => void;
  onSelectHost: (host: Host) => void;
  onSelectTab: (tabId: string) => void;
  onSelectWorkspace: (workspaceId: string, tabIds: string[]) => void;
  onToggleWorkspaceBroadcast: (workspaceId: string) => void;
  splitActive: boolean;
  t: Translate;
  tabs: TTab[];
  tabListDropActive: boolean;
  workspaces: TerminalTabStripWorkspace[];
};

export function TerminalTabStrip<TTab extends TerminalTabStripTab = TerminalTabStripTab>({
  activeTabId,
  draggingTabId,
  hostPickerFilter,
  hostPickerHosts,
  hostPickerOpen,
  onCloseTab,
  onCloseWorkspace,
  onDragEnd,
  onDragListDrop,
  onDragListLeave,
  onDragListOver,
  onDragStart,
  onHostPickerFilterChange,
  onHostPickerOpenChange,
  onReconnectTab,
  onSelectHost,
  onSelectTab,
  onSelectWorkspace,
  onToggleWorkspaceBroadcast,
  splitActive,
  t,
  tabs,
  tabListDropActive,
  workspaces
}: TerminalTabStripProps<TTab>) {
  const tabListClassName = [
    "terminal-tab-list",
    splitActive ? "terminal-tab-list-split-active" : "",
    tabListDropActive ? "terminal-tab-list-drop-active" : ""
  ].filter(Boolean).join(" ");

  return (
    <div
      aria-label="Terminal tabs"
      className={tabListClassName}
      onDragLeave={onDragListLeave}
      onDragOver={onDragListOver}
      onDrop={onDragListDrop}
      role="tablist"
    >
      {workspaces.map((workspace) => (
        <div
          className={[
            "terminal-tab",
            "terminal-tab-workspace",
            workspace.broadcasting ? "terminal-tab-workspace-broadcasting" : "",
            workspace.active ? "terminal-tab-active" : ""
          ].filter(Boolean).join(" ")}
          key={workspace.id}
          onClick={() => onSelectWorkspace(workspace.id, workspace.tabIds)}
          role="tab"
        >
          <div className="terminal-tab-main">
            <span className="terminal-tab-workspace-icon" aria-hidden="true">
              <LayoutPanelTop />
            </span>
            <span className="terminal-tab-title">
              <strong>{workspace.label}</strong>
            </span>
          </div>
          <IconButton
            className="terminal-tab-close terminal-workspace-broadcast"
            label={workspace.broadcasting ? t("terminal.workspaceBroadcastDisable") : t("terminal.workspaceBroadcastEnable")}
            onClick={(event) => {
              event.stopPropagation();
              onToggleWorkspaceBroadcast(workspace.id);
            }}
            variant="ghost"
          >
            <Megaphone aria-hidden="true" />
          </IconButton>
          <IconButton
            className="terminal-tab-close terminal-workspace-close"
            label={t("terminal.workspaceClose")}
            onClick={(event) => {
              event.stopPropagation();
              onCloseWorkspace(workspace.tabIds);
            }}
            variant="ghost"
          >
            <X aria-hidden="true" />
          </IconButton>
        </div>
      ))}

      {tabs.map((tab) => {
        const indicator = getTerminalTabStatusIndicator(tab.status);
        return (
          <div
            className={[
              "terminal-tab",
              tab.id === activeTabId ? "terminal-tab-active" : "",
              draggingTabId === tab.id ? "terminal-tab-dragging" : ""
            ].filter(Boolean).join(" ")}
            draggable={tabs.length > 1}
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            onDragEnd={onDragEnd}
            onDragStart={(event) => onDragStart(event, tab)}
            role="tab"
          >
            <div className="terminal-tab-main">
              <span className="terminal-tab-title">
                {indicator === "spinner" ? <span className="terminal-tab-spinner" aria-hidden="true" /> : null}
                {indicator === "connected" ? (
                  <span
                    className="host-connectivity-breathing-dot host-connectivity-breathing-dot-reachable terminal-tab-breathing-dot"
                    aria-hidden="true"
                  />
                ) : null}
                {indicator === "disconnected" ? (
                  <span
                    className="host-connectivity-breathing-dot host-connectivity-breathing-dot-unreachable terminal-tab-breathing-dot"
                    aria-hidden="true"
                  />
                ) : null}
                {indicator === "reconnect" ? (
                  <IconButton
                    className="terminal-tab-reconnect"
                    label={t("terminal.reconnect")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onReconnectTab(tab);
                    }}
                    title={t("terminal.reconnect")}
                    variant="ghost"
                  >
                    <RotateCw aria-hidden="true" />
                  </IconButton>
                ) : null}
                <strong>{tab.hostLabel}</strong>
              </span>
            </div>
            <IconButton
              className="terminal-tab-close"
              label={t("terminal.closeTab", { name: tab.hostLabel })}
              onClick={(event) => {
                event.stopPropagation();
                onCloseTab(tab);
              }}
              variant="ghost"
            >
              <X aria-hidden="true" />
            </IconButton>
          </div>
        );
      })}

      <Popover
        className="files-host-picker-popover"
        onOpenChange={onHostPickerOpenChange}
        open={hostPickerOpen}
        side="right"
        sideOffset={10}
        trigger={(
          <IconButton
            className="terminal-tab-add"
            label={t("quickConnect.newConnection")}
            variant="ghost"
          >
            <Plus aria-hidden="true" />
          </IconButton>
        )}
      >
        <TerminalHostPicker
          filter={hostPickerFilter}
          hosts={hostPickerHosts}
          onFilterChange={onHostPickerFilterChange}
          onSelectHost={onSelectHost}
          t={t}
        />
      </Popover>
    </div>
  );
}
