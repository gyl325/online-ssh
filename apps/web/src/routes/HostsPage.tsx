import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import {
  Activity,
  BarChart3,
  CircleDashed,
  Clock3,
  FolderOpen,
  FolderPlus,
  History,
  Info,
  Link2,
  LoaderCircle,
  Monitor,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Server,
  Star,
  Terminal,
  Trash2
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { getApiErrorMessage, getAuthConfig } from "../features/auth/api";
import { getConnectionErrorMessage, localizeConnectionErrorMessage } from "../features/connections/connectionErrorMessages";
import { listCredentials } from "../features/credentials/api";
import { useFingerprintDialog } from "../features/fingerprint/FingerprintDialogContext";
import type { Credential } from "../features/credentials/types";
import {
  createHostGroup,
  createHost,
  deleteHostGroup,
  deleteHost,
  getHost,
  getHostMetrics,
  listHostGroups,
  listHosts,
  testHost,
  updateHostGroup,
  updateHost
} from "../features/hosts/api";
import type {
  CreateHostInput,
  Host,
  HostAuthType,
  HostGroup,
  HostMetrics,
  TestHostInput,
  TestHostResponse
} from "../features/hosts/types";
import { usePreferences } from "../features/preferences/PreferencesContext";
import { useConfirmDialog } from "../features/ui/ConfirmDialogContext";
import { useToast } from "../features/ui/ToastContext";
import { formatDateTime } from "../shared/lib/date";
import { Button, Dialog, FilterChip, FormField, IconButton, InlineIconButton, LoadingState, SelectInput, TextInput, ToggleRow } from "../shared/ui";

type EditorMode = "create" | "view" | "edit";
type GroupDialogMode = "list" | "create" | "edit";

type HostsPageProps = {
  onHostDeleted?: (hostId: string) => void;
  onHostSaved?: (host: Host) => void;
  visible?: boolean;
};
type HostConnectivityStatus = "idle" | "checking" | "fingerprint_required" | "not_checked" | "reachable" | "unreachable";
type HostMetricsLoadState = "idle" | "loading" | "ready" | "error";
type SectionIcon = ComponentType<{ "aria-hidden"?: boolean; className?: string }>;

type HostFormState = {
  name: string;
  groupId: string;
  host: string;
  port: string;
  username: string;
  authType: HostAuthType;
  credentialId: string;
  isFavorite: boolean;
};

type HostGroupFormState = {
  id: string;
  name: string;
};

type ParsedLoginRecord = {
  user: string;
  terminal: string;
  source: string;
  loginTime: string;
  status: string;
  fullTime: string;
};

type Translate = (key: string, values?: Record<string, string | number>) => string;

const defaultHostForm = (host?: Host | null): HostFormState => ({
  name: host?.name || "",
  groupId: host?.group_id || "",
  host: host?.host || "",
  port: String(host?.port || 22),
  username: host?.username || "",
  authType: host?.auth_type || "password",
  credentialId: host?.credential_id || "",
  isFavorite: host?.is_favorite || false
});

const defaultGroupForm = (): HostGroupFormState => ({
  id: "",
  name: ""
});

const defaultHostConnectivityPollIntervalSeconds = 30;

function normalizeHostConnectivityPollIntervalSeconds(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : defaultHostConnectivityPollIntervalSeconds;
}

function formatAuthType(value: HostAuthType, t: (key: string) => string) {
  return value === "password" ? t("credential.password") : t("credential.privateKey");
}

function formatMetricPercent(value: number | null | undefined, fallback: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "")}%`;
}

function clampMetricPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

function formatMetricBytes(value: number | null | undefined, fallback: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const rendered = amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1);
  return `${rendered} ${units[unitIndex]}`;
}

function formatMetricBytePair(used: number | null | undefined, total: number | null | undefined, fallback: string) {
  if (typeof used !== "number" || typeof total !== "number") {
    return fallback;
  }
  return `${formatMetricBytes(used, fallback)} / ${formatMetricBytes(total, fallback)}`;
}

function formatUptime(seconds: number | null | undefined, fallback: string) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return fallback;
  }
  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatRemoteText(value: string | null | undefined, fallback: string) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function formatConnectionAddress(host: Host) {
  return `${host.username}@${host.host}:${host.port}`;
}

function formatDateTimeCompact(value: string | null | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatTimeOfDay(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function isSameCalendarDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function formatFriendlyLoginTime(date: Date | null, fallback: string, t: Translate) {
  if (!date || Number.isNaN(date.getTime())) {
    return fallback;
  }
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameCalendarDay(date, now)) {
    return t("host.loginTodayAt", { time: formatTimeOfDay(date) });
  }
  if (isSameCalendarDay(date, yesterday)) {
    return t("host.loginYesterdayAt", { time: formatTimeOfDay(date) });
  }
  return fallback;
}

function parseLastLoginRecord(rawValue: string | null | undefined, t: Translate): ParsedLoginRecord | null {
  const raw = formatRemoteText(rawValue, "");
  if (!raw) {
    return null;
  }
  const parts = raw.split(" ");
  const dayIndex = parts.findIndex((part) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(part));
  if (dayIndex < 3 || parts.length < dayIndex + 5) {
    return null;
  }

  const user = parts[0];
  const terminal = parts[1];
  const source = parts.slice(2, dayIndex).join(" ");
  const month = parts[dayIndex + 1];
  const day = Number(parts[dayIndex + 2]);
  const time = parts[dayIndex + 3];
  const statusParts = parts.slice(dayIndex + 4);
  const yearPart = statusParts.find((part) => /^\d{4}$/.test(part));
  const year = yearPart ? Number(yearPart) : new Date().getFullYear();
  const [hour = "00", minute = "00"] = time.split(":");
  const monthIndex = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(month);
  const loginDate = monthIndex >= 0 && Number.isFinite(day)
    ? new Date(year, monthIndex, day, Number(hour), Number(minute))
    : null;
  const fullTime = loginDate && !Number.isNaN(loginDate.getTime())
    ? formatDateTimeCompact(loginDate.toISOString(), `${month} ${day} ${time}`)
    : `${month} ${day} ${time}`;
  const loginTime = formatFriendlyLoginTime(loginDate, fullTime, t);
  const isStillOnline = statusParts.join(" ").toLowerCase().includes("still logged in");

  return {
    user,
    terminal,
    source,
    loginTime,
    status: isStillOnline ? t("host.loginStillOnline") : t("host.loginEnded"),
    fullTime
  };
}

function getRecentLoginInputs(login: HostMetrics["login"] | undefined) {
  const recentLogins = login?.recent_logins
    ?.map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean) || [];
  const fallback = formatRemoteText(login?.last_login, "");
  return recentLogins.length > 0 ? recentLogins : fallback ? [fallback] : [];
}

function countUniqueLoginSources(records: ParsedLoginRecord[]) {
  return new Set(records.map((record) => record.source).filter(Boolean)).size;
}

function SectionHeading({ icon: Icon, title, meta }: { icon: SectionIcon; title: string; meta?: string | null }) {
  return (
    <div className="host-detail-section-title">
      <div className="host-detail-title-main">
        <Icon aria-hidden={true} />
        <h5>{title}</h5>
      </div>
      {meta ? <span>{meta}</span> : null}
    </div>
  );
}

function RuntimeMetric({
  detail,
  icon: Icon,
  label,
  value
}: {
  detail?: string;
  icon: SectionIcon;
  label: string;
  value: number | null | undefined;
}) {
  const percent = clampMetricPercent(value);
  return (
    <div className="host-runtime-metric">
      <div className="host-runtime-metric-header">
        <Icon aria-hidden={true} />
        <span>{label}</span>
      </div>
      <strong>{formatMetricPercent(value, "--")}</strong>
      {detail ? <small>{detail}</small> : null}
      <div className="host-runtime-progress" aria-hidden="true">
        <span className="host-runtime-progress-track" />
        <span className="host-runtime-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function sortHostGroups(groups: HostGroup[]) {
  return [...groups].sort((left, right) =>
    left.sort_order === right.sort_order
      ? left.name.localeCompare(right.name)
      : left.sort_order - right.sort_order
  );
}

function reorderHostGroups(items: HostGroup[], draggingId: string, targetId: string) {
  const next = [...items];
  const from = next.findIndex((item) => item.id === draggingId);
  const to = next.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0 || from === to) {
    return null;
  }
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((item, index) => ({ ...item, sort_order: index }));
}

function getHostConnectivityLabel(status: HostConnectivityStatus, t: (key: string) => string) {
  switch (status) {
    case "checking":
      return t("host.connectivityChecking");
    case "fingerprint_required":
      return t("host.connectivityFingerprintRequired");
    case "reachable":
      return t("host.connectivityReachable");
    case "unreachable":
      return t("host.connectivityUnreachable");
    default:
      return t("host.connectivityUnknown");
  }
}

function renderHostConnectivityIcon(status: HostConnectivityStatus) {
  switch (status) {
    case "checking":
      return <LoaderCircle aria-hidden="true" />;
    case "reachable":
      return (
        <span
          aria-hidden="true"
          className="host-connectivity-breathing-dot host-connectivity-breathing-dot-reachable"
        />
      );
    case "unreachable":
      return (
        <span
          aria-hidden="true"
          className="host-connectivity-breathing-dot host-connectivity-breathing-dot-unreachable"
        />
      );
    case "fingerprint_required":
    case "not_checked":
    default:
      return <CircleDashed aria-hidden="true" />;
  }
}

function resolveHostConnectivityStatus(
  status: HostConnectivityStatus | undefined,
  metricsState: HostMetricsLoadState,
  fallback: HostConnectivityStatus
): HostConnectivityStatus {
  if (status && status !== "idle") {
    return status;
  }
  if (metricsState === "ready") {
    return "reachable";
  }
  if (metricsState === "loading") {
    return "checking";
  }
  if (metricsState === "error") {
    return "unreachable";
  }
  return fallback;
}

export function HostsPage({ onHostDeleted, onHostSaved, visible = true }: HostsPageProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const fingerprintDialog = useFingerprintDialog();
  const confirmDialog = useConfirmDialog();
  const toast = useToast();
  const { language, t } = usePreferences();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [hostGroups, setHostGroups] = useState<HostGroup[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [activeHostId, setActiveHostId] = useState<string | null>(null);
  const [activeHost, setActiveHost] = useState<Host | null>(null);
  const [mode, setMode] = useState<EditorMode | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [groupFilterId, setGroupFilterId] = useState("");
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupDialogMode, setGroupDialogMode] = useState<GroupDialogMode>("list");
  const [groupForm, setGroupForm] = useState<HostGroupFormState>(defaultGroupForm);
  const [groupDraggingId, setGroupDraggingId] = useState<string | null>(null);
  const [groupDropTargetId, setGroupDropTargetId] = useState<string | null>(null);
  const [groupReordering, setGroupReordering] = useState(false);
  const [favoriteSubmittingIds, setFavoriteSubmittingIds] = useState<Set<string>>(() => new Set());
  const [listState, setListState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [listError, setListError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pageMessage, setPageMessage] = useState<string | null>(null);
  const [formState, setFormState] = useState<HostFormState>(defaultHostForm());
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hostConnectivity, setHostConnectivity] = useState<Record<string, HostConnectivityStatus>>({});
  const [hostConnectivityPollIntervalMs, setHostConnectivityPollIntervalMs] = useState<number | null>(null);
  const [hostMetricsById, setHostMetricsById] = useState<Record<string, HostMetrics>>({});
  const [hostMetricsLoadState, setHostMetricsLoadState] = useState<Record<string, HostMetricsLoadState>>({});
  const connectivityRunRef = useRef(0);
  const hasShownInitialConnectivityCheckRef = useRef(false);
  const isHostsRouteActive = visible && (location.pathname === "/hosts" || location.pathname.startsWith("/hosts/"));
  const wasHostsRouteActiveRef = useRef(isHostsRouteActive);

  const visibleHosts = useMemo(() => {
    return hosts.filter((host) => {
      const haystack = `${host.name} ${host.username} ${host.host} ${host.port}`.toLowerCase();
      const matchesQuery = !deferredQuery || haystack.includes(deferredQuery);
      const matchesFavorite = !favoriteOnly || host.is_favorite;
      const matchesGroup =
        !groupFilterId ||
        (groupFilterId === "__ungrouped__" ? !host.group_id : host.group_id === groupFilterId);
      return matchesQuery && matchesFavorite && matchesGroup;
    });
  }, [deferredQuery, favoriteOnly, groupFilterId, hosts]);

  const visibleHostIds = useMemo(() => visibleHosts.map((item) => item.id).join("\u0000"), [visibleHosts]);

  const groupNameById = useMemo(() => {
    return new Map(hostGroups.map((group) => [group.id, group.name]));
  }, [hostGroups]);

  const orderedHostGroups = useMemo(() => sortHostGroups(hostGroups), [hostGroups]);
  const useGroupFilterChips = orderedHostGroups.length <= 3;
  const useGroupFilterSelect = orderedHostGroups.length > 3;

  const selectedCredential = useMemo(
    () => credentials.find((item) => item.id === activeHost?.credential_id) || null,
    [activeHost?.credential_id, credentials]
  );
  const activeHostMetrics = activeHost ? hostMetricsById[activeHost.id] : undefined;
  const activeHostMetricsState = activeHost ? hostMetricsLoadState[activeHost.id] || "idle" : "idle";
  const activeConnectionAddress = activeHost ? formatConnectionAddress(activeHost) : "";
  const activeHostConnectivityStatus: HostConnectivityStatus = activeHost
    ? resolveHostConnectivityStatus(hostConnectivity[activeHost.id], activeHostMetricsState, "unreachable")
    : "idle";
  const parsedLoginRecords = useMemo(
    () => getRecentLoginInputs(activeHostMetrics?.login)
      .map((item) => parseLastLoginRecord(item, t))
      .filter((item): item is ParsedLoginRecord => Boolean(item)),
    [activeHostMetrics?.login, t]
  );
  const displayedLoginRecords = useMemo(
    () => parsedLoginRecords.slice(0, 3),
    [parsedLoginRecords]
  );
  const uniqueLoginSourceCount = useMemo(
    () => countUniqueLoginSources(parsedLoginRecords),
    [parsedLoginRecords]
  );

  const formCredentialOptions = useMemo(
    () => credentials.filter((item) => item.auth_type === formState.authType),
    [credentials, formState.authType]
  );

  const closeModal = () => {
    setMode(null);
    setActiveHostId(null);
    setActiveHost(null);
    setDetailState("idle");
    setFormError(null);
    setFormState(defaultHostForm());
  };

  const loadCredentials = useCallback(async () => {
    try {
      const response = await listCredentials();
      setCredentials(response.items);
    } catch {
      setCredentials([]);
    }
  }, []);

  const loadHostGroups = async () => {
    try {
      const response = await listHostGroups();
      setHostGroups(sortHostGroups(response.items));
    } catch {
      setHostGroups([]);
    }
  };

  const loadHosts = async (nextGroupFilterId = groupFilterId) => {
    setListState("loading");
    setListError(null);

    try {
      const serverGroupId = nextGroupFilterId && nextGroupFilterId !== "__ungrouped__" ? nextGroupFilterId : undefined;
      const response = await listHosts(undefined, false, serverGroupId);
      setHosts(response.items);
      setListState("ready");
    } catch (error) {
      setHosts([]);
      setListState("error");
      const message = getApiErrorMessage(error, t("host.loadFailed"), t);
      setListError(message);
      toast.error(message);
    }
  };

  const loadHostMetrics = useCallback(async (hostId: string, options: { force?: boolean } = {}) => {
    let shouldLoad = true;
    setHostMetricsLoadState((current) => {
      const currentState = current[hostId];
      if (!options.force && (currentState === "loading" || currentState === "ready")) {
        shouldLoad = false;
        return current;
      }
      return { ...current, [hostId]: "loading" };
    });
    if (!shouldLoad) {
      return;
    }

    try {
      const response = await getHostMetrics(hostId);
      setHostMetricsById((current) => ({ ...current, [hostId]: response.metrics }));
      setHostMetricsLoadState((current) => ({ ...current, [hostId]: "ready" }));
      setHostConnectivity((current) => (
        current[hostId] === "fingerprint_required" ||
        current[hostId] === "not_checked" ||
        current[hostId] === "unreachable"
          ? current
          : { ...current, [hostId]: "reachable" }
      ));
    } catch {
      setHostMetricsLoadState((current) => ({ ...current, [hostId]: "error" }));
    }
  }, []);

  useEffect(() => {
    void loadCredentials();
    void loadHostGroups();
  }, []);

  useEffect(() => {
    if (!isHostsRouteActive) {
      wasHostsRouteActiveRef.current = false;
      return;
    }

    const refreshCredentials = () => {
      void loadCredentials();
    };
    const refreshCredentialsWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshCredentials();
      }
    };

    if (!wasHostsRouteActiveRef.current) {
      refreshCredentials();
    }
    wasHostsRouteActiveRef.current = true;
    window.addEventListener("focus", refreshCredentials);
    document.addEventListener("visibilitychange", refreshCredentialsWhenVisible);

    return () => {
      window.removeEventListener("focus", refreshCredentials);
      document.removeEventListener("visibilitychange", refreshCredentialsWhenVisible);
    };
  }, [isHostsRouteActive, loadCredentials]);

  useEffect(() => {
    let disposed = false;

    const loadConnectivityConfig = async () => {
      try {
        const config = await getAuthConfig();
        if (disposed) {
          return;
        }
        setHostConnectivityPollIntervalMs(
          normalizeHostConnectivityPollIntervalSeconds(config.host_connectivity_poll_interval_seconds) * 1000
        );
      } catch {
        if (!disposed) {
          setHostConnectivityPollIntervalMs(defaultHostConnectivityPollIntervalSeconds * 1000);
        }
      }
    };

    void loadConnectivityConfig();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    void loadHosts(groupFilterId);
  }, [groupFilterId]);

  useEffect(() => {
    if (!isHostsRouteActive || listState !== "ready" || visibleHosts.length === 0) {
      return;
    }
    visibleHosts.forEach((host) => {
      void loadHostMetrics(host.id);
    });
  }, [isHostsRouteActive, listState, loadHostMetrics, visibleHostIds]);

  useEffect(() => {
    if (!isHostsRouteActive || !activeHostId || mode === "create") {
      return;
    }

    let disposed = false;

    const loadDetail = async () => {
      setDetailState("loading");
      setFormError(null);

      try {
        const response = await getHost(activeHostId);
        if (disposed) {
          return;
        }
        setActiveHost(response.host);
        setFormState(defaultHostForm(response.host));
        setDetailState("ready");
      } catch (error) {
        if (disposed) {
          return;
        }
        setActiveHost(null);
        setDetailState("error");
        const message = getApiErrorMessage(error, t("host.detailFailed"), t);
        setFormError(message);
        toast.error(message);
      }
    };

    void loadDetail();

    return () => {
      disposed = true;
    };
  }, [activeHostId, isHostsRouteActive, mode]);

  useEffect(() => {
    if (isHostsRouteActive && mode === "view" && activeHostId) {
      void loadHostMetrics(activeHostId, { force: true });
    }
  }, [activeHostId, isHostsRouteActive, loadHostMetrics, mode]);

  const checkVisibleHostConnectivity = useCallback(async (items: Host[], options: { showChecking?: boolean } = {}) => {
    if (items.length === 0) {
      return;
    }

    const runId = connectivityRunRef.current + 1;
    connectivityRunRef.current = runId;
    const hostIds = items.map((item) => item.id);

    if (options.showChecking) {
      setHostConnectivity((current) => {
        const next = { ...current };
        hostIds.forEach((id) => {
          if (!current[id] || current[id] === "idle") {
            next[id] = "checking";
          }
        });
        return next;
      });
    }

    const results = await Promise.all(
      items.map(async (item) => {
        try {
          const result = await testHost(item.id, {});
          if (result.kind === "fingerprint_conflict") {
            return [item.id, "fingerprint_required"] as const;
          }
          return [item.id, result.data.ok ? "reachable" : "unreachable"] as const;
        } catch {
          return [item.id, "unreachable"] as const;
        }
      })
    );

    if (connectivityRunRef.current !== runId) {
      return;
    }

    setHostConnectivity((current) => {
      const next = { ...current };
      results.forEach(([id, status]) => {
        next[id] = status;
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isHostsRouteActive || listState !== "ready" || visibleHosts.length === 0 || hostConnectivityPollIntervalMs === null) {
      return;
    }

    let disposed = false;
    const runCheck = () => {
      if (!disposed) {
        const showChecking = !hasShownInitialConnectivityCheckRef.current;
        if (showChecking) {
          hasShownInitialConnectivityCheckRef.current = true;
        }
        void checkVisibleHostConnectivity(visibleHosts, { showChecking });
      }
    };

    runCheck();
    const intervalId = window.setInterval(runCheck, hostConnectivityPollIntervalMs);

    return () => {
      disposed = true;
      connectivityRunRef.current += 1;
      window.clearInterval(intervalId);
    };
  }, [checkVisibleHostConnectivity, hostConnectivityPollIntervalMs, isHostsRouteActive, listState, visibleHostIds]);

  const beginCreate = () => {
    setPageMessage(null);
    setFormError(null);
    setMode("create");
    setActiveHostId(null);
    setActiveHost(null);
    setFormState(defaultHostForm());
  };

  const openHost = (host: Host, nextMode: EditorMode) => {
    setPageMessage(null);
    setFormError(null);
    setMode(nextMode);
    setActiveHost(host);
    setActiveHostId(host.id);
    setFormState(defaultHostForm(host));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setPageMessage(null);

    const payload: CreateHostInput = {
      name: formState.name.trim(),
      group_id: formState.groupId || null,
      host: formState.host.trim(),
      port: Number(formState.port),
      username: formState.username.trim(),
      auth_type: formState.authType,
      is_favorite: formState.isFavorite,
      credential_id: formState.credentialId || null
    };

    try {
      if (mode === "edit" && activeHost) {
        const response = await updateHost(activeHost.id, payload);
        onHostSaved?.(response.host);
        setHostConnectivity((current) => ({ ...current, [response.host.id]: "not_checked" }));
        const message = t("host.updated");
        setPageMessage(message);
        toast.success(message);
      } else {
        const response = await createHost(payload);
        onHostSaved?.(response.host);
        setHostConnectivity((current) => ({ ...current, [response.host.id]: "not_checked" }));
        const message = t("host.created");
        setPageMessage(message);
        toast.success(message);
      }
      closeModal();
      await loadHosts();
    } catch (error) {
      const message = getApiErrorMessage(error, mode === "edit" ? t("host.updateFailed") : t("host.createFailed"), t);
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteHost = async (host: Host) => {
    const shouldDelete = await confirmDialog.requestConfirmation({
      title: t("host.deleteTitle"),
      message: t("host.deleteMessage", { name: host.name }),
      confirmLabel: t("host.confirmDelete"),
      tone: "danger"
    });
    if (!shouldDelete) {
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setPageMessage(null);

    try {
      await deleteHost(host.id);
      onHostDeleted?.(host.id);
      const message = t("host.deleted");
      setPageMessage(message);
      toast.success(message);
      closeModal();
      await loadHosts();
    } catch (error) {
      const message = getApiErrorMessage(error, t("host.deleteFailed"), t);
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleFavorite = async (host: Host) => {
    setPageMessage(null);
    setFormError(null);
    setFavoriteSubmittingIds((current) => new Set([...current, host.id]));

    try {
      const response = await updateHost(host.id, { is_favorite: !host.is_favorite });
      onHostSaved?.(response.host);
      setHosts((current) => current.map((item) => (item.id === host.id ? response.host : item)));
      if (activeHost?.id === host.id) {
        setActiveHost(response.host);
        setFormState(defaultHostForm(response.host));
      }
      const message = response.host.is_favorite ? t("host.favoriteAdded") : t("host.favoriteRemoved");
      setPageMessage(message);
      toast.success(message);
    } catch (error) {
      const message = getApiErrorMessage(error, t("host.favoriteUpdateFailed"), t);
      setFormError(message);
      toast.error(message);
    } finally {
      setFavoriteSubmittingIds((current) => {
        const next = new Set(current);
        next.delete(host.id);
        return next;
      });
    }
  };

  const getHostTestInput = (): TestHostInput => ({
    host: formState.host.trim(),
    port: Number(formState.port),
    username: formState.username.trim(),
    auth_type: formState.authType,
    credential_id: formState.credentialId || null
  });

  const getHostTestSuccessMessage = (result: TestHostResponse) => {
    const fingerprint = result.fingerprint?.fingerprint
      ? `${result.fingerprint.algorithm} ${result.fingerprint.fingerprint}`
      : "";
    return fingerprint ? `${t("host.connectSuccess")} · ${fingerprint}` : t("host.connectSuccess");
  };

  const executeHostTest = (host: Host, input: TestHostInput) => testHost(host.id, input);

  const handleTest = async () => {
    const host = activeHost;
    if (!host) {
      return;
    }

    setTesting(true);
    const testInput = getHostTestInput();

    try {
      const result = await executeHostTest(host, testInput);
      if (result.kind === "success") {
        if (result.data.ok) {
          toast.success(getHostTestSuccessMessage(result.data));
          await loadHosts();
        } else {
          const message = result.data.message
            ? localizeConnectionErrorMessage(result.data.message, t)
            : t("host.testFailed");
          toast.error(message);
        }
        return;
      }

      const confirmed = await fingerprintDialog.requestConfirmation({
        hostId: host.id,
        hostLabel: host.name,
        actionLabel: t("host.fingerprintAction"),
        conflict: result.data
      });

      if (!confirmed) {
        const message = t("host.fingerprintCancelled");
        toast.warning(message);
        return;
      }

      const retryResult = await executeHostTest(host, testInput);
      if (retryResult.kind === "success") {
        if (retryResult.data.ok) {
          toast.success(getHostTestSuccessMessage(retryResult.data));
          await loadHosts();
        } else {
          const message = retryResult.data.message
            ? localizeConnectionErrorMessage(retryResult.data.message, t)
            : t("host.testFailed");
          toast.error(message);
        }
        return;
      }

      const retryConflictMessage = t("host.fingerprintRetryConflict");
      toast.error(retryConflictMessage);
    } catch (error) {
      const message = getConnectionErrorMessage(error, t("host.testFailed"), t);
      toast.error(message);
    } finally {
      setTesting(false);
    }
  };

  const openGroupManager = () => {
    setGroupForm(defaultGroupForm());
    setGroupDialogMode("list");
    setGroupDialogOpen(true);
    setFormError(null);
  };

  const editGroup = (group: HostGroup) => {
    setGroupForm({ id: group.id, name: group.name });
    setGroupDialogMode("edit");
    setFormError(null);
    setPageMessage(null);
  };

  const beginCreateGroup = () => {
    setGroupForm(defaultGroupForm());
    setGroupDialogMode("create");
    setFormError(null);
    setPageMessage(null);
  };

  const cancelGroupForm = () => {
    setGroupForm(defaultGroupForm());
    setGroupDialogMode("list");
    setFormError(null);
  };

  const handleSubmitGroup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setPageMessage(null);

    try {
      const existingGroup = hostGroups.find((group) => group.id === groupForm.id);
      const payload = {
        name: groupForm.name.trim(),
        sort_order: existingGroup?.sort_order ?? hostGroups.length
      };
      if (groupForm.id) {
        await updateHostGroup(groupForm.id, payload);
        const message = t("host.groupUpdated");
        setPageMessage(message);
        toast.success(message);
      } else {
        await createHostGroup(payload);
        const message = t("host.groupCreated");
        setPageMessage(message);
        toast.success(message);
      }
      setGroupForm(defaultGroupForm());
      setGroupDialogMode("list");
      await loadHostGroups();
    } catch (error) {
      const message = getApiErrorMessage(
        error,
        groupForm.id ? t("host.groupUpdateFailed") : t("host.groupCreateFailed"),
        t
      );
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteGroup = async (group: HostGroup) => {
    const shouldDelete = await confirmDialog.requestConfirmation({
      title: t("host.groupDeleteTitle"),
      message: t("host.groupDeleteMessage", { name: group.name }),
      confirmLabel: t("host.groupConfirmDelete"),
      tone: "danger"
    });
    if (!shouldDelete) {
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setPageMessage(null);
    try {
      await deleteHostGroup(group.id);
      const message = t("host.groupDeleted");
      setPageMessage(message);
      toast.success(message);
      const nextFilter = groupFilterId === group.id ? "" : groupFilterId;
      setGroupFilterId(nextFilter);
      setGroupForm(defaultGroupForm());
      setGroupDialogMode("list");
      await loadHostGroups();
      await loadHosts(nextFilter);
    } catch (error) {
      const message = getApiErrorMessage(error, t("host.groupDeleteFailed"), t);
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGroupDragStart = (event: React.DragEvent<HTMLElement>, groupId: string) => {
    if (groupDialogMode !== "list") {
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", groupId);
    setGroupDraggingId(groupId);
  };

  const handleGroupDragOver = (event: React.DragEvent<HTMLElement>, groupId: string) => {
    if (groupDialogMode !== "list") {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setGroupDropTargetId(groupId);
  };

  const handleGroupDragEnd = () => {
    setGroupDraggingId(null);
    setGroupDropTargetId(null);
  };

  const handleGroupDrop = async (event: React.DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    const draggingId = event.dataTransfer.getData("text/plain");
    setGroupDraggingId(null);
    setGroupDropTargetId(null);
    if (!draggingId || draggingId === targetId) {
      return;
    }
    const reordered = reorderHostGroups(orderedHostGroups, draggingId, targetId);
    if (!reordered) {
      return;
    }

    setHostGroups(reordered);
    setGroupReordering(true);
    setFormError(null);
    try {
      await Promise.all(
        reordered
          .filter((item) => item.sort_order !== hostGroups.find((group) => group.id === item.id)?.sort_order)
          .map((item) =>
            updateHostGroup(item.id, {
              name: item.name,
              sort_order: item.sort_order
            })
          )
      );
      await loadHostGroups();
    } catch (error) {
      const message = getApiErrorMessage(error, t("host.groupUpdateFailed"), t);
      setFormError(message);
      toast.error(message);
      await loadHostGroups();
    } finally {
      setGroupReordering(false);
    }
  };

  const groupDialogTitle =
    groupDialogMode === "create"
      ? t("host.groupCreateTitle")
      : groupDialogMode === "edit"
        ? t("host.groupEditTitle")
        : t("host.groupManageTitle");

  return (
    <div className="route-page credentials-page">
      <p className="eyebrow route-eyebrow">Host Manager</p>

      <section className="content-card resource-panel">
        <div className="section-header">
          <div>
            <h4>{t("host.listTitle")}</h4>
            <p>{t("host.summary", { visible: visibleHosts.length, total: hosts.length })}</p>
          </div>
          <div className="resource-toolbar">
            <IconButton label={t("host.new")} onClick={beginCreate}>
              <Plus aria-hidden="true" />
            </IconButton>
            <IconButton label={t("host.manageGroups")} onClick={openGroupManager}>
              <FolderPlus aria-hidden="true" />
            </IconButton>
            <IconButton
              aria-pressed={favoriteOnly}
              label={t("host.favorite")}
              onClick={() => setFavoriteOnly((current) => !current)}
            >
              <Star aria-hidden="true" className={favoriteOnly ? "host-card-star-active" : undefined} />
            </IconButton>
            <IconButton label={t("host.refresh")} onClick={() => void loadHosts()}>
              <RefreshCw aria-hidden="true" />
            </IconButton>
          </div>
        </div>

        <div className="host-filter-bar">
          <FormField className="host-search-field" label={t("host.search")}>
            {(id) => (
              <TextInput
                id={id}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("host.searchPlaceholder")}
                type="search"
                value={query}
              />
            )}
          </FormField>

          {useGroupFilterChips ? (
            <div className="host-group-filter-row terminal-command-filter-row" aria-label={t("host.group")}>
              <span className="terminal-command-filter-label">{t("host.group")}</span>
              <div className="terminal-command-category-chips">
                <FilterChip active={!groupFilterId} onClick={() => setGroupFilterId("")} size="md">
                  {t("host.allGroups")}
                </FilterChip>
                <FilterChip active={groupFilterId === "__ungrouped__"} onClick={() => setGroupFilterId("__ungrouped__")} size="md">
                  {t("host.ungrouped")}
                </FilterChip>
                {orderedHostGroups.map((group) => (
                  <FilterChip
                    active={groupFilterId === group.id}
                    key={group.id}
                    onClick={() => setGroupFilterId(group.id)}
                    size="md"
                  >
                    {group.name}
                  </FilterChip>
                ))}
              </div>
            </div>
          ) : null}

          {useGroupFilterSelect ? (
            <div className="host-filter-controls">
              <FormField className="host-group-filter-field" label={t("host.group")}>
                {(id) => (
                  <SelectInput id={id} onChange={(event) => setGroupFilterId(event.target.value)} value={groupFilterId}>
                    <option value="">{t("host.allGroups")}</option>
                    <option value="__ungrouped__">{t("host.ungrouped")}</option>
                    {orderedHostGroups.map((group) => (
                      <option key={group.id} value={group.id}>{group.name}</option>
                    ))}
                  </SelectInput>
                )}
              </FormField>
            </div>
          ) : null}
        </div>

        <div className={listState === "loading" ? "resource-card-area resource-card-area-loading" : "resource-card-area"}>
          {listState === "loading" ? (
            <div className="loading-overlay">
              <LoadingState label={t("host.loading")} />
            </div>
          ) : null}

          {listState === "ready" && visibleHosts.length === 0 ? (
            <div className="empty-state">
              <p>{t("host.empty1")}</p>
              <p>{t("host.empty2")}</p>
            </div>
          ) : null}

          <div className="resource-card-grid">
            {visibleHosts.map((host) => {
              const shouldShowInitialConnectivityCheck =
                isHostsRouteActive && listState === "ready" && !hasShownInitialConnectivityCheckRef.current;
              const metricsState = hostMetricsLoadState[host.id] || "idle";
              const connectivityStatus = resolveHostConnectivityStatus(
                hostConnectivity[host.id],
                metricsState,
                shouldShowInitialConnectivityCheck ? "checking" : "idle"
              );
              const connectivityLabel = getHostConnectivityLabel(connectivityStatus, t);
              const metrics = hostMetricsById[host.id];

              return (
                <article className="resource-card host-resource-card" key={host.id}>
                  <div className="host-card-header">
                    <div className="host-card-title-row">
                      <span
                        aria-label={connectivityLabel}
                        className={`host-connectivity-indicator host-connectivity-indicator-${connectivityStatus}`}
                        title={connectivityLabel}
                      >
                        {renderHostConnectivityIcon(connectivityStatus)}
                      </span>
                      <strong>{host.name}</strong>
                    </div>
                    <div className="host-card-metrics" aria-label={t("host.cardMetrics")}>
                      <span>CPU {formatMetricPercent(metrics?.cpu_usage_percent, "--%")}</span>
                      <span>MEM {formatMetricPercent(metrics?.memory_usage_percent, "--%")}</span>
                    </div>
                  </div>
                  <div className="host-card-body">
                    <span>{formatConnectionAddress(host)}</span>
                  </div>
                  <div className="chip-row host-card-tags">
                    {host.is_favorite ? <span className="tag">{t("host.favorite")}</span> : null}
                    {host.group_id ? <span className="tag">{groupNameById.get(host.group_id) || t("host.unknownGroup")}</span> : null}
                    <span className="tag">{formatAuthType(host.auth_type, t)}</span>
                  </div>
                  <div className="host-card-footer">
                    <div className="resource-card-actions">
                      <IconButton
                        className="ui-action-icon"
                        label={t("common.viewDetails")}
                        onClick={(event) => {
                          event.stopPropagation();
                          openHost(host, "view");
                        }}
                      >
                        <Info aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        className="ui-action-icon"
                        label={t("host.edit")}
                        onClick={(event) => {
                          event.stopPropagation();
                          openHost(host, "edit");
                        }}
                      >
                        <Pencil aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        className="ui-action-icon"
                        label={t("host.connectTerminal")}
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/terminal?host_id=${host.id}`);
                        }}
                      >
                        <Monitor aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        className="ui-action-icon"
                        label={t("host.openFiles")}
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/files?host_id=${host.id}`);
                        }}
                      >
                        <FolderOpen aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        aria-pressed={host.is_favorite}
                        className="ui-action-icon"
                        disabled={favoriteSubmittingIds.has(host.id)}
                        label={host.is_favorite ? t("host.removeFavorite") : t("host.addFavorite")}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleToggleFavorite(host);
                        }}
                      >
                        <Star aria-hidden="true" className={host.is_favorite ? "host-card-star-active" : undefined} />
                      </IconButton>
                      <IconButton
                        className="ui-action-icon ui-action-icon-danger"
                        label={t("host.delete")}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteHost(host);
                        }}
                        variant="danger"
                      >
                        <Trash2 aria-hidden="true" />
                      </IconButton>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {mode === "view" ? (
        <Dialog
          closeLabel={t("common.close")}
          onOpenChange={(open) => {
            if (!open) {
              closeModal();
            }
          }}
          open={Boolean(mode)}
          size="lg"
          title={t("host.detailTitle")}
        >
          {detailState === "loading" && !activeHost ? <p>{t("host.loadingDetail")}</p> : null}

          {activeHost ? (
            <div className="host-detail-dialog">
              <section className="host-detail-overview">
                <div className="host-detail-overview-header">
                  <div className="host-detail-overview-title">
                    <span
                      aria-label={getHostConnectivityLabel(activeHostConnectivityStatus, t)}
                      className={`host-connectivity-indicator host-connectivity-indicator-${activeHostConnectivityStatus}`}
                      title={getHostConnectivityLabel(activeHostConnectivityStatus, t)}
                    >
                      {renderHostConnectivityIcon(activeHostConnectivityStatus)}
                    </span>
                    <div>
                      <span>{t("host.overview")}</span>
                      <strong>{activeHost.name}</strong>
                    </div>
                  </div>
                  <IconButton
                    className="ui-action-icon host-detail-overview-edit"
                    label={t("credential.edit")}
                    onClick={() => setMode("edit")}
                  >
                    <Pencil aria-hidden="true" />
                  </IconButton>
                </div>
                <dl className="host-overview-list">
                  <div>
                    <dt>{t("host.connectionAddress")}</dt>
                    <dd>{activeConnectionAddress}</dd>
                  </div>
                  <div>
                    <dt>{t("host.group")}</dt>
                    <dd>{activeHost.group_id ? groupNameById.get(activeHost.group_id) || t("host.unknownGroup") : t("host.ungrouped")}</dd>
                  </div>
                  <div>
                    <dt>{t("credential.authType")}</dt>
                    <dd>{formatAuthType(activeHost.auth_type, t)}</dd>
                  </div>
                  <div>
                    <dt>{t("host.lastConnected")}</dt>
                    <dd>{formatDateTime(activeHost.last_connected_at, language, t("common.notRecorded"))}</dd>
                  </div>
                </dl>
              </section>

              <div className="host-detail-top-grid">
                <section className="host-detail-section host-connection-section">
                  <SectionHeading icon={Link2} title={t("host.connectionInfo")} />
                  <dl className="detail-list host-detail-list">
                    <div>
                      <dt>{t("host.connectionAddress")}</dt>
                      <dd>{activeHost.host}:{activeHost.port}</dd>
                    </div>
                    <div>
                      <dt>{t("host.group")}</dt>
                      <dd>{activeHost.group_id ? groupNameById.get(activeHost.group_id) || t("host.unknownGroup") : t("host.ungrouped")}</dd>
                    </div>
                    <div>
                      <dt>{t("credential.authType")}</dt>
                      <dd>{formatAuthType(activeHost.auth_type, t)}</dd>
                    </div>
                    <div>
                      <dt>{t("host.boundCredential")}</dt>
                      <dd>{selectedCredential?.name || t("host.notBound")}</dd>
                    </div>
                    <div>
                      <dt>{t("host.favorite")}</dt>
                      <dd>{activeHost.is_favorite ? t("common.yes") : t("common.no")}</dd>
                    </div>
                  </dl>
                </section>
                <section className="host-detail-section host-runtime-section">
                  <SectionHeading
                    icon={Activity}
                    meta={activeHostMetricsState === "loading" ? t("host.metricsLoading") : activeHostMetricsState === "error" ? t("host.metricsUnavailable") : null}
                    title={t("host.runtimeMonitoring")}
                  />
                  <div className="host-runtime-grid">
                    <RuntimeMetric
                      icon={Activity}
                      label={t("host.cpuUsage")}
                      value={activeHostMetrics?.cpu_usage_percent}
                    />
                    <RuntimeMetric
                      detail={formatMetricBytePair(activeHostMetrics?.memory_used_bytes, activeHostMetrics?.memory_total_bytes, "--")}
                      icon={BarChart3}
                      label={t("host.memoryUsage")}
                      value={activeHostMetrics?.memory_usage_percent}
                    />
                    <RuntimeMetric
                      detail={formatMetricBytePair(activeHostMetrics?.disk_used_bytes, activeHostMetrics?.disk_total_bytes, "--")}
                      icon={Server}
                      label={t("host.diskUsage")}
                      value={activeHostMetrics?.disk_usage_percent}
                    />
                    <RuntimeMetric
                      icon={BarChart3}
                      label={t("host.gpuUsage")}
                      value={activeHostMetrics?.gpu_usage_percent}
                    />
                  </div>
                  <div className="host-uptime-card">
                    <div>
                      <Clock3 aria-hidden="true" />
                      <span>{t("host.uptime")}</span>
                    </div>
                    <strong>{formatUptime(activeHostMetrics?.uptime_seconds, "--")}</strong>
                  </div>
                </section>
              </div>

              <div className="host-detail-secondary-grid">
                <section className="host-detail-section">
                  <SectionHeading icon={Server} title={t("host.systemInformation")} />
                  <dl className="detail-list host-detail-list">
                    <div>
                      <dt>{t("host.hostname")}</dt>
                      <dd>{activeHostMetrics?.system.hostname || "--"}</dd>
                    </div>
                    <div>
                      <dt>{t("host.osName")}</dt>
                      <dd>{activeHostMetrics?.system.os_name || "--"}</dd>
                    </div>
                    <div>
                      <dt>{t("host.kernel")}</dt>
                      <dd>{activeHostMetrics?.system.kernel || "--"}</dd>
                    </div>
                  </dl>
                </section>
                <section className="host-detail-section">
                  <SectionHeading icon={Terminal} title={t("host.sshLoginInformation")} />
                  <dl className="detail-list host-detail-list">
                    <div>
                      <dt>{t("host.sshUser")}</dt>
                      <dd>{activeHostMetrics?.ssh.user || activeHost.username}</dd>
                    </div>
                    <div>
                      <dt>{t("host.sshClient")}</dt>
                      <dd>{activeHostMetrics?.ssh.client || "--"}</dd>
                    </div>
                  </dl>
                </section>
              </div>

              <section className="host-detail-section host-detail-login-section">
                <SectionHeading icon={History} title={t("host.loginStatistics")} />
                <div className="host-login-summary-grid">
                  <div className="host-login-summary-card">
                    <span>{t("host.activeLoginCount")}</span>
                    <strong>{activeHostMetrics?.login.active_login_count ?? "--"}</strong>
                  </div>
                  <div className="host-login-summary-card">
                    <span>{t("host.recentLoginRecords")}</span>
                    <strong>{parsedLoginRecords.length || "--"}</strong>
                  </div>
                  <div className="host-login-summary-card">
                    <span>{t("host.uniqueSourceIps")}</span>
                    <strong>{uniqueLoginSourceCount || "--"}</strong>
                  </div>
                </div>
                <div className="host-login-records">
                  <h6>{t("host.recentLoginRecords")}</h6>
                  {parsedLoginRecords.length > 0 ? (
                    <div className="host-login-record-list">
                      {displayedLoginRecords.map((record, index) => (
                        <div className="host-login-record" key={`${record.user}-${record.terminal}-${record.fullTime}-${index}`}>
                          <div className="host-login-record-main">
                            <strong title={record.user}>{record.user}</strong>
                            <span title={record.source}>{record.source}</span>
                          </div>
                          <span>{record.terminal}</span>
                          <time title={record.fullTime}>{record.loginTime}</time>
                          <span className={record.status === t("host.loginStillOnline") ? "host-login-status-online" : "host-login-status-ended"}>
                            {record.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-text">{t("host.noLoginRecords")}</p>
                  )}
                </div>
              </section>

              <div className="editor-actions">
                <Button onClick={() => navigate(`/terminal?host_id=${activeHost.id}`)} variant="secondary">{t("host.openTerminal")}</Button>
                <Button onClick={() => navigate(`/files?host_id=${activeHost.id}`)} variant="secondary">{t("host.openFiles")}</Button>
                <Button onClick={() => void handleDeleteHost(activeHost)} variant="danger">{t("credential.delete")}</Button>
              </div>
            </div>
          ) : null}
        </Dialog>
      ) : null}

      {mode && mode !== "view" ? (
        <Dialog
          closeLabel={t("common.close")}
          onOpenChange={(open) => {
            if (!open) {
              closeModal();
            }
          }}
          open={Boolean(mode)}
          size="lg"
          title={mode === "create" ? t("host.createTitle") : mode === "edit" ? t("host.editTitle") : t("host.detailTitle")}
        >
          {detailState === "loading" && mode !== "create" && !activeHost ? <p>{t("host.loadingDetail")}</p> : null}

          {mode === "create" || mode === "edit" ? (
            <form className="auth-form" onSubmit={handleSubmit}>
              <FormField label={t("common.name")}>
                {(id) => (
                  <TextInput
                    id={id}
                    onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
                    required
                    type="text"
                    value={formState.name}
                  />
                )}
              </FormField>

              <div className="host-form-grid">
                <FormField label={t("host.address")}>
                  {(id) => (
                    <TextInput
                      id={id}
                      onChange={(event) => setFormState((current) => ({ ...current, host: event.target.value }))}
                      required
                      type="text"
                      value={formState.host}
                    />
                  )}
                </FormField>
                <FormField label={t("host.port")}>
                  {(id) => (
                    <TextInput
                      id={id}
                      max={65535}
                      min={1}
                      onChange={(event) => setFormState((current) => ({ ...current, port: event.target.value }))}
                      required
                      type="number"
                      value={formState.port}
                    />
                  )}
                </FormField>
              </div>

              <div className="host-form-grid">
                <FormField label={t("host.username")}>
                  {(id) => (
                    <TextInput
                      id={id}
                      onChange={(event) => setFormState((current) => ({ ...current, username: event.target.value }))}
                      required
                      type="text"
                      value={formState.username}
                    />
                  )}
                </FormField>
                <FormField label={t("credential.authType")}>
                  {(id) => (
                    <SelectInput
                      id={id}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          authType: event.target.value as HostAuthType,
                          credentialId: ""
                        }))
                      }
                      value={formState.authType}
                    >
                      <option value="password">{t("credential.password")}</option>
                      <option value="private_key">{t("credential.privateKey")}</option>
                    </SelectInput>
                  )}
                </FormField>
              </div>

              <FormField label={t("host.group")}>
                {(id) => (
                  <SelectInput id={id} onChange={(event) => setFormState((current) => ({ ...current, groupId: event.target.value }))} value={formState.groupId}>
                    <option value="">{t("host.ungrouped")}</option>
                    {orderedHostGroups.map((group) => (
                      <option key={group.id} value={group.id}>{group.name}</option>
                    ))}
                  </SelectInput>
                )}
              </FormField>

              <FormField label={t("host.bindCredential")}>
                {(id) => (
                  <SelectInput id={id} onChange={(event) => setFormState((current) => ({ ...current, credentialId: event.target.value }))} value={formState.credentialId}>
                    <option value="">{t("host.noCredential")}</option>
                    {formCredentialOptions.map((credential) => (
                      <option key={credential.id} value={credential.id}>{credential.name}</option>
                    ))}
                  </SelectInput>
                )}
              </FormField>

              <ToggleRow
                checked={formState.isFavorite}
                label={t("host.addFavorite")}
                onChange={(event) => setFormState((current) => ({ ...current, isFavorite: event.target.checked }))}
              />

              <div className="editor-actions">
                <Button onClick={closeModal} variant="secondary">{t("common.cancel")}</Button>
                {mode === "edit" && activeHost ? (
                  <Button disabled={submitting || testing} onClick={() => void handleTest()} type="button" variant="secondary">
                    {testing ? t("host.testing") : t("host.test")}
                  </Button>
                ) : null}
                <Button disabled={submitting} type="submit" variant="primary">
                  {submitting ? (mode === "edit" ? t("host.saving") : t("host.creating")) : mode === "edit" ? t("host.save") : t("host.create")}
                </Button>
              </div>
            </form>
          ) : null}
        </Dialog>
      ) : null}

      <Dialog
        closeLabel={t("common.close")}
        headerActions={groupDialogMode === "list" ? (
          <IconButton label={t("host.groupCreateTitle")} onClick={beginCreateGroup} variant="ghost">
            <Plus aria-hidden="true" />
          </IconButton>
        ) : undefined}
        onOpenChange={(open) => {
          if (!open) {
            setGroupDialogOpen(false);
            setGroupDialogMode("list");
            setGroupForm(defaultGroupForm());
            setFormError(null);
          }
        }}
        open={groupDialogOpen}
        size="md"
        title={groupDialogTitle}
      >
        <div className="host-group-dialog-body">
          {groupDialogMode === "create" || groupDialogMode === "edit" ? (
            <div className="host-group-form-card">
              <form className="host-group-form" onSubmit={handleSubmitGroup}>
                <FormField label={t("host.groupName")}>
                  {(id) => (
                    <TextInput
                      id={id}
                      onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
                      required
                      type="text"
                      value={groupForm.name}
                    />
                  )}
                </FormField>
                <div className="host-group-form-actions">
                  <Button onClick={cancelGroupForm} size="sm" variant="secondary">
                    {t("common.cancel")}
                  </Button>
                  <Button disabled={submitting} size="sm" type="submit" variant="primary">
                    {groupDialogMode === "edit" ? t("host.groupSaveChanges") : t("host.groupCreate")}
                  </Button>
                </div>
              </form>
            </div>
          ) : null}

          {groupDialogMode === "list" ? (
            <div className={`host-group-list ${groupReordering ? "host-group-list-reordering" : ""}`}>
              {orderedHostGroups.map((group) => (
                <article
                  className={[
                    "host-group-item",
                    groupDraggingId === group.id ? "host-group-item-dragging" : "",
                    groupDropTargetId === group.id ? "host-group-item-drop-target" : ""
                  ].filter(Boolean).join(" ")}
                  draggable
                  key={group.id}
                  onDragEnd={handleGroupDragEnd}
                  onDragOver={(event) => handleGroupDragOver(event, group.id)}
                  onDragStart={(event) => handleGroupDragStart(event, group.id)}
                  onDrop={(event) => void handleGroupDrop(event, group.id)}
                >
                  <span className="terminal-command-drag-handle" aria-hidden="true">⠿</span>
                  <div className="host-group-item-body">
                    <strong>{group.name}</strong>
                    <span className="terminal-command-category">{t("host.groupDragHint")}</span>
                  </div>
                  <div className="terminal-command-actions">
                    <InlineIconButton label={t("common.edit")} onClick={() => editGroup(group)}>
                      <Pencil aria-hidden="true" />
                    </InlineIconButton>
                    <InlineIconButton
                      label={t("common.delete")}
                      onClick={() => void handleDeleteGroup(group)}
                      variant="danger"
                    >
                      <Trash2 aria-hidden="true" />
                    </InlineIconButton>
                  </div>
                </article>
              ))}
              {orderedHostGroups.length === 0 ? (
                <div className="empty-state">
                  <p>{t("host.groupEmpty")}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
