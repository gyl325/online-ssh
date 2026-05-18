import { Info, Plus, X } from "lucide-react";

import type { Host } from "../hosts/types";
import { Button, IconButton, Popover, TextInput, Tooltip } from "../../shared/ui";
import type { FileDirectoryState } from "./fileHostContext";
import { defaultHomePath } from "./fileViewModel";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export type FileHostSidebarContextMap = Record<string, {
  currentPath?: string | null;
  directoryErrorMessage?: string | null;
  directoryState?: FileDirectoryState | null;
} | null | undefined>;

type FileHostSidebarProps = {
  availableHosts: Host[];
  connectedHostContexts: FileHostSidebarContextMap;
  connectedHosts: Host[];
  filter: string;
  onActivateHost: (hostId: string) => void;
  onDisconnectHost: (hostId: string) => void;
  onFilterChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedHostId: string;
  t: Translate;
};

function hostEndpoint(host: Host) {
  return `${host.username}@${host.host}:${host.port}`;
}

function hostStatusLabel(
  directoryState: FileDirectoryState | null | undefined,
  t: Translate
) {
  if (directoryState === "loading") {
    return {
      className: "files-connected-host-status-loading",
      label: t("files.connectedHostStatus.loading")
    };
  }
  if (directoryState === "error") {
    return {
      className: "files-connected-host-status-error",
      label: t("files.connectedHostStatus.error")
    };
  }
  return null;
}

export function FileHostSidebar({
  availableHosts,
  connectedHostContexts,
  connectedHosts,
  filter,
  onActivateHost,
  onDisconnectHost,
  onFilterChange,
  onOpenChange,
  open,
  selectedHostId,
  t
}: FileHostSidebarProps) {
  return (
    <>
      <div className="section-header">
        <div>
          <h4>{t("files.currentHost")}</h4>
        </div>
      </div>

      <section className="files-host-switcher" aria-label={t("files.currentHost")}>
        <Popover
          align="start"
          className="files-host-picker-popover"
          onOpenChange={onOpenChange}
          open={open}
          side="right"
          trigger={(
            <Button className="files-host-new-button" leadingIcon={<Plus aria-hidden="true" />} variant="primary">
              {t("files.newHostConnection")}
            </Button>
          )}
        >
          <div className="files-host-picker">
            <div className="files-host-picker-header">
              <strong>{t("files.availableHosts")}</strong>
              <span>{t("dashboard.hostsCount", { count: availableHosts.length })}</span>
            </div>
            <TextInput
              aria-label={t("files.hostSearch")}
              className="files-host-picker-search"
              onChange={(event) => onFilterChange(event.target.value)}
              placeholder={t("files.hostSearchPlaceholder")}
              type="search"
              value={filter}
            />
            {availableHosts.length > 0 ? (
              <div className="files-host-picker-list">
                {availableHosts.map((host) => (
                  <button
                    className="files-host-picker-item"
                    key={host.id}
                    onClick={() => onActivateHost(host.id)}
                    type="button"
                  >
                    <strong>{host.name}</strong>
                    <span>{hostEndpoint(host)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="files-sidebar-empty">{t("files.noAvailableHosts")}</p>
            )}
          </div>
        </Popover>

        <section className="files-connected-hosts" aria-label={t("files.connectedHosts")}>
          <div className="files-sidebar-panel-header">
            <strong>{t("files.connectedHosts")}</strong>
            <span>{t("dashboard.hostsCount", { count: connectedHosts.length })}</span>
          </div>
          {connectedHosts.length > 0 ? (
            <div className="files-connected-host-list" role="list">
              {connectedHosts.map((host) => {
                const active = host.id === selectedHostId;
                const context = connectedHostContexts[host.id];
                const hostPath = context?.currentPath || defaultHomePath(host);
                const status = hostStatusLabel(context?.directoryState, t);
                return (
                  <div
                    aria-current={active ? "true" : undefined}
                    className={[
                      "files-connected-host-item",
                      active ? "files-connected-host-item-active" : ""
                    ].filter(Boolean).join(" ")}
                    key={host.id}
                    role="listitem"
                  >
                    <button
                      aria-current={active ? "true" : undefined}
                      aria-label={host.name}
                      className="files-connected-host-main"
                      onClick={() => onActivateHost(host.id)}
                      type="button"
                    >
                      <strong>{host.name}</strong>
                      {status ? (
                        <span
                          className={[
                            "files-connected-host-status",
                            status.className
                          ].join(" ")}
                          title={context?.directoryErrorMessage || status.label}
                        >
                          {status.label}
                        </span>
                      ) : null}
                    </button>
                    <div className="files-connected-host-actions" aria-label={t("files.connectedHostActions", { name: host.name })}>
                      <Tooltip
                        content={(
                          <span className="files-connected-host-tooltip">
                            <span>{hostEndpoint(host)}</span>
                            <span>{hostPath}</span>
                            {context?.directoryErrorMessage ? (
                              <span>{context.directoryErrorMessage}</span>
                            ) : null}
                          </span>
                        )}
                      >
                        <IconButton
                          className="files-connected-host-action"
                          label={t("files.connectedHostInfo")}
                          variant="ghost"
                        >
                          <Info aria-hidden="true" />
                        </IconButton>
                      </Tooltip>
                      <IconButton
                        className="files-connected-host-action"
                        label={t("files.disconnectHost")}
                        onClick={() => onDisconnectHost(host.id)}
                        variant="danger"
                      >
                        <X aria-hidden="true" />
                      </IconButton>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="files-sidebar-empty">{t("files.noConnectedHosts")}</p>
          )}
        </section>
      </section>
    </>
  );
}
