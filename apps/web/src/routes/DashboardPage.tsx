import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRightLeft, FolderOpen, Monitor, Server } from "lucide-react";

import { buildHostLabelMap, getHostDisplayName, getHostEndpoint } from "../features/hosts/display";
import type { Host } from "../features/hosts/types";
import { usePreferences } from "../features/preferences/PreferencesContext";
import { useToast } from "../features/ui/ToastContext";
import { useWorkspaceSnapshot } from "../features/workspace/WorkspaceContext";
import { getFilesWorkspaceStatus, getTerminalWorkspaceStatus } from "../features/workspace/status";
import { formatDateTimeWithOptions } from "../shared/lib/date";
import { Button } from "../shared/ui";

type DashboardPageProps = {
  hosts?: Host[];
  hostsErrorMessage?: string | null;
  hostsLoading?: boolean;
};

function formatRecentConnectedAt(value: string, locale: string) {
  return formatDateTimeWithOptions(value, locale, value, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function DashboardPage({
  hosts = [],
  hostsErrorMessage = null,
  hostsLoading = false
}: DashboardPageProps) {
  const navigate = useNavigate();
  const { language, t } = usePreferences();
  const toast = useToast();
  const workspace = useWorkspaceSnapshot();

  const hostLabelById = useMemo(() => buildHostLabelMap(hosts), [hosts]);
  const terminalStatus = getTerminalWorkspaceStatus(workspace.terminalSnapshot, hostLabelById);
  const filesStatus = getFilesWorkspaceStatus(workspace.filesSnapshot, hostLabelById);
  const recentConnectionHosts = useMemo(() =>
    hosts
      .filter((host) => Boolean(host.last_connected_at))
      .sort((left, right) => Date.parse(right.last_connected_at || "") - Date.parse(left.last_connected_at || ""))
      .slice(0, 4),
  [hosts]);
  const recentConnectionCount = recentConnectionHosts.length;
  const terminalStatusText = terminalStatus.sessionCount > 0
    ? t("dashboard.quickTerminalCopy", {
      count: terminalStatus.sessionCount,
      host: terminalStatus.activeHostLabel || terminalStatus.activeHostId || "--",
      hosts: terminalStatus.hostCount
    })
    : t("dashboard.quickTerminalEmpty");
  const filesStatusText = filesStatus.hasSelection
    ? t("dashboard.quickFilesCopy", { host: filesStatus.hostLabel || filesStatus.hostId, path: filesStatus.path })
    : t("dashboard.quickFilesEmpty");

  useEffect(() => {
    if (hostsErrorMessage) {
      toast.error(hostsErrorMessage);
    }
  }, [hostsErrorMessage, toast]);

  return (
    <div className="route-page dashboard-page">
      <p className="eyebrow route-eyebrow">{t("dashboard.eyebrow")}</p>

      <div className="dashboard-layout">
        <section className="content-card dashboard-workbench-panel">
          <div className="section-header">
            <div>
              <h4>{t("dashboard.workbenchTitle")}</h4>
              <p>{t("dashboard.workbenchCopy")}</p>
            </div>
          </div>

          <div className="dashboard-action-grid">
            <article className="dashboard-action-card">
              <span className="dashboard-action-icon">
                <Monitor aria-hidden="true" />
              </span>
              <div>
                <strong>{t("dashboard.quickTerminal")}</strong>
                <p>{terminalStatusText}</p>
              </div>
              <div className="dashboard-action-buttons">
                <Button leadingIcon={<Monitor aria-hidden="true" />} onClick={() => void navigate("/terminal")} size="sm" variant="secondary">
                  {t("dashboard.openTerminal")}
                </Button>
              </div>
            </article>

            <article className="dashboard-action-card">
              <span className="dashboard-action-icon">
                <FolderOpen aria-hidden="true" />
              </span>
              <div>
                <strong>{t("dashboard.quickFiles")}</strong>
                <p>{filesStatusText}</p>
              </div>
              <Button leadingIcon={<FolderOpen aria-hidden="true" />} onClick={() => void navigate("/files")} size="sm" variant="secondary">
                {t("dashboard.openFiles")}
              </Button>
            </article>

            <article className="dashboard-action-card">
              <span className="dashboard-action-icon">
                <Server aria-hidden="true" />
              </span>
              <div>
                <strong>{t("dashboard.quickHosts")}</strong>
                <p>{t("dashboard.quickHostsCopy")}</p>
              </div>
              <Button leadingIcon={<Server aria-hidden="true" />} onClick={() => void navigate("/hosts")} size="sm" variant="secondary">
                {t("dashboard.openHosts")}
              </Button>
            </article>

            <article className="dashboard-action-card">
              <span className="dashboard-action-icon">
                <ArrowRightLeft aria-hidden="true" />
              </span>
              <div>
                <strong>{t("dashboard.quickTransfers")}</strong>
                <p>{t("dashboard.quickTransfersCopy")}</p>
              </div>
              <Button leadingIcon={<ArrowRightLeft aria-hidden="true" />} onClick={() => void navigate("/transfers")} size="sm" variant="secondary">
                {t("dashboard.openTransfers")}
              </Button>
            </article>
          </div>

          <div className="dashboard-recent-strip">
            <div className="dashboard-recent-strip-header">
              <strong>{t("dashboard.recentConnections")}</strong>
              <span>{hostsLoading ? t("dashboard.hostsLoading") : t("dashboard.recentConnectionsCount", { count: recentConnectionCount })}</span>
            </div>

            {recentConnectionHosts.length > 0 ? (
              <div className="dashboard-recent-list dashboard-recent-list-adaptive">
                {recentConnectionHosts.map((host) => {
                  const hostName = getHostDisplayName(host);
                  return (
                    <article aria-label={t("dashboard.recentConnectionAria", { host: hostName })} className="dashboard-recent-item" key={host.id}>
                      <span className="dashboard-recent-icon">
                        <Server aria-hidden="true" />
                      </span>
                      <div className="dashboard-recent-body">
                        <span>{t("dashboard.recentConnectionKind")}</span>
                        <strong>{hostName}</strong>
                        <small>{getHostEndpoint(host)}</small>
                        <em>{t("dashboard.recentConnectedAt", { time: formatRecentConnectedAt(host.last_connected_at || "", language) })}</em>
                      </div>
                      <div className="dashboard-recent-actions">
                        <Button
                          leadingIcon={<Monitor aria-hidden="true" />}
                          onClick={() => void navigate(`/terminal?host_id=${encodeURIComponent(host.id)}`)}
                          size="sm"
                          variant="secondary"
                        >
                          {t("dashboard.openTerminal")}
                        </Button>
                        <Button
                          leadingIcon={<FolderOpen aria-hidden="true" />}
                          onClick={() => void navigate(`/files?host_id=${encodeURIComponent(host.id)}`)}
                          size="sm"
                          variant="secondary"
                        >
                          {t("dashboard.openFiles")}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="dashboard-recent-empty">{t("dashboard.recentConnectionsEmpty")}</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
