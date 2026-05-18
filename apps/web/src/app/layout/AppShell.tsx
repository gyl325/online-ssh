import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Folder, Monitor, PanelLeftClose, PanelLeftOpen, Zap } from "lucide-react";

import { useAuth } from "../../features/auth/AuthContext";
import { getApiErrorMessage } from "../../features/auth/api";
import { buildHostLabelMap } from "../../features/hosts/display";
import { useHostCatalog } from "../../features/hosts/useHostCatalog";
import { usePreferences } from "../../features/preferences/PreferencesContext";
import { useConfirmDialog } from "../../features/ui/ConfirmDialogContext";
import { useToast } from "../../features/ui/ToastContext";
import { useWorkspaceSnapshot } from "../../features/workspace/WorkspaceContext";
import { getFilesWorkspaceStatus, getTerminalWorkspaceStatus } from "../../features/workspace/status";
import { Button, IconButton, SegmentedControl } from "../../shared/ui";

const AuditPage = lazy(async () => {
  const module = await import("../../routes/AuditPage");
  return { default: module.AuditPage };
});

const AdminPage = lazy(async () => {
  const module = await import("../../routes/AdminPage");
  return { default: module.AdminPage };
});

const CredentialsPage = lazy(async () => {
  const module = await import("../../routes/CredentialsPage");
  return { default: module.CredentialsPage };
});

const DashboardPage = lazy(async () => {
  const module = await import("../../routes/DashboardPage");
  return { default: module.DashboardPage };
});

const FilesPage = lazy(async () => {
  const module = await import("../../routes/FilesPage");
  return { default: module.FilesPage };
});

const HostsPage = lazy(async () => {
  const module = await import("../../routes/HostsPage");
  return { default: module.HostsPage };
});

const TerminalPage = lazy(async () => {
  const module = await import("../../routes/TerminalPage");
  return { default: module.TerminalPage };
});

const TransfersPage = lazy(async () => {
  const module = await import("../../routes/TransfersPage");
  return { default: module.TransfersPage };
});

const UserCenterPage = lazy(async () => {
  const module = await import("../../routes/UserCenterPage");
  return { default: module.UserCenterPage };
});

function RouteFallback() {
  const { t } = usePreferences();

  return (
    <div className="center-screen">
      <section className="status-card">
        <p className="eyebrow">{t("app.loading.eyebrow")}</p>
        <h1>{t("app.loading.title")}</h1>
        <p>{t("app.loading.copy")}</p>
      </section>
    </div>
  );
}

const sidebarStorageKey = "online-ssh-sidebar-open";

type RouteKey = "dashboard" | "credentials" | "hosts" | "terminal" | "files" | "transfers" | "audit";
type WorkspaceRouteKey = RouteKey | "admin" | "profile";

const navigationItemDefs: Record<RouteKey, { to: string; labelKey: string; hintKey: string }> = {
  dashboard: { to: "/dashboard", labelKey: "nav.dashboard", hintKey: "nav.dashboard.hint" },
  terminal: { to: "/terminal", labelKey: "nav.terminal", hintKey: "nav.terminal.hint" },
  files: { to: "/files", labelKey: "nav.files", hintKey: "nav.files.hint" },
  hosts: { to: "/hosts", labelKey: "nav.hosts", hintKey: "nav.hosts.hint" },
  credentials: { to: "/credentials", labelKey: "nav.credentials", hintKey: "nav.credentials.hint" },
  transfers: { to: "/transfers", labelKey: "nav.transfers", hintKey: "nav.transfers.hint" },
  audit: { to: "/audit", labelKey: "nav.audit", hintKey: "nav.audit.hint" }
};

const navigationGroupDefs: Array<{ labelKey: string; items: RouteKey[] }> = [
  { labelKey: "nav.group.workbench", items: ["dashboard", "terminal", "files"] },
  { labelKey: "nav.group.resources", items: ["hosts", "credentials"] },
  { labelKey: "nav.group.records", items: ["transfers", "audit"] }
];

function getRouteKey(pathname: string): WorkspaceRouteKey {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/profile")) return "profile";
  if (pathname.startsWith("/credentials")) return "credentials";
  if (pathname.startsWith("/hosts")) return "hosts";
  if (pathname.startsWith("/terminal")) return "terminal";
  if (pathname.startsWith("/files")) return "files";
  if (pathname.startsWith("/transfers")) return "transfers";
  if (pathname.startsWith("/audit")) return "audit";
  return "dashboard";
}

export function AppShell() {
  const auth = useAuth();
  const confirmDialog = useConfirmDialog();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = useWorkspaceSnapshot();
  const { language, setLanguage, theme, setTheme, t } = usePreferences();
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return window.localStorage.getItem(sidebarStorageKey) !== "false";
  });
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const currentRouteKey = getRouteKey(location.pathname);
  const isTerminalRoute = currentRouteKey === "terminal";
  const [terminalQuickConnectRequestId, setTerminalQuickConnectRequestId] = useState(0);
  const [visitedRoutes, setVisitedRoutes] = useState<Set<WorkspaceRouteKey>>(() => new Set([currentRouteKey]));
  const formatHostCatalogLoadError = useCallback(
    (error: unknown) => getApiErrorMessage(error, t("dashboard.hostsLoadFailed"), t),
    [t]
  );
  const {
    hosts,
    hostsErrorMessage,
    hostsLoading,
    removeHostFromCatalog,
    upsertHostInCatalog
  } = useHostCatalog({ formatLoadError: formatHostCatalogLoadError });

  useEffect(() => {
    workspace.setCurrentRoute(location.pathname);
  }, [location.pathname, workspace]);

  useEffect(() => {
    setVisitedRoutes((current) => {
      if (current.has(currentRouteKey)) {
        return current;
      }
      return new Set([...current, currentRouteKey]);
    });
  }, [currentRouteKey]);

  useEffect(() => {
    window.localStorage.setItem(sidebarStorageKey, String(sidebarOpen));
  }, [sidebarOpen]);

  useEffect(() => {
    if (auth.bootError) {
      toast.error(auth.bootError);
    }
  }, [auth.bootError, toast]);

  const openQuickConnect = useCallback(() => {
    setTerminalQuickConnectRequestId((current) => current + 1);
    if (!isTerminalRoute) {
      navigate("/terminal");
    }
  }, [isTerminalRoute, navigate]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-topbar-menu-root='true']")) {
        return;
      }
      setUserMenuOpen(false);
    };

    if (!userMenuOpen) {
      return;
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [userMenuOpen]);

  const navigationGroups = navigationGroupDefs.map((group) => ({
    label: t(group.labelKey),
    items: group.items.map((routeKey) => {
      const item = navigationItemDefs[routeKey];
      return {
        routeKey,
        to: item.to,
        label: t(item.labelKey),
        hint: t(item.hintKey)
      };
    })
  }));
  const navigationItems = navigationGroups.flatMap((group) => group.items);
  const userLabel = auth.user?.display_name || auth.user?.email || t("shell.currentUser");
  const isAdminUser = auth.user?.permissions?.includes("admin.access") ?? false;
  const hostLabelById = useMemo(() => buildHostLabelMap(hosts), [hosts]);
  const terminalStatus = getTerminalWorkspaceStatus(workspace.terminalSnapshot, hostLabelById);
  const filesStatus = getFilesWorkspaceStatus(workspace.filesSnapshot, hostLabelById);
  const terminalShortcutMeta = terminalStatus.sessionCount > 0
    ? t("shell.terminalShortcutMeta", {
      host: terminalStatus.activeHostLabel || terminalStatus.activeHostId || "--",
      hosts: terminalStatus.hostCount
    })
    : t("shell.terminalShortcutEmpty");
  const filesShortcutMeta = filesStatus.hasSelection
    ? t("shell.filesShortcutMeta", {
      host: filesStatus.hostLabel || filesStatus.hostId || "--",
      hosts: filesStatus.hostCount
    })
    : t("shell.filesShortcutEmpty");
  const filesShortcutLabel = filesStatus.hostCount > 0
    ? t("shell.filesShortcutLabelWithCount", { count: filesStatus.hostCount })
    : t("shell.filesShortcutLabel");
  const activeNavigationItem =
    navigationItems.find((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)) ||
    navigationItems[0];
  const activeNavigationHint =
    currentRouteKey === "admin"
      ? t("admin.copy")
      : currentRouteKey === "profile"
        ? t("profile.copy")
        : activeNavigationItem.hint;

  const handleSignOut = async () => {
    const confirmed = await confirmDialog.requestConfirmation({
      title: t("user.signOut.title"),
      message: t("user.signOut.message"),
      confirmLabel: t("user.signOut.confirm"),
      tone: "danger"
    });

    if (!confirmed) {
      return;
    }

    await auth.signOut();
  };

  return (
    <div className={sidebarOpen ? "app-shell" : "app-shell app-shell-collapsed"}>
      <button
        aria-hidden={!sidebarOpen}
        className={sidebarOpen ? "sidebar-scrim sidebar-scrim-visible" : "sidebar-scrim"}
        onClick={() => setSidebarOpen(false)}
        type="button"
      />

      <aside className={sidebarOpen ? "sidebar sidebar-open" : "sidebar sidebar-collapsed"}>
        <div className="brand">
          <p className="brand-kicker">Online SSH</p>
          <h1>{sidebarOpen ? t("shell.sidebar.title") : "SSH"}</h1>
          {sidebarOpen ? (
            <p className="brand-copy">{t("shell.sidebar.copy")}</p>
          ) : null}
        </div>

        <nav className="nav-list" aria-label="Primary">
          {navigationGroups.map((group) => (
            <div className="nav-section" key={group.label}>
              {sidebarOpen ? <p className="nav-section-label">{group.label}</p> : null}
              <div className="nav-section-items">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      isActive ? "nav-item nav-item-active" : "nav-item"
                    }
                    onClick={() => setSidebarOpen(false)}
                  >
                    <span className="nav-label">{item.label}</span>
                    {sidebarOpen ? <span className="nav-hint">{item.hint}</span> : null}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <main className="workspace">
        <header className="workspace-topbar">
          <div className="topbar-left">
            <IconButton
              aria-label={sidebarOpen ? t("shell.sidebar.collapse") : t("shell.sidebar.expand")}
              className="topbar-toggle-icon"
              label={sidebarOpen ? t("shell.sidebar.collapse") : t("shell.sidebar.expand")}
              onClick={() => setSidebarOpen((current) => !current)}
              variant="neutral"
            >
              {sidebarOpen ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
            </IconButton>

            <nav className="topbar-nav" aria-label="Quick menu">
              {navigationGroups.map((group) => (
                <div className="topbar-nav-group" key={group.label}>
                  <span className="topbar-nav-group-label">{group.label}</span>
                  <div className="topbar-nav-group-items">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                          isActive ? "topbar-nav-item topbar-nav-item-active" : "topbar-nav-item"
                        }
                      >
                        <span className="topbar-nav-label">{item.label}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </nav>

            <p className="topbar-active-hint" title={activeNavigationHint}>
              {activeNavigationHint}
            </p>
          </div>

          <div className="topbar-right">
            <div className="topbar-route-actions">
              <Button
                className="topbar-quick-connect-action"
                leadingIcon={<Zap aria-hidden="true" />}
                onClick={openQuickConnect}
                size="sm"
                variant="secondary"
              >
                {t("quickConnect.quickConnect")}
              </Button>
            </div>

            <div className="topbar-connection-switch" aria-label={t("shell.connection.shortcuts")}>
              <NavLink
                className={({ isActive }) =>
                  isActive ? "topbar-connection-chip topbar-connection-chip-active" : "topbar-connection-chip"
                }
                title={t("shell.openTerminal")}
                to="/terminal"
              >
                <Monitor aria-hidden="true" />
                <span className="topbar-connection-chip-text">
                  <span className="topbar-connection-chip-main">
                    {t("shell.terminalShortcutLabel", { count: terminalStatus.sessionCount })}
                  </span>
                  <span className="topbar-connection-chip-meta">{terminalShortcutMeta}</span>
                </span>
              </NavLink>
              <NavLink
                className={({ isActive }) =>
                  isActive ? "topbar-connection-chip topbar-connection-chip-active" : "topbar-connection-chip"
                }
                title={t("shell.openFiles")}
                to="/files"
              >
                <Folder aria-hidden="true" />
                <span className="topbar-connection-chip-text">
                  <span className="topbar-connection-chip-main">{filesShortcutLabel}</span>
                  <span className="topbar-connection-chip-meta">{filesShortcutMeta}</span>
                </span>
              </NavLink>
            </div>

            <div className="topbar-user-menu" data-topbar-menu-root="true">
              <Button
                className={userMenuOpen ? "topbar-user-trigger topbar-user-trigger-open" : "topbar-user-trigger"}
                onClick={() => setUserMenuOpen((current) => !current)}
                size="sm"
                variant="secondary"
              >
                {userLabel}
              </Button>

              {userMenuOpen ? (
                <div className="topbar-user-dropdown">
                  <div className="topbar-user-dropdown-meta">
                    <strong>{userLabel}</strong>
                    <span>{auth.user?.email || t("user.sessionFallback")}</span>
                  </div>
                  {isAdminUser ? (
                    <Button
                      className="topbar-user-admin"
                      onClick={() => {
                        setUserMenuOpen(false);
                        navigate("/admin");
                      }}
                      size="sm"
                      variant="secondary"
                    >
                      {t("user.adminSettings")}
                    </Button>
                  ) : null}
                  <Button
                    className="topbar-user-profile"
                    onClick={() => {
                      setUserMenuOpen(false);
                      navigate("/profile");
                    }}
                    size="sm"
                    variant="secondary"
                  >
                    {t("user.profile")}
                  </Button>
                  <div className="preference-panel">
                    <div className="preference-panel-title">{t("preferences.title")}</div>
                    <div className="preference-row">
                      <span>{t("preferences.language")}</span>
                      <SegmentedControl
                        ariaLabel={t("preferences.language")}
                        items={[
                          { label: t("preferences.language.zh"), value: "zh-CN" },
                          { label: t("preferences.language.en"), value: "en-US" }
                        ]}
                        onChange={setLanguage}
                        value={language}
                      />
                    </div>
                    <div className="preference-row">
                      <span>{t("preferences.theme")}</span>
                      <SegmentedControl
                        ariaLabel={t("preferences.theme")}
                        items={[
                          { label: t("preferences.theme.system"), value: "system" },
                          { label: t("preferences.theme.dark"), value: "dark" },
                          { label: t("preferences.theme.light"), value: "light" }
                        ]}
                        onChange={setTheme}
                        value={theme}
                      />
                    </div>
                  </div>
                  <dl className="topbar-user-session">
                    <div>
                      <dt>{t("user.status")}</dt>
                      <dd>{auth.status}</dd>
                    </div>
                    <div>
                      <dt>{t("user.currentRoute")}</dt>
                      <dd>{workspace.currentRoute}</dd>
                    </div>
                  </dl>
                  <Button
                    className="topbar-user-logout"
                    onClick={() => void handleSignOut()}
                    size="sm"
                    variant="secondary"
                  >
                    {t("user.signOut")}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <section className="workspace-panel">
          {visitedRoutes.has("dashboard") ? (
            <div className={currentRouteKey === "dashboard" ? "keepalive-route" : "keepalive-route keepalive-route-hidden"}>
              <Suspense fallback={<RouteFallback />}>
                <DashboardPage
                  hosts={hosts}
                  hostsErrorMessage={hostsErrorMessage}
                  hostsLoading={hostsLoading}
                />
              </Suspense>
            </div>
          ) : null}
          {visitedRoutes.has("credentials") ? (
            <div className={currentRouteKey === "credentials" ? "keepalive-route" : "keepalive-route keepalive-route-hidden"}>
              <Suspense fallback={<RouteFallback />}>
                <CredentialsPage />
              </Suspense>
            </div>
          ) : null}
          {visitedRoutes.has("hosts") ? (
            <div className={currentRouteKey === "hosts" ? "keepalive-route" : "keepalive-route keepalive-route-hidden"}>
              <Suspense fallback={<RouteFallback />}>
                <HostsPage
                  onHostDeleted={removeHostFromCatalog}
                  onHostSaved={upsertHostInCatalog}
                  visible={currentRouteKey === "hosts"}
                />
              </Suspense>
            </div>
          ) : null}
          {visitedRoutes.has("files") ? (
            <div className={currentRouteKey === "files" ? "keepalive-route" : "keepalive-route keepalive-route-hidden"}>
              <Suspense fallback={<RouteFallback />}>
                <FilesPage hostCatalog={{ hosts }} visible={currentRouteKey === "files"} />
              </Suspense>
            </div>
          ) : null}
          {visitedRoutes.has("transfers") ? (
            <div className={currentRouteKey === "transfers" ? "keepalive-route" : "keepalive-route keepalive-route-hidden"}>
              <Suspense fallback={<RouteFallback />}>
                <TransfersPage hostCatalog={{ hosts }} visible={currentRouteKey === "transfers"} />
              </Suspense>
            </div>
          ) : null}
          {visitedRoutes.has("audit") ? (
            <div className={currentRouteKey === "audit" ? "keepalive-route" : "keepalive-route keepalive-route-hidden"}>
              <Suspense fallback={<RouteFallback />}>
                <AuditPage hostCatalog={{ hosts }} visible={currentRouteKey === "audit"} />
              </Suspense>
            </div>
          ) : null}
          {visitedRoutes.has("admin") ? (
            <div className={currentRouteKey === "admin" ? "keepalive-route" : "keepalive-route keepalive-route-hidden"}>
              <Suspense fallback={<RouteFallback />}>
                <AdminPage visible={currentRouteKey === "admin"} />
              </Suspense>
            </div>
          ) : null}
          {visitedRoutes.has("profile") ? (
            <div className={currentRouteKey === "profile" ? "keepalive-route" : "keepalive-route keepalive-route-hidden"}>
              <Suspense fallback={<RouteFallback />}>
                <UserCenterPage />
              </Suspense>
            </div>
          ) : null}
          {visitedRoutes.has("terminal") ? (
            <div className={currentRouteKey === "terminal" ? "keepalive-route" : "keepalive-route keepalive-route-hidden"}>
              <Suspense fallback={<RouteFallback />}>
                <TerminalPage
                  hostCatalog={{ hosts, hostsLoading }}
                  onHostConnected={upsertHostInCatalog}
                  quickConnectRequestId={terminalQuickConnectRequestId}
                  visible={isTerminalRoute}
                />
              </Suspense>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
