import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Monitor, Plus } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { getApiErrorMessage } from "../features/auth/api";
import { createTemporaryConnection } from "../features/connections/api";
import { TemporaryQuickConnectDialog } from "../features/connections/TemporaryQuickConnectDialog";
import type { TemporaryConnectionInput } from "../features/connections/types";
import { useFingerprintDialog } from "../features/fingerprint/FingerprintDialogContext";
import { getHostMetrics, listHosts, testHost } from "../features/hosts/api";
import { getHostDisplayName, getHostEndpoint, hostMatchesSearch, sortHostsByRecentActivity } from "../features/hosts/display";
import type { Host } from "../features/hosts/types";
import { defaultHomePath } from "../features/files/fileViewModel";
import { defaultRemotePathCandidates } from "../features/preferences/defaultRemotePath";
import { usePreferences } from "../features/preferences/PreferencesContext";
import { createSavedCommand } from "../features/savedCommands/api";
import type { SavedCommand } from "../features/savedCommands/types";
import {
  closeTerminalSession,
  createQuickTerminalSession,
  createTerminalSession,
  createTerminalShare,
  extendTerminalShare,
  generateTerminalCommand,
  getTerminalShare,
  getTerminalSession,
  listTerminalSessions,
  listTerminalShareAccessLogs,
  revokeTerminalShare,
  setTerminalSessionKeepAlive
} from "../features/terminal/api";
import { terminalSessionRequestErrorMessage } from "../features/terminal/errors";
import {
  TerminalAiCommandDialog,
  type TerminalAiCommandDraft,
  type TerminalAiCommandUnsupported
} from "../features/terminal/TerminalAiCommandDialog";
import {
  connectionLogClipboardText,
  TerminalConnectionLogPanel,
  type TerminalConnectionLogEntry,
  type TerminalConnectionLogLevel
} from "../features/terminal/TerminalConnectionLogPanel";
import {
  assignDuplicateTerminalLabels,
  createDuplicateTerminalLabelState
} from "../features/terminal/terminalDisplayLabels";
import { TerminalHistoryDialog } from "../features/terminal/TerminalHistoryDialog";
import { TerminalHostPicker } from "../features/terminal/TerminalHostPicker";
import { TerminalPaneHeader } from "../features/terminal/TerminalPaneHeader";
import {
  TerminalTabStrip,
  type TerminalTabStripWorkspace
} from "../features/terminal/TerminalTabStrip";
import { TerminalWorkspaceHeader } from "../features/terminal/TerminalWorkspaceHeader";
import {
  TerminalShareDialog,
  defaultTerminalShareForm,
  maxTerminalShareAccesses,
  maxTerminalShareDurationMinutes,
  maxTerminalSharePasswordLength,
  maxTerminalShareSensitivePromptLength,
  minTerminalShareDurationMinutes,
  type TerminalShareForm,
  type TerminalShareFormErrors
} from "../features/terminal/TerminalShareDialog";
import {
  formatTerminalShareRemaining,
  isTerminalShareFinalMinute,
  isTerminalShareVisible,
  isTerminalShareVisibleAt,
  terminalShareRemainingMs
} from "../features/terminal/terminalShareState";
import {
  formatTerminalStatusLabel,
  getTerminalPlaceholderMessage
} from "../features/terminal/terminalTabLabels";
import {
  buildTerminalWorkspaceSnapshot,
  chooseRestoredTerminalActiveTab,
  createTerminalSnapshotSessionMap
} from "../features/terminal/terminalWorkspaceSnapshot";
import {
  TerminalSavedCommandsDialog,
} from "../features/terminal/TerminalSavedCommandsDialog";
import { useSavedCommandActions } from "../features/terminal/useSavedCommandActions";
import { useSavedCommands } from "../features/terminal/useSavedCommands";
import {
  canCreateDropLayout,
  clampSplitRatio,
  clampSplitRatioForMinimumWidth,
  createDropLayout,
  formatSplitRatio,
  isTerminalSplitLayoutNode,
  normalizeTerminalLayouts,
  pruneTerminalLayout,
  rectFromDropZone,
  removeTabFromTerminalLayout,
  resizeTerminalLayoutAtPath,
  terminalLayoutGeometry,
  terminalLayoutLeafIds,
  terminalLayoutSignature,
  terminalLayoutsEqual,
  updateSplitRatioAtPath,
  type TerminalDropTarget,
  type TerminalDropZone,
  type TerminalLayoutSplitter,
  type TerminalPaneRect,
  type TerminalSplitDirection,
  type TerminalSplitLayoutNode
} from "../features/terminal/terminalLayout";
import { TerminalPane, type TerminalPaneHandle } from "../features/terminal/TerminalPane";
import type {
  CreateTerminalSessionResponse,
  TerminalConnectionLogEntryPayload,
  TerminalShare,
  TerminalShareAccessLog,
  TerminalSession
} from "../features/terminal/types";
import { useConfirmDialog } from "../features/ui/ConfirmDialogContext";
import { useToast } from "../features/ui/ToastContext";
import { useWorkspaceSnapshot } from "../features/workspace/WorkspaceContext";
import { HttpError } from "../shared/api/http";
import { copyTextToClipboard } from "../shared/lib/clipboard";
import { formatDateTime as formatSharedDateTime } from "../shared/lib/date";
import { Button, Dialog, IconButton, Popover } from "../shared/ui";
import type {
  TerminalWorkspaceSessionSnapshot,
  TerminalWorkspaceSnapshot
} from "../features/workspace/types";

type TerminalTab = {
  id: string;
  hostId: string;
  hostLabel: string;
  sessionId: string;
  websocketUrl: string;
  protocol: string;
  startedAt: string;
  status: "creating" | "connecting" | "connected" | "reconnecting" | "disconnected" | "failed";
  message: string;
  rows: number;
  cols: number;
  initialDirectory?: string | null;
  initialDirectoryFallbacks?: string[];
  attachAttempt: number;
  attached?: boolean | null;
  detachedAt?: string | null;
  expiresAt?: string | null;
  keepAliveUntil?: string | null;
  attachToken?: string | null;
  keepAlivePending?: boolean;
  hasPendingInput?: boolean;
  runtimeClosed?: boolean;
  fingerprint?: {
    algorithm: string;
    fingerprint: string;
    status: string;
  } | null;
  connectionLogs: TerminalConnectionLogEntry[];
};

type TerminalTabUpdate = Partial<TerminalTab> & {
  closeOnNormalExit?: boolean;
  reconnectRequested?: boolean;
  runtimeClosed?: boolean;
  attached?: boolean | null;
  detachedAt?: string | null;
  expiresAt?: string | null;
  keepAliveUntil?: string | null;
};

type TerminalStoredLayout = {
  version: 1;
  layout: TerminalSplitLayoutNode | null;
  layouts?: TerminalSplitLayoutNode[];
  maximizedTabId: string | null;
};

const terminalDefaults = {
  rows: 36,
  cols: 120
};

const terminalProtocol = "terminal.v1";
const terminalTabDragMime = "application/x-online-ssh-terminal-tab";
const reconnectDelays = [1000, 2000, 5000, 10000];
const maxReconnectAttempts = 6;
const temporaryFileHostStorageKey = "online-ssh-temporary-file-host";
const terminalLayoutStorageKey = "online-ssh-terminal-layout";

const HIGH_RISK_PATTERNS = [
  /\brm\s+-[a-z]*r[a-z]*f?\b/i,
  /\brm\s+-[a-z]*f[a-z]*r?\b/i,
  /\bsudo\s+rm\b/i,
  /\bdd\s+/i,
  /\bmkfs\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /:\(\)\s*\{/,
  /\b>\s*\/dev\/sd[a-z]/i,
  /\bchmod\s+-R?\s*0?777\b/i
];

function isHighRiskCommand(text: string) {
  return HIGH_RISK_PATTERNS.some((pattern) => pattern.test(text));
}

function aiCommandErrorMessage(error: unknown, fallback: string, translate?: (key: string) => string) {
  if (error instanceof HttpError && error.code.startsWith("LLM_")) {
    return error.message || fallback;
  }
  return getApiErrorMessage(error, fallback, translate);
}

function createLocalTerminalTabId(hostId: string) {
  return `creating-${hostId}-${createClientId()}`;
}

function createClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readStoredTerminalLayout(): TerminalStoredLayout {
  const fallback: TerminalStoredLayout = {
    version: 1,
    layout: null,
    layouts: [],
    maximizedTabId: null
  };
  try {
    const raw = window.localStorage.getItem(terminalLayoutStorageKey);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<TerminalStoredLayout>;
    const layouts = Array.isArray(parsed.layouts)
      ? parsed.layouts.filter(isTerminalSplitLayoutNode)
      : [];
    if (isTerminalSplitLayoutNode(parsed.layout)) {
      layouts.unshift(parsed.layout);
    }
    const normalizedLayouts = normalizeTerminalLayouts(layouts);
    return {
      version: 1,
      layout: normalizedLayouts[0] || null,
      layouts: normalizedLayouts,
      maximizedTabId: typeof parsed.maximizedTabId === "string" ? parsed.maximizedTabId : null
    };
  } catch {
    return fallback;
  }
}

function terminalConnectionLogsEqual(left: TerminalConnectionLogEntry[], right: TerminalConnectionLogEntry[]) {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const nextEntry = right[index];
      return (
        entry.id === nextEntry.id &&
        entry.level === nextEntry.level &&
        entry.message === nextEntry.message &&
        entry.occurredAt === nextEntry.occurredAt
      );
    })
  );
}

function terminalTabSameValue(left: TerminalTab, right: TerminalTab) {
  const leftFingerprint = left.fingerprint || null;
  const rightFingerprint = right.fingerprint || null;
  return (
    left.id === right.id &&
    left.hostId === right.hostId &&
    left.hostLabel === right.hostLabel &&
    left.sessionId === right.sessionId &&
    left.websocketUrl === right.websocketUrl &&
    left.protocol === right.protocol &&
    left.startedAt === right.startedAt &&
    left.status === right.status &&
    left.message === right.message &&
    left.rows === right.rows &&
    left.cols === right.cols &&
    (left.initialDirectory || null) === (right.initialDirectory || null) &&
    (left.initialDirectoryFallbacks || []).join("\n") === (right.initialDirectoryFallbacks || []).join("\n") &&
    left.attachAttempt === right.attachAttempt &&
    (left.attached ?? null) === (right.attached ?? null) &&
    (left.detachedAt || null) === (right.detachedAt || null) &&
    (left.expiresAt || null) === (right.expiresAt || null) &&
    (left.keepAliveUntil || null) === (right.keepAliveUntil || null) &&
    (left.attachToken || null) === (right.attachToken || null) &&
    Boolean(left.keepAlivePending) === Boolean(right.keepAlivePending) &&
    Boolean(left.hasPendingInput) === Boolean(right.hasPendingInput) &&
    Boolean(left.runtimeClosed) === Boolean(right.runtimeClosed) &&
    (leftFingerprint?.algorithm || null) === (rightFingerprint?.algorithm || null) &&
    (leftFingerprint?.fingerprint || null) === (rightFingerprint?.fingerprint || null) &&
    (leftFingerprint?.status || null) === (rightFingerprint?.status || null) &&
    terminalConnectionLogsEqual(left.connectionLogs, right.connectionLogs)
  );
}

function buildTerminalWebSocketUrl(
  sessionId: string,
  rows: number,
  cols: number,
  initialDirectory?: string | null,
  initialDirectoryFallbacks?: string[] | null,
  attachToken?: string | null
) {
  const params = new URLSearchParams({
    session_id: sessionId,
    rows: String(rows),
    cols: String(cols)
  });
  if (initialDirectory) {
    params.set("cwd", initialDirectory);
  }
  (initialDirectoryFallbacks || []).forEach((path) => {
    if (path) {
      params.append("cwd_fallback", path);
    }
  });
  if (attachToken) {
    params.set("attach_token", attachToken);
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/terminal?${params.toString()}`;
}

function buildFrontendTerminalShareUrl(token: string) {
  const trimmed = token.trim();
  if (!trimmed) {
    return "";
  }
  return `${window.location.origin}/share/terminal/${encodeURIComponent(trimmed)}`;
}

function terminalShareWithFrontendUrl(share: TerminalShare, token?: string | null): TerminalShare {
  const shareUrl = token ? buildFrontendTerminalShareUrl(token) : buildFrontendTerminalShareUrlFromExistingUrl(share.url);
  if (!shareUrl) {
    return share;
  }
  return {
    ...share,
    url: shareUrl
  };
}

function buildFrontendTerminalShareUrlFromExistingUrl(rawUrl?: string | null) {
  const value = rawUrl?.trim();
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value, window.location.origin);
    const match = url.pathname.match(/^\/share\/terminal\/([^/?#]+)$/);
    if (!match) {
      return value;
    }
    return buildFrontendTerminalShareUrl(decodeURIComponent(match[1]));
  } catch {
    return value;
  }
}

function formatTerminalDateTime(value: string, locale: string) {
  return formatSharedDateTime(value, locale, value);
}

function parsePositiveInteger(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function terminalAuthTypeLabel(authType: Host["auth_type"], t: (key: string) => string) {
  switch (authType) {
    case "private_key":
      return t("terminal.connectionLog.authPrivateKey");
    default:
      return t("terminal.connectionLog.authPassword");
  }
}

function createConnectionLogEntry(level: TerminalConnectionLogLevel, message: string): TerminalConnectionLogEntry {
  return {
    id: createClientId(),
    level,
    message,
    occurredAt: new Date().toISOString()
  };
}

function connectionLogEntriesFromPayload(
  payload: TerminalConnectionLogEntryPayload[] | null | undefined
): TerminalConnectionLogEntry[] {
  if (!payload || payload.length === 0) {
    return [];
  }

  return payload.map((entry) => ({
    id: createClientId(),
    level: entry.level,
    message: entry.message,
    occurredAt: entry.occurred_at
  }));
}

function initialConnectionLogs(host: Host, t: (key: string, values?: Record<string, string | number>) => string) {
  return [
    createConnectionLogEntry("info", t("terminal.connectionLog.start", {
      target: `${host.username}@${host.host}:${host.port}`
    })),
    createConnectionLogEntry("info", t("terminal.connectionLog.credentialsSaved")),
    createConnectionLogEntry("info", terminalAuthTypeLabel(host.auth_type, t)),
    createConnectionLogEntry("info", t("terminal.connectionLog.startSsh"))
  ];
}

function connectionLogForStatus(
  update: TerminalTabUpdate,
  t: (key: string, values?: Record<string, string | number>) => string
): TerminalConnectionLogEntry | null {
  if (!update.message) {
    return null;
  }
  if (update.status === "connected") {
    return createConnectionLogEntry("success", update.message);
  }
  if (update.status === "failed") {
    return createConnectionLogEntry("error", t("terminal.connectionLog.failed", { message: update.message }));
  }
  if (update.status === "reconnecting") {
    return createConnectionLogEntry("warning", update.message);
  }
  return createConnectionLogEntry("info", update.message);
}

function connectionLogFromTerminalError(
  error: unknown,
  fallbackMessage: string,
  t: (key: string, values?: Record<string, string | number>) => string
): TerminalConnectionLogEntry[] {
  const backendLog = error instanceof HttpError
    ? connectionLogEntriesFromPayload(
      (error.payload as { connection_log?: TerminalConnectionLogEntryPayload[] | null } | undefined)?.connection_log
    )
    : [];

  if (backendLog.length > 0) {
    return backendLog;
  }

  return [
    createConnectionLogEntry(
      "error",
      t("terminal.connectionLog.failed", {
        message: error instanceof Error && error.message ? error.message : fallbackMessage
      })
    )
  ];
}

type TerminalPageProps = {
  hostCatalog?: {
    hosts: Host[];
    hostsLoading?: boolean;
  };
  onHostConnected?: (host: Host) => void;
  quickConnectRequestId?: number;
  visible?: boolean;
};

export function TerminalPage({ hostCatalog, onHostConnected, quickConnectRequestId = 0, visible = true }: TerminalPageProps = {}) {
  void onHostConnected;
  const confirmDialog = useConfirmDialog();
  const fingerprintDialog = useFingerprintDialog();
  const workspace = useWorkspaceSnapshot();
  const workspaceTerminalSnapshot = workspace.terminalSnapshot;
  const setWorkspaceTerminalSnapshot = workspace.setTerminalSnapshot;
  const { language, t, terminalDefaultPathPreference } = usePreferences();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const appliedQueryTerminalRef = useRef<string | null>(null);
  const appliedStoredSnapshotRef = useRef(false);
  const reconnectTimersRef = useRef<Map<string, number>>(new Map());
  const reconnectAttemptsRef = useRef<Map<string, number>>(new Map());
  const tabsRef = useRef<TerminalTab[]>([]);
  const terminalLabelStateRef = useRef(createDuplicateTerminalLabelState());
  const paneRefs = useRef<Map<string, TerminalPaneHandle | null>>(new Map());
  const paneStackRef = useRef<HTMLDivElement | null>(null);
  const splitResizeRef = useRef<{
    direction: TerminalSplitDirection;
    layout: TerminalSplitLayoutNode | null;
    path: number[];
    rect: TerminalPaneRect;
  } | null>(null);
  const [localHosts, setLocalHosts] = useState<Host[]>([]);
  const [localHostsLoading, setLocalHostsLoading] = useState(true);
  const [, setLocalHostsError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const {
    beginCreateSavedCommand,
    cancelSavedCommandForm,
    copiedCommandId,
    editSavedCommand,
    handleDragEnd,
    handleDragOver,
    handleDragStart,
    handleDrop,
    handleSavedCommandsOpenChange,
    openSavedCommandsDialog,
    removeSavedCommand,
    savedCommandCategories,
    savedCommandCategoryFilter,
    savedCommandDialogMode,
    savedCommandDraggingId,
    savedCommandDropTargetId,
    savedCommandError,
    savedCommandForm,
    savedCommandMessage,
    savedCommandReordering,
    savedCommandSubmitting,
    savedCommands,
    savedCommandsDialogOpen,
    savedCommandsLoading,
    setCopiedCommandId,
    setSavedCommandCategoryFilter,
    setSavedCommandError,
    setSavedCommandForm,
    setSavedCommandMessage,
    setSavedCommandsDialogOpen,
    submitSavedCommand,
    upsertSavedCommand,
    visibleSavedCommands
  } = useSavedCommands({
    confirmDialog,
    language,
    t,
    toast
  });
  const [quickConnectOpen, setQuickConnectOpen] = useState(false);
  const handledQuickConnectRequestRef = useRef(0);
  const [hostPickerOpen, setHostPickerOpen] = useState(false);
  const [hostPickerFilter, setHostPickerFilter] = useState("");
  const [terminalHistoryOpen, setTerminalHistoryOpen] = useState(false);
  const [connectionLogDialogTabId, setConnectionLogDialogTabId] = useState<string | null>(null);
  const [aiCommandDialogOpen, setAiCommandDialogOpen] = useState(false);
  const [aiCommandPrompt, setAiCommandPrompt] = useState("");
  const [aiCommandGenerating, setAiCommandGenerating] = useState(false);
  const [aiCommandImporting, setAiCommandImporting] = useState(false);
  const [aiCommandDraft, setAiCommandDraft] = useState<TerminalAiCommandDraft | null>(null);
  const [aiCommandRawResponse, setAiCommandRawResponse] = useState<string | null>(null);
  const [aiCommandUnsupported, setAiCommandUnsupported] = useState<TerminalAiCommandUnsupported | null>(null);
  const [aiCommandIncludeSystemInfo, setAiCommandIncludeSystemInfo] = useState(false);
  const [aiCommandError, setAiCommandError] = useState<string | null>(null);
  const [aiCommandMessage, setAiCommandMessage] = useState<string | null>(null);
  const [splitLayouts, setSplitLayouts] = useState<TerminalSplitLayoutNode[]>(() => readStoredTerminalLayout().layouts || []);
  const [splitResizing, setSplitResizing] = useState(false);
  const [draftSplitLayout, setDraftSplitLayout] = useState<TerminalSplitLayoutNode | null>(null);
  const [terminalTabDraggingId, setTerminalTabDraggingId] = useState<string | null>(null);
  const [terminalDropTarget, setTerminalDropTarget] = useState<TerminalDropTarget | null>(null);
  const [terminalTabListDropActive, setTerminalTabListDropActive] = useState(false);
  const [broadcastWorkspaceIds, setBroadcastWorkspaceIds] = useState<Set<string>>(() => new Set());
  const [paneMenuOpenTabId, setPaneMenuOpenTabId] = useState<string | null>(null);
  const [compactPaneHeaderTabIds, setCompactPaneHeaderTabIds] = useState<Set<string>>(() => new Set());
  const [terminalSharesBySessionId, setTerminalSharesBySessionId] = useState<Record<string, TerminalShare | null>>({});
  const [shareClockTick, setShareClockTick] = useState(() => Date.now());
  const shareLookupSessionIdsRef = useRef<Set<string>>(new Set());
  const shareExpiryPromptedRef = useRef<Set<string>>(new Set());
  const [shareDialogTabId, setShareDialogTabId] = useState<string | null>(null);
  const [shareForm, setShareForm] = useState<TerminalShareForm>({ ...defaultTerminalShareForm });
  const [shareFieldErrors, setShareFieldErrors] = useState<TerminalShareFormErrors>({});
  const [shareSubmitting, setShareSubmitting] = useState(false);
  const [shareAccessLogs, setShareAccessLogs] = useState<TerminalShareAccessLog[]>([]);
  const [shareLogsLoading, setShareLogsLoading] = useState(false);
  const hosts = hostCatalog?.hosts ?? localHosts;
  const hostsLoading = hostCatalog?.hostsLoading ?? localHostsLoading;

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const setPaneHeaderCompact = useCallback((tabId: string, compact: boolean) => {
    setCompactPaneHeaderTabIds((current) => {
      const hasValue = current.has(tabId);
      if (hasValue === compact) {
        return current;
      }
      const next = new Set(current);
      if (compact) {
        next.add(tabId);
      } else {
        next.delete(tabId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (quickConnectRequestId <= handledQuickConnectRequestRef.current) {
      return;
    }
    handledQuickConnectRequestRef.current = quickConnectRequestId;
    setQuickConnectOpen(true);
  }, [quickConnectRequestId]);

  useEffect(() => {
    if (tabs.length === 0) {
      return;
    }
    const tabIds = new Set(tabs.map((tab) => tab.id));
    setSplitLayouts((current) => {
      const next = normalizeTerminalLayouts(current.map((layout) => pruneTerminalLayout(layout, tabIds)));
      return terminalLayoutsEqual(current, next) ? current : next;
    });
  }, [tabs]);

  useEffect(() => {
    const primaryLayout = splitLayouts[0] || null;
    window.localStorage.setItem(terminalLayoutStorageKey, JSON.stringify({
      version: 1,
      layout: primaryLayout,
      layouts: splitLayouts,
      maximizedTabId: null
    } satisfies TerminalStoredLayout));
  }, [splitLayouts]);

  const activeWorkspaceLayout = useMemo(
    () => splitLayouts.find((layout) => terminalLayoutLeafIds(layout).includes(activeTabId || "")) || null,
    [activeTabId, splitLayouts]
  );
  const activeWorkspaceId = terminalLayoutSignature(activeWorkspaceLayout);
  const splitVisibleTabIds = useMemo(() => terminalLayoutLeafIds(activeWorkspaceLayout), [activeWorkspaceLayout]);

  useEffect(() => {
    if (!splitResizing) {
      return;
    }

    const ratioFromMouse = (event: MouseEvent) => {
      const resize = splitResizeRef.current;
      const stack = paneStackRef.current;
      if (!resize || !stack) {
        return null;
      }
      const stackRect = stack.getBoundingClientRect();
      if (stackRect.width <= 0 || stackRect.height <= 0 || resize.rect.width <= 0 || resize.rect.height <= 0) {
        return null;
      }
      const splitLeft = stackRect.left + (resize.rect.left / 100) * stackRect.width;
      const splitTop = stackRect.top + (resize.rect.top / 100) * stackRect.height;
      const splitWidth = (resize.rect.width / 100) * stackRect.width;
      const splitHeight = (resize.rect.height / 100) * stackRect.height;
      const rawRatio = resize.direction === "vertical"
        ? (event.clientX - splitLeft) / splitWidth
        : (event.clientY - splitTop) / splitHeight;
      const availableSize = resize.direction === "vertical" ? splitWidth : splitHeight;
      const ratio = clampSplitRatioForMinimumWidth(resize.layout, resize.path, rawRatio, availableSize);
      return { availableSize, ratio };
    };

    const stopResize = (event: MouseEvent) => {
      const resize = splitResizeRef.current;
      const measurement = ratioFromMouse(event);
      if (resize && measurement) {
        const workspaceId = activeWorkspaceId;
        setSplitLayouts((current) => normalizeTerminalLayouts(current.map((layout) => (
          terminalLayoutSignature(layout) === workspaceId
            ? resizeTerminalLayoutAtPath(layout, resize.path, measurement.ratio, measurement.availableSize)
            : layout
        ))));
      }
      splitResizeRef.current = null;
      setDraftSplitLayout(null);
      setSplitResizing(false);
    };

    const moveResize = (event: MouseEvent) => {
      const resize = splitResizeRef.current;
      const measurement = ratioFromMouse(event);
      if (resize && measurement) {
        setDraftSplitLayout(resizeTerminalLayoutAtPath(
          resize.layout,
          resize.path,
          measurement.ratio,
          measurement.availableSize
        ));
      }
    };

    window.addEventListener("mousemove", moveResize);
    window.addEventListener("mouseup", stopResize);
    return () => {
      window.removeEventListener("mousemove", moveResize);
      window.removeEventListener("mouseup", stopResize);
    };
  }, [activeWorkspaceId, splitResizing]);

  const effectiveSplitLayout = splitResizing && draftSplitLayout ? draftSplitLayout : activeWorkspaceLayout;
  const rootSplitRatio = effectiveSplitLayout?.type === "split" ? clampSplitRatio(effectiveSplitLayout.ratio) : 0.5;
  const isSplitActive = splitVisibleTabIds.length > 1 && Boolean(activeTabId && splitVisibleTabIds.includes(activeTabId));
  const visibleTabIds =
    isSplitActive
      ? splitVisibleTabIds
      : activeTabId
        ? [activeTabId]
        : [];

  const allSplitMemberTabIds = useMemo(() => new Set(splitLayouts.flatMap(terminalLayoutLeafIds)), [splitLayouts]);
  const displayTabs = useMemo(
    () => assignDuplicateTerminalLabels(tabs, terminalLabelStateRef.current),
    [tabs]
  );
  const activeDisplayTab = useMemo(
    () => displayTabs.find((tab) => tab.id === activeTabId) || null,
    [activeTabId, displayTabs]
  );
  const originalSplitGeometry = useMemo(
    () => (isSplitActive ? terminalLayoutGeometry(effectiveSplitLayout) : terminalLayoutGeometry(null)),
    [effectiveSplitLayout, isSplitActive]
  );
  const dragDetachedSplitLayout = useMemo(() => {
    if (!isSplitActive || !terminalTabDraggingId || !terminalDropTarget || !effectiveSplitLayout) {
      return null;
    }
    if (!terminalLayoutLeafIds(effectiveSplitLayout).includes(terminalTabDraggingId)) {
      return null;
    }
    return removeTabFromTerminalLayout(effectiveSplitLayout, terminalTabDraggingId);
  }, [effectiveSplitLayout, isSplitActive, terminalDropTarget, terminalTabDraggingId]);
  const renderSplitLayout = dragDetachedSplitLayout || effectiveSplitLayout;
  const renderVisibleTabIds = dragDetachedSplitLayout ? terminalLayoutLeafIds(dragDetachedSplitLayout) : visibleTabIds;
  const splitGeometry = useMemo(
    () => (isSplitActive ? terminalLayoutGeometry(renderSplitLayout) : terminalLayoutGeometry(null)),
    [isSplitActive, renderSplitLayout]
  );

  const startSplitResize = (
    event: ReactMouseEvent<HTMLDivElement>,
    splitter: TerminalLayoutSplitter
  ) => {
    event.preventDefault();
    splitResizeRef.current = {
      direction: splitter.direction,
      layout: activeWorkspaceLayout,
      path: splitter.path,
      rect: splitter.rect
    };
    setDraftSplitLayout(activeWorkspaceLayout);
    setSplitResizing(true);
  };

  const resetSplitRatio = (path: number[]) => {
    const workspaceId = activeWorkspaceId;
    setSplitLayouts((current) => normalizeTerminalLayouts(current.map((layout) => (
      terminalLayoutSignature(layout) === workspaceId
        ? updateSplitRatioAtPath(layout, path, 0.5)
        : layout
    ))));
  };

  const splitLayoutIdKey = useMemo(
    () => splitLayouts.map(terminalLayoutSignature).filter(Boolean).join("|"),
    [splitLayouts]
  );

  useEffect(() => {
    if (broadcastWorkspaceIds.size === 0) {
      return;
    }
    const validWorkspaceIds = new Set(splitLayoutIdKey ? splitLayoutIdKey.split("|") : []);
    const hasInvalidWorkspace = Array.from(broadcastWorkspaceIds).some((workspaceId) => !validWorkspaceIds.has(workspaceId));
    if (!hasInvalidWorkspace) {
      return;
    }
    setBroadcastWorkspaceIds((current) => new Set(Array.from(current).filter((workspaceId) => validWorkspaceIds.has(workspaceId))));
  }, [broadcastWorkspaceIds, splitLayoutIdKey]);

  const toggleWorkspaceBroadcast = (workspaceId: string) => {
    setBroadcastWorkspaceIds((current) => {
      const next = new Set(current);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  };

  const broadcastInputToWorkspacePeers = (sourceTabId: string, data: string) => {
    if (!data) {
      return 0;
    }
    const workspace = splitLayouts.find((layout) => terminalLayoutLeafIds(layout).includes(sourceTabId)) || null;
    const workspaceId = terminalLayoutSignature(workspace);
    if (!workspace || !workspaceId || !broadcastWorkspaceIds.has(workspaceId)) {
      return 0;
    }
    let sentCount = 0;
    for (const tabId of terminalLayoutLeafIds(workspace)) {
      if (tabId === sourceTabId) {
        continue;
      }
      if (paneRefs.current.get(tabId)?.sendInput(data)) {
        sentCount += 1;
      }
    }
    return sentCount;
  };

  const handleTerminalInput = (sourceTabId: string, data: string) => {
    broadcastInputToWorkspacePeers(sourceTabId, data);
  };

  const updateTerminalShare = useCallback((share: TerminalShare | null) => {
    if (!share?.terminal_session_id) {
      return;
    }
    setTerminalSharesBySessionId((current) => {
      const existingShare = current[share.terminal_session_id];
      const normalizedShare = terminalShareWithFrontendUrl({
        ...share,
        url: share.url || existingShare?.url
      });
      return {
        ...current,
        [normalizedShare.terminal_session_id]: isTerminalShareVisible(normalizedShare) ? normalizedShare : null
      };
    });
  }, []);

  const loadShareForSession = useCallback(async (sessionId: string, options: { force?: boolean; silent?: boolean } = {}) => {
    if (!sessionId) {
      return;
    }
    if (!options.force && shareLookupSessionIdsRef.current.has(sessionId)) {
      return;
    }
    shareLookupSessionIdsRef.current.add(sessionId);
    try {
      const response = await getTerminalShare(sessionId);
      updateTerminalShare(response.share);
    } catch (error) {
      if (error instanceof HttpError && (error.status === 404 || error.code === "TERMINAL_SHARE_NOT_AVAILABLE" || error.code === "NOT_FOUND")) {
        setTerminalSharesBySessionId((current) => ({ ...current, [sessionId]: null }));
        return;
      }
      if (!options.silent) {
        toast.error(getApiErrorMessage(error, t("terminal.share.loadFailed"), t));
      }
    }
  }, [t, toast, updateTerminalShare]);

  useEffect(() => {
    tabs
      .filter((tab) => tab.sessionId)
      .forEach((tab) => {
        void loadShareForSession(tab.sessionId, { silent: true });
      });
  }, [loadShareForSession, tabs]);

  useEffect(() => {
    const hasVisibleShare = Object.values(terminalSharesBySessionId).some((share) => isTerminalShareVisibleAt(share, Date.now()));
    if (!hasVisibleShare) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setShareClockTick(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [terminalSharesBySessionId]);

  useEffect(() => {
    setTerminalSharesBySessionId((current) => {
      let changed = false;
      const next: Record<string, TerminalShare | null> = {};
      for (const [sessionId, share] of Object.entries(current)) {
        if (share && !isTerminalShareVisibleAt(share, shareClockTick)) {
          next[sessionId] = null;
          changed = true;
        } else {
          next[sessionId] = share;
        }
      }
      return changed ? next : current;
    });
  }, [shareClockTick]);

  const loadShareAccessLogs = useCallback(async (shareOrId: TerminalShare | string) => {
    const shareId = typeof shareOrId === "string" ? shareOrId : shareOrId.id;
    setShareLogsLoading(true);
    try {
      const response = await listTerminalShareAccessLogs(shareId, { page: 1, page_size: 8 });
      setShareAccessLogs(response.items);
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 404)) {
        toast.error(getApiErrorMessage(error, t("terminal.share.logsLoadFailed"), t));
      }
      setShareAccessLogs([]);
    } finally {
      setShareLogsLoading(false);
    }
  }, [t, toast]);

  const openShareDialog = (tab: TerminalTab) => {
    setPaneMenuOpenTabId(null);
    setShareDialogTabId(tab.id);
    setShareForm({ ...defaultTerminalShareForm });
    setShareFieldErrors({});
    setShareAccessLogs([]);
    if (tab.sessionId) {
      void loadShareForSession(tab.sessionId, { force: true, silent: true });
    }
  };

  const closeShareDialog = () => {
    setShareDialogTabId(null);
    setShareFieldErrors({});
    setShareAccessLogs([]);
    setShareForm({ ...defaultTerminalShareForm });
  };

  const updateShareFormField = (field: keyof TerminalShareForm, value: string) => {
    setShareForm((current) => ({ ...current, [field]: value }));
    setShareFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const createShareFromDialog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const tab = tabsRef.current.find((item) => item.id === shareDialogTabId);
    if (!tab?.sessionId) {
      return;
    }
    const expiresInMinutes = Math.max(
      minTerminalShareDurationMinutes,
      Math.min(maxTerminalShareDurationMinutes, parsePositiveInteger(shareForm.expiresInMinutes) || minTerminalShareDurationMinutes)
    );
    const maxAccesses = shareForm.maxAccesses.trim()
      ? Math.max(1, Math.min(maxTerminalShareAccesses, parsePositiveInteger(shareForm.maxAccesses) || 1))
      : null;
    const nextFieldErrors: TerminalShareFormErrors = {};
    if (shareForm.password.length > maxTerminalSharePasswordLength) {
      nextFieldErrors.password = t("terminal.share.passwordTooLong");
    }
    if (shareForm.sensitivePrompt.length > maxTerminalShareSensitivePromptLength) {
      nextFieldErrors.sensitivePrompt = t("terminal.share.sensitivePromptTooLong");
    }
    if (Object.keys(nextFieldErrors).length > 0) {
      setShareFieldErrors(nextFieldErrors);
      return;
    }
    setShareSubmitting(true);
    setShareFieldErrors({});
    try {
      const response = await createTerminalShare(tab.sessionId, {
        expires_in_minutes: expiresInMinutes,
        max_accesses: maxAccesses,
        password: shareForm.password.trim() || undefined,
        sensitive_prompt: shareForm.sensitivePrompt.trim() || undefined
      });
      const share = terminalShareWithFrontendUrl(response.share, response.token);
      updateTerminalShare(share);
      setShareForm({ ...defaultTerminalShareForm, password: "", sensitivePrompt: "" });
      toast.success(t("terminal.share.created"));
      void loadShareAccessLogs(share);
    } catch (error) {
      const message = getApiErrorMessage(error, t("terminal.share.createFailed"), t);
      toast.error(message);
    } finally {
      setShareSubmitting(false);
    }
  };

  const extendShare = useCallback(async (share: TerminalShare, expiresInMinutes = 10) => {
    try {
      const response = await extendTerminalShare(share.id, expiresInMinutes);
      updateTerminalShare(response.share);
      toast.success(t("terminal.share.extended"));
      return response.share;
    } catch (error) {
      const message = getApiErrorMessage(error, t("terminal.share.extendFailed"), t);
      toast.error(message);
      return null;
    }
  }, [t, toast, updateTerminalShare]);

  const revokeShareFromDialog = async (share: TerminalShare) => {
    const confirmed = await confirmDialog.requestConfirmation({
      title: t("terminal.share.revokeTitle"),
      message: t("terminal.share.revokeMessage"),
      confirmLabel: t("terminal.share.revoke"),
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }
    setShareSubmitting(true);
    try {
      const response = await revokeTerminalShare(share.id);
      updateTerminalShare(response.share);
      toast.success(t("terminal.share.revoked"));
      closeShareDialog();
    } catch (error) {
      const message = getApiErrorMessage(error, t("terminal.share.revokeFailed"), t);
      toast.error(message);
    } finally {
      setShareSubmitting(false);
    }
  };

  const copyShareUrl = async (url: string) => {
    const copied = await copyTextToClipboard(url);
    if (copied) {
      const message = t("terminal.share.linkCopied");
      toast.success(message);
    } else {
      const message = t("terminal.share.linkCopyFailed");
      toast.error(message);
    }
  };

  const promptExtendExpiringShare = useCallback(async (share: TerminalShare) => {
    const confirmed = await confirmDialog.requestConfirmation({
      title: t("terminal.share.expiringTitle"),
      message: t("terminal.share.expiringMessage"),
      confirmLabel: t("terminal.share.extend"),
      tone: "default"
    });
    if (confirmed) {
      await extendShare(share, 10);
    }
  }, [confirmDialog, extendShare, t]);

  useEffect(() => {
    const timers: number[] = [];
    Object.values(terminalSharesBySessionId).forEach((share) => {
      if (!isTerminalShareVisible(share)) {
        return;
      }
      const shareKey = `${share.id}:${share.expires_at}`;
      if (shareExpiryPromptedRef.current.has(shareKey)) {
        return;
      }
      const expiresAt = new Date(share.expires_at).getTime();
      const promptAt = expiresAt - 60_000;
      const delay = promptAt - Date.now();
      const prompt = () => {
        shareExpiryPromptedRef.current.add(shareKey);
        void promptExtendExpiringShare(share);
      };
      if (delay <= 0) {
        if (expiresAt > Date.now()) {
          prompt();
        }
        return;
      }
      timers.push(window.setTimeout(prompt, delay));
    });
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [promptExtendExpiringShare, terminalSharesBySessionId]);

  const exitSplitPane = (tabId: string) => {
    const workspace = splitLayouts.find((layout) => terminalLayoutLeafIds(layout).includes(tabId)) || null;
    if (!workspace) {
      return;
    }
    setPaneMenuOpenTabId(null);
    const workspaceId = terminalLayoutSignature(workspace);
    setSplitLayouts((current) => normalizeTerminalLayouts(current.map((layout) => {
      if (terminalLayoutSignature(layout) !== workspaceId) {
        return layout;
      }
      return removeTabFromTerminalLayout(layout, tabId);
    })));
    setActiveTabId(tabId);
  };

  const renderPaneHeader = (tab: TerminalTab, options: { isWorkspacePane: boolean }) => {
    const compactHeader = compactPaneHeaderTabIds.has(tab.id);
    const activeShare = isTerminalShareVisibleAt(terminalSharesBySessionId[tab.sessionId], shareClockTick)
      ? terminalSharesBySessionId[tab.sessionId]
      : null;
    const shareRemainingMs = terminalShareRemainingMs(activeShare, shareClockTick);
    const shareRemainingText = formatTerminalShareRemaining(shareRemainingMs, language);
    const shareIndicatorLabel = activeShare
      ? t("terminal.share.manageForWithRemaining", { name: tab.hostLabel, time: shareRemainingText })
      : t("terminal.share.manageFor", { name: tab.hostLabel });
    const shareIndicatorFinalMinute = isTerminalShareFinalMinute(activeShare, shareClockTick);
    return (
      <TerminalPaneHeader
        active={tab.id === activeTabId}
        compact={compactHeader}
        draggable={tabs.length > 1}
        formatDateTime={(value) => formatTerminalDateTime(value, language)}
        isWorkspacePane={options.isWorkspacePane}
        menuOpen={paneMenuOpenTabId === tab.id}
        onClosePane={() => void closeTab(tab)}
        onCompactChange={(compact) => setPaneHeaderCompact(tab.id, compact)}
        onDragEnd={clearTerminalTabDrag}
        onDragStart={(event) => handleTerminalTabDragStart(event, tab.id)}
        onExitSplit={() => exitSplitPane(tab.id)}
        onMenuOpenChange={(open) => setPaneMenuOpenTabId(open ? tab.id : null)}
        onOpenConnectionInfo={() => setConnectionLogDialogTabId(tab.id)}
        onOpenShare={() => openShareDialog(tab)}
        onToggleBrowserFullscreen={() => {
          setActiveTabId(tab.id);
          paneRefs.current.get(tab.id)?.toggleBrowserFullscreen();
        }}
        onToggleKeepAlive={() => void toggleKeepAlive(tab)}
        share={{
          active: Boolean(activeShare),
          finalMinute: shareIndicatorFinalMinute,
          label: shareIndicatorLabel,
          remainingText: shareRemainingText
        }}
        t={t}
        tab={tab}
      />
    );
  };

  const orderedHosts = useMemo(() => sortHostsByRecentActivity(hosts), [hosts]);
  const favoriteHosts = useMemo(() => orderedHosts.filter((host) => host.is_favorite), [orderedHosts]);
  const terminalLauncherHosts = useMemo(
    () => (favoriteHosts.length > 0 ? favoriteHosts : orderedHosts).slice(0, 16),
    [favoriteHosts, orderedHosts]
  );
  const availableHostPickerHosts = useMemo(() => orderedHosts, [orderedHosts]);
  const filteredHostPickerHosts = useMemo(
    () => availableHostPickerHosts.filter((host) => hostMatchesSearch(host, hostPickerFilter)),
    [availableHostPickerHosts, hostPickerFilter]
  );
  const terminalLauncherTitle = favoriteHosts.length > 0 ? t("dashboard.favoriteHosts") : t("dashboard.recentHosts");

  useEffect(() => {
    if (hostCatalog) {
      return;
    }

    let mounted = true;

    const loadAvailableHosts = async () => {
      setLocalHostsLoading(true);
      setLocalHostsError(null);

      try {
        const response = await listHosts();
        if (mounted) {
          setLocalHosts(response.items);
        }
      } catch (error) {
        const message = getApiErrorMessage(error, t("terminal.hostsFailed"), t);
        if (mounted) {
          setLocalHostsError(message);
          toast.error(message);
        }
      } finally {
        if (mounted) {
          setLocalHostsLoading(false);
        }
      }
    };

    void loadAvailableHosts();

    return () => {
      mounted = false;
    };
  }, [hostCatalog, t, toast]);

  const clearReconnectTimer = useCallback((tabId: string) => {
    const timer = reconnectTimersRef.current.get(tabId);
    if (timer) {
      window.clearTimeout(timer);
      reconnectTimersRef.current.delete(tabId);
    }
  }, []);

  useEffect(() => {
    return () => {
      reconnectTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      reconnectTimersRef.current.clear();
      reconnectAttemptsRef.current.clear();
    };
  }, []);

  const removeTab = useCallback((tabId: string, fallbackActiveTabId?: string | null) => {
    clearReconnectTimer(tabId);
    reconnectAttemptsRef.current.delete(tabId);
    setSplitLayouts((current) => normalizeTerminalLayouts(current.map((layout) => removeTabFromTerminalLayout(layout, tabId))));
    setTabs((current) => current.filter((tab) => tab.id !== tabId));
    setActiveTabId((current) => {
      if (current !== tabId) {
        return current;
      }

      if (fallbackActiveTabId && tabs.some((tab) => tab.id === fallbackActiveTabId && tab.id !== tabId)) {
        return fallbackActiveTabId;
      }

      const currentIndex = tabs.findIndex((tab) => tab.id === tabId);
      const fallback = tabs[currentIndex + 1] || tabs[currentIndex - 1];
      return fallback?.id || null;
    });
  }, [clearReconnectTimer, tabs]);

  const canSendToActiveTerminal = (() => {
    if (!activeTabId) {
      return false;
    }
    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    return Boolean(activeTab && activeTab.status === "connected");
  })();
  const {
    copySavedCommand,
    sendSavedCommandToTerminal
  } = useSavedCommandActions({
    activeTabId,
    broadcastInputToWorkspacePeers,
    confirmDialog,
    copyTextToClipboard,
    isHighRiskCommand,
    paneRefs,
    setCopiedCommandId,
    setSavedCommandError,
    setSavedCommandMessage,
    setSavedCommandsDialogOpen,
    tabsRef,
    t,
    toast
  });

  const handleAiCommandDialogOpenChange = (open: boolean) => {
    setAiCommandDialogOpen(open);
    if (!open) {
      setAiCommandError(null);
      setAiCommandMessage(null);
      setAiCommandRawResponse(null);
      setAiCommandUnsupported(null);
    }
  };

  const openAiCommandDialog = () => {
    setAiCommandError(null);
    setAiCommandMessage(null);
    setAiCommandRawResponse(null);
    setAiCommandUnsupported(null);
    setAiCommandDialogOpen(true);
  };

  const activeAiSystemInfoAvailable = Boolean(activeDisplayTab?.hostId);

  const loadActiveAiSystemInfo = async () => {
    if (!activeDisplayTab?.hostId) {
      return "";
    }
    const response = await getHostMetrics(activeDisplayTab.hostId);
    const system = response.metrics.system;
    return [
      system.hostname ? `Hostname: ${system.hostname}` : "",
      system.os_name ? `OS: ${system.os_name}` : "",
      system.kernel ? `Kernel: ${system.kernel}` : ""
    ].filter(Boolean).join("\n");
  };

  const submitAiCommandPrompt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = aiCommandPrompt.trim();
    if (!prompt) {
      setAiCommandError(t("terminal.ai.promptRequired"));
      return;
    }

    setAiCommandGenerating(true);
    setAiCommandError(null);
    setAiCommandMessage(null);
    setAiCommandRawResponse(null);
    setAiCommandUnsupported(null);
    try {
      const systemInfo = aiCommandIncludeSystemInfo ? await loadActiveAiSystemInfo() : "";
      const response = await generateTerminalCommand({
        prompt,
        host_label: activeDisplayTab?.hostLabel || undefined,
        working_directory: activeDisplayTab?.initialDirectory || undefined,
        system_info: systemInfo || undefined
      });
      if (response.result) {
        setAiCommandDraft({
          name: response.result.name || "",
          command_text: response.result.command_text || "",
          category: response.result.category || "",
          description: response.result.description || "",
          risk_level: response.result.risk_level,
          notes: response.result.notes || []
        });
      } else if (response.unsupported_request) {
        setAiCommandDraft(null);
        setAiCommandRawResponse(null);
        setAiCommandUnsupported({
          message: response.refusal_message || t("terminal.ai.unsupportedDefault"),
          suggestedPrompt: response.suggested_prompt || ""
        });
      } else if (response.invalid_response && response.raw_response) {
        setAiCommandDraft(null);
        setAiCommandUnsupported(null);
        setAiCommandRawResponse(response.raw_response);
      } else {
        setAiCommandDraft(null);
        setAiCommandRawResponse(null);
        setAiCommandUnsupported(null);
        toast.error(t("terminal.ai.generateFailed"));
      }
    } catch (error) {
      const message = aiCommandErrorMessage(error, t("terminal.ai.generateFailed"), t);
      toast.error(message);
    } finally {
      setAiCommandGenerating(false);
    }
  };

  const importAiCommandToSavedCommands = async () => {
    if (!aiCommandDraft) {
      return;
    }
    setAiCommandImporting(true);
    setAiCommandError(null);
    setAiCommandMessage(null);
    try {
      const response = await createSavedCommand({
        name: aiCommandDraft.name.trim(),
        command_text: aiCommandDraft.command_text.trim(),
        category: aiCommandDraft.category.trim() || null,
        description: aiCommandDraft.description.trim() || null,
        sort_order: savedCommands.length
      });
      upsertSavedCommand({ command: response.command });
      const message = t("terminal.ai.imported");
      setAiCommandMessage(message);
      toast.success(message);
    } catch (error) {
      const message = getApiErrorMessage(error, t("terminal.savedCommandSaveFailed"), t);
      setAiCommandError(message);
      toast.error(message);
    } finally {
      setAiCommandImporting(false);
    }
  };

  const writeAiCommandToTerminal = async () => {
    if (!aiCommandDraft) {
      return;
    }
    const temporaryCommand: SavedCommand = {
      id: "ai-command-draft",
      user_id: "",
      name: aiCommandDraft.name.trim() || t("terminal.ai.title"),
      command_text: aiCommandDraft.command_text.trim(),
      category: aiCommandDraft.category.trim() || null,
      description: aiCommandDraft.description.trim() || null,
      sort_order: 0,
      created_at: "",
      updated_at: ""
    };
    await sendSavedCommandToTerminal(temporaryCommand);
  };

  const getTerminalTabDragId = (event: DragEvent<HTMLElement>) =>
    event.dataTransfer.getData(terminalTabDragMime) || event.dataTransfer.getData("text/plain") || terminalTabDraggingId;

  const dropZoneFromPoint = (x: number, y: number): TerminalDropZone | null => {
    const clampedX = Math.min(1, Math.max(0, x));
    const clampedY = Math.min(1, Math.max(0, y));
    const deltaX = clampedX - 0.5;
    const deltaY = clampedY - 0.5;
    if (Math.abs(deltaX) < 0.001 && Math.abs(deltaY) < 0.001) {
      return null;
    }
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      return deltaX < 0 ? "left" : "right";
    }
    return deltaY < 0 ? "top" : "bottom";
  };

  const dropTargetFromTerminalPaneEvent = (event: DragEvent<HTMLElement>, draggingTabId: string | null): TerminalDropTarget => {
    const stackRect = event.currentTarget.getBoundingClientRect();
    const fallbackRect: TerminalPaneRect = { left: 0, top: 0, width: 100, height: 100 };
    if (
      stackRect.width <= 0 ||
      stackRect.height <= 0 ||
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY)
    ) {
      const fallbackTabId = resolveTerminalDropTargetTabId(draggingTabId || "");
      const fallbackLayout = activeWorkspaceLayout && terminalLayoutLeafIds(activeWorkspaceLayout).includes(fallbackTabId || "")
        ? activeWorkspaceLayout
        : null;
      if (!fallbackTabId || !canCreateDropLayout(fallbackLayout, fallbackTabId, draggingTabId || "", "right")) {
        return {
          tabId: null,
          zone: null,
          rect: fallbackRect
        };
      }
      return {
        tabId: fallbackTabId,
        zone: "right",
        rect: rectFromDropZone(fallbackRect, "right")
      };
    }

    const stackX = ((event.clientX - stackRect.left) / stackRect.width) * 100;
    const stackY = ((event.clientY - stackRect.top) / stackRect.height) * 100;
    let targetTabId: string | null = null;
    let targetRect = fallbackRect;

    if (isSplitActive) {
      const draggingPaneRect = draggingTabId ? originalSplitGeometry.panes.get(draggingTabId) || null : null;
      if (draggingPaneRect) {
        const insideDraggingX = stackX >= draggingPaneRect.left && stackX <= draggingPaneRect.left + draggingPaneRect.width;
        const insideDraggingY = stackY >= draggingPaneRect.top && stackY <= draggingPaneRect.top + draggingPaneRect.height;
        if (insideDraggingX && insideDraggingY) {
          return {
            tabId: null,
            zone: null,
            rect: draggingPaneRect
          };
        }
      }

      const targetGeometry = draggingTabId && activeWorkspaceLayout && terminalLayoutLeafIds(activeWorkspaceLayout).includes(draggingTabId)
        ? terminalLayoutGeometry(removeTabFromTerminalLayout(activeWorkspaceLayout, draggingTabId))
        : splitGeometry;
      for (const [tabId, paneRect] of targetGeometry.panes) {
        const insideX = stackX >= paneRect.left && stackX <= paneRect.left + paneRect.width;
        const insideY = stackY >= paneRect.top && stackY <= paneRect.top + paneRect.height;
        if (insideX && insideY) {
          targetTabId = tabId;
          targetRect = paneRect;
          break;
        }
      }
    }

    if (!targetTabId) {
      targetTabId = resolveTerminalDropTargetTabId(draggingTabId || "");
      if (targetTabId && originalSplitGeometry.panes.has(targetTabId)) {
        targetRect = originalSplitGeometry.panes.get(targetTabId) || fallbackRect;
      }
    }

    const localX = (stackX - targetRect.left) / targetRect.width;
    const localY = (stackY - targetRect.top) / targetRect.height;
    const zone = dropZoneFromPoint(localX, localY);
    if (!zone || !targetTabId) {
      return {
        tabId: null,
        zone: null,
        rect: targetRect
      };
    }
    const targetLayout = activeWorkspaceLayout && terminalLayoutLeafIds(activeWorkspaceLayout).includes(targetTabId)
      ? activeWorkspaceLayout
      : null;
    if (!canCreateDropLayout(targetLayout, targetTabId, draggingTabId || "", zone)) {
      return {
        tabId: null,
        zone: null,
        rect: targetRect
      };
    }
    return {
      tabId: targetTabId,
      zone,
      rect: rectFromDropZone(targetRect, zone)
    };
  };

  const handleTerminalTabDragStart = (event: DragEvent<HTMLElement>, tabId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(terminalTabDragMime, tabId);
    event.dataTransfer.setData("text/plain", tabId);
    setTerminalTabDraggingId(tabId);
  };

  const clearTerminalTabDrag = () => {
    setTerminalTabDraggingId(null);
    setTerminalDropTarget(null);
    setTerminalTabListDropActive(false);
  };

  const resolveTerminalDropTargetTabId = (draggingTabId: string) => {
    if (activeTabId && activeTabId !== draggingTabId) {
      return activeTabId;
    }
    for (const tabId of splitVisibleTabIds) {
      if (tabId !== draggingTabId) {
        return tabId;
      }
    }
    return tabs.find((tab) => tab.id !== draggingTabId)?.id || null;
  };

  const handleTerminalPaneDragOver = (event: DragEvent<HTMLElement>) => {
    const draggingTabId = getTerminalTabDragId(event);
    if (!draggingTabId) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (terminalTabDraggingId !== draggingTabId) {
      setTerminalTabDraggingId(draggingTabId);
    }
    const nextTarget = dropTargetFromTerminalPaneEvent(event, draggingTabId);
    setTerminalDropTarget(nextTarget.tabId ? nextTarget : null);
    setTerminalTabListDropActive(false);
  };

  const handleTerminalPaneDragLeave = (event: DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setTerminalDropTarget(null);
  };

  const handleTerminalPaneDrop = (event: DragEvent<HTMLElement>) => {
    const draggingTabId = getTerminalTabDragId(event);
    if (!draggingTabId) {
      return;
    }
    event.preventDefault();
    const dropTarget = terminalDropTarget || dropTargetFromTerminalPaneEvent(event, draggingTabId);
    const targetTabId = dropTarget.tabId || resolveTerminalDropTargetTabId(draggingTabId);
    const draggingTabExists = tabs.some((tab) => tab.id === draggingTabId);
    const targetTabExists = targetTabId ? tabs.some((tab) => tab.id === targetTabId) : false;
    const zone = dropTarget.zone;
    if (!zone || !draggingTabExists || !targetTabId || !targetTabExists || draggingTabId === targetTabId) {
      clearTerminalTabDrag();
      return;
    }

    const targetLayout = splitLayouts.find((layout) => terminalLayoutLeafIds(layout).includes(targetTabId)) || null;
    if (!canCreateDropLayout(targetLayout, targetTabId, draggingTabId, zone)) {
      clearTerminalTabDrag();
      return;
    }

    setSplitLayouts((current) => {
      let changedExistingLayout = false;
      const currentTargetLayout = current.find((layout) => terminalLayoutLeafIds(layout).includes(targetTabId)) || null;
      const currentTargetLayoutSignature = terminalLayoutSignature(currentTargetLayout);
      const nextLayouts = current
        .map((layout) => {
          if (currentTargetLayoutSignature && terminalLayoutSignature(layout) === currentTargetLayoutSignature) {
            changedExistingLayout = true;
            return createDropLayout(layout, targetTabId, draggingTabId, zone);
          }
          if (terminalLayoutLeafIds(layout).includes(draggingTabId)) {
            return removeTabFromTerminalLayout(layout, draggingTabId);
          }
          return layout;
        });
      if (!changedExistingLayout) {
        nextLayouts.push(createDropLayout(null, targetTabId, draggingTabId, zone));
      }
      return normalizeTerminalLayouts(nextLayouts);
    });
    setActiveTabId(draggingTabId);
    clearTerminalTabDrag();
  };

  const handleTerminalTabListDragOver = (event: DragEvent<HTMLElement>) => {
    if (!terminalTabDraggingId) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setTerminalTabListDropActive(true);
    setTerminalDropTarget(null);
  };

  const handleTerminalTabListDragLeave = (event: DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setTerminalTabListDropActive(false);
  };

  const handleTerminalTabListDrop = (event: DragEvent<HTMLElement>) => {
    const draggingTabId = getTerminalTabDragId(event);
    if (!draggingTabId) {
      return;
    }
    event.preventDefault();
    setTerminalTabListDropActive(false);
    const draggingWorkspace = splitLayouts.find((layout) => terminalLayoutLeafIds(layout).includes(draggingTabId)) || null;
    if (draggingWorkspace) {
      const draggingWorkspaceId = terminalLayoutSignature(draggingWorkspace);
      setSplitLayouts((current) => normalizeTerminalLayouts(current.map((layout) => {
        if (terminalLayoutSignature(layout) !== draggingWorkspaceId) {
          return layout;
        }
        const next = removeTabFromTerminalLayout(layout, draggingTabId);
        return terminalLayoutLeafIds(next).length > 1 ? next : null;
      })));
      setActiveTabId(draggingTabId);
    }
    clearTerminalTabDrag();
  };

  const updateTab = useCallback((tabId: string, update: TerminalTabUpdate) => {
    if (update.closeOnNormalExit) {
      removeTab(tabId);
      return;
    }

    if (update.status === "connected") {
      reconnectAttemptsRef.current.delete(tabId);
      clearReconnectTimer(tabId);
    }

    const { closeOnNormalExit, reconnectRequested, connectionLogs: explicitConnectionLogs, ...tabUpdate } = update;
    void closeOnNormalExit;
    void reconnectRequested;
    const logEntry = connectionLogForStatus(update, t);
    startTransition(() => {
      setTabs((current) => {
        let changed = false;
        const nextTabs = current.map((tab) => {
          if (tab.id !== tabId) {
            return tab;
          }
          const nextConnectionLogs = explicitConnectionLogs || (logEntry ? [...tab.connectionLogs, logEntry] : tab.connectionLogs);
          const nextTab = {
            ...tab,
            ...tabUpdate,
            connectionLogs: nextConnectionLogs
          };
          if (terminalTabSameValue(tab, nextTab)) {
            return tab;
          }
          changed = true;
          return nextTab;
        });
        return changed ? nextTabs : current;
      });
    });
  }, [clearReconnectTimer, removeTab, t]);

  const updateTabActivity = useCallback((tabId: string, kind: "input" | "output") => {
    setTabs((current) => {
      let changed = false;
      const nextTabs = current.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        const hasPendingInput = kind === "input";
        if (Boolean(tab.hasPendingInput) === hasPendingInput) {
          return tab;
        }
        changed = true;
        return { ...tab, hasPendingInput };
      });
      return changed ? nextTabs : current;
    });
  }, []);

  const resolveInitialTerminalPaths = (host: Host, initialDirectory?: string | null) => {
    if (initialDirectory) {
      return { initialDirectory, initialDirectoryFallbacks: [] };
    }
    if (terminalDefaultPathPreference.mode === "home") {
      return { initialDirectory: null, initialDirectoryFallbacks: [] };
    }
    const candidates = defaultRemotePathCandidates(terminalDefaultPathPreference, defaultHomePath(host));
    return {
      initialDirectory: candidates[0] || null,
      initialDirectoryFallbacks: candidates.slice(1)
    };
  };

  const buildCreatingTab = (
    host: Host,
    initialDirectory?: string | null,
    initialDirectoryFallbacks: string[] = []
  ): TerminalTab => ({
    id: createLocalTerminalTabId(host.id),
    hostId: host.id,
    hostLabel: host.name,
    sessionId: "",
    websocketUrl: "",
    protocol: "",
    startedAt: new Date().toISOString(),
    status: "creating",
    message: t("terminal.creatingMessage"),
    rows: terminalDefaults.rows,
    cols: terminalDefaults.cols,
    initialDirectory: initialDirectory || null,
    initialDirectoryFallbacks,
    attachAttempt: 0,
    fingerprint: null,
    connectionLogs: initialConnectionLogs(host, t)
  });

  const buildTab = (
    host: Host,
    response: CreateTerminalSessionResponse,
    tabId = response.session.id,
    initialDirectory?: string | null,
    initialDirectoryFallbacks: string[] = []
  ): TerminalTab => ({
    id: tabId,
    hostId: host.id,
    hostLabel: host.name,
    sessionId: response.session.id,
    websocketUrl: buildTerminalWebSocketUrl(
      response.session.id,
      terminalDefaults.rows,
      terminalDefaults.cols,
      initialDirectory,
      initialDirectoryFallbacks,
      response.websocket.token
    ),
    protocol: response.websocket.protocol || terminalProtocol,
    startedAt: response.session.started_at,
    status: response.session.status,
    message: t("terminal.createdMessage"),
    rows: terminalDefaults.rows,
    cols: terminalDefaults.cols,
    initialDirectory: initialDirectory || null,
    initialDirectoryFallbacks,
    attachAttempt: 0,
    attached: response.session.attached,
    detachedAt: response.session.detached_at,
    expiresAt: response.session.expires_at,
    keepAliveUntil: response.session.keep_alive_until,
    attachToken: response.websocket.token,
    fingerprint: null,
    connectionLogs: [
      ...connectionLogEntriesFromPayload(response.connection_log),
      ...initialConnectionLogs(host, t),
      createConnectionLogEntry("info", t("terminal.createdMessage"))
    ]
  });

  const buildQuickTab = (
    response: CreateTerminalSessionResponse,
    hostLabel: string,
    tabId = response.session.id
  ): TerminalTab => ({
    id: tabId,
    hostId: response.session.host_id,
    hostLabel,
    sessionId: response.session.id,
    websocketUrl: buildTerminalWebSocketUrl(
      response.session.id,
      terminalDefaults.rows,
      terminalDefaults.cols,
      null,
      null,
      response.websocket.token
    ),
    protocol: response.websocket.protocol || terminalProtocol,
    startedAt: response.session.started_at,
    status: response.session.status,
    message: t("terminal.createdMessage"),
    rows: terminalDefaults.rows,
    cols: terminalDefaults.cols,
    initialDirectory: null,
    initialDirectoryFallbacks: [],
    attachAttempt: 0,
    attached: response.session.attached,
    detachedAt: response.session.detached_at,
    expiresAt: response.session.expires_at,
    keepAliveUntil: response.session.keep_alive_until,
    attachToken: response.websocket.token,
    fingerprint: null,
    connectionLogs: [
      ...connectionLogEntriesFromPayload(response.connection_log),
      createConnectionLogEntry("info", t("terminal.connectionLog.start", {
        target: hostLabel
      })),
      createConnectionLogEntry("info", t("terminal.connectionLog.credentialsQuick")),
      createConnectionLogEntry("info", t("terminal.connectionLog.startSsh")),
      createConnectionLogEntry("info", t("terminal.createdMessage"))
    ]
  });

  const buildRecoverableTab = (
    session: TerminalSession,
    snapshot?: TerminalWorkspaceSessionSnapshot
  ): TerminalTab => {
    const rows = snapshot?.rows || terminalDefaults.rows;
    const cols = snapshot?.cols || terminalDefaults.cols;
    const attachable = session.status === "connected" && session.attached !== true;
    const attachedElsewhere = session.status === "connected" && session.attached === true;
    const status: TerminalTab["status"] = attachable
      ? "connecting"
      : session.status === "disconnected"
        ? "disconnected"
        : "failed";

    return {
      id: session.id,
      hostId: session.host_id,
      hostLabel:
        snapshot?.host_label ||
        hosts.find((host) => host.id === session.host_id)?.name ||
        session.host_id,
      sessionId: session.id,
      websocketUrl: attachable ? buildTerminalWebSocketUrl(session.id, rows, cols, null, null, session.attach_token) : "",
      protocol: attachable ? terminalProtocol : "",
      startedAt: session.started_at || snapshot?.started_at || new Date().toISOString(),
      status,
      message: attachable
        ? t("terminal.restoringManaged")
        : attachedElsewhere
          ? t("terminal.attachedElsewhere")
          : t("terminal.unrecoverableStatus", { status: session.status }),
      rows,
      cols,
      initialDirectory: null,
      initialDirectoryFallbacks: [],
      attachAttempt: 0,
      attached: session.attached,
      detachedAt: session.detached_at,
      expiresAt: session.expires_at,
      keepAliveUntil: session.keep_alive_until || snapshot?.keep_alive_until,
      attachToken: session.attach_token,
      runtimeClosed: session.status !== "connected",
      fingerprint: null,
      connectionLogs: [
        createConnectionLogEntry("info", attachable ? t("terminal.restoringManaged") : (
          attachedElsewhere ? t("terminal.attachedElsewhere") : t("terminal.unrecoverableStatus", { status: session.status })
        ))
      ]
    };
  };

  const buildMissingSnapshotTab = (snapshot: TerminalWorkspaceSessionSnapshot): TerminalTab => ({
    id: snapshot.session_id,
    hostId: snapshot.host_id,
    hostLabel:
      snapshot.host_label ||
      hosts.find((host) => host.id === snapshot.host_id)?.name ||
      snapshot.host_id,
    sessionId: snapshot.session_id,
    websocketUrl: "",
    protocol: "",
    startedAt: snapshot.started_at || new Date().toISOString(),
    status: "failed",
    message: t("terminal.unrecoverableRuntime"),
    rows: snapshot.rows || terminalDefaults.rows,
    cols: snapshot.cols || terminalDefaults.cols,
    initialDirectory: null,
    initialDirectoryFallbacks: [],
    attachAttempt: 0,
    keepAliveUntil: snapshot.keep_alive_until,
    runtimeClosed: true,
    fingerprint: null,
    connectionLogs: [
      createConnectionLogEntry("error", t("terminal.unrecoverableRuntime"))
    ]
  });

  const restoreRecoverableTabs = useCallback(async (
    snapshot: TerminalWorkspaceSnapshot,
    options?: { includeMissingSnapshotTabs?: boolean }
  ) => {
    const response = await listTerminalSessions();
    const snapshotsBySessionId = createTerminalSnapshotSessionMap(snapshot.sessions || []);
    const recoverableSessionIds = new Set(response.items.map((session) => session.id));
    const restoredTabs = response.items.map((session) =>
      buildRecoverableTab(session, snapshotsBySessionId.get(session.id))
    );

    if (options?.includeMissingSnapshotTabs) {
      (snapshot.sessions || []).forEach((sessionSnapshot) => {
        if (!recoverableSessionIds.has(sessionSnapshot.session_id)) {
          restoredTabs.push(buildMissingSnapshotTab(sessionSnapshot));
        }
      });
    }

    return {
      tabs: restoredTabs,
      recoverableCount: response.items.length
    };
  }, [hosts, t]);

  const bootstrapTerminal = useCallback(async (host: Host) => {
    const formatSessionLimitMessage = (payload: { scope?: string; limit?: number }) => {
      const scope =
        payload.scope === "user"
          ? t("terminal.limit.user")
          : payload.scope === "global" || payload.scope === "total"
            ? t("terminal.limit.global")
            : t("terminal.limit.terminal");
      const limit =
        typeof payload.limit === "number"
          ? t("terminal.limit.count", { limit: payload.limit })
          : t("terminal.limit.default");
      return t("terminal.limit.message", { scope, limit });
    };
    const result = await createTerminalSession({
      host_id: host.id,
      rows: terminalDefaults.rows,
      cols: terminalDefaults.cols,
      formatSessionLimitMessage
    });

    if (result.kind === "success") {
      return result.data;
    }

    const confirmed = await fingerprintDialog.requestConfirmation({
      hostId: host.id,
      hostLabel: host.name,
      actionLabel: t("terminal.fingerprintAction"),
      conflict: result.data
    });

    if (!confirmed) {
      throw new Error(t("terminal.fingerprintCancelled"));
    }

    const retry = await createTerminalSession({
      host_id: host.id,
      rows: terminalDefaults.rows,
      cols: terminalDefaults.cols,
      formatSessionLimitMessage
    });

    if (retry.kind !== "success") {
      throw new Error(t("terminal.fingerprintRetryConflict"));
    }

    return retry.data;
  }, [fingerprintDialog, t]);

  const openTerminal = useCallback(async (host: Host, options?: { initialDirectory?: string | null }) => {
    setWorkspaceError(null);
    const { initialDirectory, initialDirectoryFallbacks } = resolveInitialTerminalPaths(host, options?.initialDirectory);
    const pendingTab = buildCreatingTab(host, initialDirectory, initialDirectoryFallbacks);
    setTabs((current) => [...current, pendingTab]);
    setActiveTabId(pendingTab.id);

    try {
      const response = await bootstrapTerminal(host);
      const tab = buildTab(host, response, response.session.id, initialDirectory, initialDirectoryFallbacks);
      setTabs((current) =>
        current.map((item) => (item.id === pendingTab.id ? tab : item))
      );
      setActiveTabId(tab.id);
      return tab;
    } catch (error) {
      const message = terminalSessionRequestErrorMessage(error, t("terminal.createFailed"), t);
      toast.error(message);
      updateTab(pendingTab.id, {
        status: "failed",
        message,
        connectionLogs: [
          ...pendingTab.connectionLogs,
          ...connectionLogFromTerminalError(error, message, t)
        ]
      });
      return null;
    }
  }, [bootstrapTerminal, t, terminalDefaultPathPreference, toast, updateTab]);

  const openQuickTerminal = useCallback(async (input: TemporaryConnectionInput) => {
    setWorkspaceError(null);
    const hostLabel = `${input.username}@${input.host}`;
    const pendingHost: Host = {
      id: `quick-${createClientId()}`,
      credential_id: input.credential_id || null,
      group_id: null,
      name: hostLabel,
      host: input.host,
      port: input.port,
      username: input.username,
      auth_type: input.auth_type,
      remark: null,
      is_favorite: false,
      status: "active",
      last_connected_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const pendingTab = buildCreatingTab(pendingHost, null);
    setTabs((current) => [...current, pendingTab]);
    setActiveTabId(pendingTab.id);

    try {
      const response = await createQuickTerminalSession({
        ...input,
        rows: terminalDefaults.rows,
        cols: terminalDefaults.cols
      });
      const tab = buildQuickTab(response, hostLabel, pendingTab.id);
      setTabs((current) =>
        current.map((item) => (item.id === pendingTab.id ? tab : item))
      );
      setActiveTabId(tab.id);
      return tab;
    } catch (error) {
      const message = terminalSessionRequestErrorMessage(error, t("terminal.createFailed"), t);
      toast.error(message);
      updateTab(pendingTab.id, {
        status: "failed",
        message,
        connectionLogs: [
          ...pendingTab.connectionLogs,
          ...connectionLogFromTerminalError(error, message, t)
        ]
      });
      return null;
    }
  }, [t, toast, updateTab]);

  const openTemporaryFiles = useCallback(async (input: TemporaryConnectionInput) => {
    const response = await createTemporaryConnection(input);
    window.sessionStorage.setItem(temporaryFileHostStorageKey, JSON.stringify(response.host));
    navigate(`/files?host_id=${encodeURIComponent(response.host.id)}`);
  }, [navigate]);

  const testQuickConnection = useCallback(async (input: TemporaryConnectionInput) => {
    const response = await createTemporaryConnection(input);
    const result = await testHost(response.host.id, {});
    if (result.kind !== "success") {
      throw new Error(t("quickConnect.testFailed"));
    }
    if (!result.data.ok) {
      throw new Error(result.data.message || t("quickConnect.testFailed"));
    }
    const fingerprint = result.data.fingerprint?.fingerprint
      ? `${result.data.fingerprint.algorithm} ${result.data.fingerprint.fingerprint}`
      : "";
    return fingerprint
      ? `${t("quickConnect.testSuccess")} · ${fingerprint}`
      : t("quickConnect.testSuccess");
  }, [t]);

  const copyConnectionLog = useCallback(async (tab: TerminalTab) => {
    const copied = await copyTextToClipboard(connectionLogClipboardText(tab.connectionLogs, language));
    if (copied) {
      toast.success(t("terminal.connectionLog.copied"));
    } else {
      toast.error(t("terminal.connectionLog.copyFailed"));
    }
  }, [language, t, toast]);

  const attachExistingSession = useCallback((tabId: string, message = t("terminal.reattaching")) => {
    clearReconnectTimer(tabId);
    reconnectAttemptsRef.current.delete(tabId);
    startTransition(() => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId && tab.sessionId
            ? {
              ...tab,
              status: "connecting",
              message,
              websocketUrl: buildTerminalWebSocketUrl(tab.sessionId, tab.rows, tab.cols, null, null, tab.attachToken),
              protocol: terminalProtocol,
              attachAttempt: tab.attachAttempt + 1,
              runtimeClosed: false
            }
            : tab
        )
      );
    });
  }, [clearReconnectTimer, t]);

  const scheduleReconnect = useCallback((tabId: string, reason: string) => {
    clearReconnectTimer(tabId);
    const nextAttempt = (reconnectAttemptsRef.current.get(tabId) || 0) + 1;
    reconnectAttemptsRef.current.set(tabId, nextAttempt);

    if (nextAttempt > maxReconnectAttempts) {
      updateTab(tabId, {
        status: "failed",
        message: t("terminal.reconnectExhausted")
      });
      return;
    }

    const delay = reconnectDelays[Math.min(nextAttempt - 1, reconnectDelays.length - 1)];
    updateTab(tabId, {
      status: "reconnecting",
      message: t("terminal.autoReconnect", { reason, seconds: Math.round(delay / 1000) })
    });

    const timer = window.setTimeout(async () => {
      reconnectTimersRef.current.delete(tabId);
      const tab = tabsRef.current.find((item) => item.id === tabId);
      if (!tab?.sessionId) {
        return;
      }

      try {
        const response = await getTerminalSession(tab.sessionId);
        const session = response.session;
        if (session.status === "connected" && session.attached === false) {
          updateTab(tabId, {
            attached: session.attached,
            detachedAt: session.detached_at,
            expiresAt: session.expires_at,
            keepAliveUntil: session.keep_alive_until,
            attachToken: session.attach_token
          });
          attachExistingSession(tabId);
          return;
        }

        if (session.status === "connected" && session.attached === true) {
          scheduleReconnect(tabId, t("terminal.stillAttached"));
          return;
        }

        updateTab(tabId, {
          status: session.status === "disconnected" ? "disconnected" : "failed",
          message:
            session.status === "connected"
              ? t("terminal.unrecoverableRuntime")
              : t("terminal.unrecoverableStatus", { status: session.status }),
          attached: session.attached,
          detachedAt: session.detached_at,
          expiresAt: session.expires_at,
          keepAliveUntil: session.keep_alive_until,
          runtimeClosed: true
        });
      } catch (error) {
        updateTab(tabId, {
          status: "reconnecting",
          message: getApiErrorMessage(error, t("terminal.queryFailedRetry"), t)
        });
        scheduleReconnect(tabId, t("terminal.queryFailed"));
      }
    }, delay);

    reconnectTimersRef.current.set(tabId, timer);
  }, [attachExistingSession, clearReconnectTimer, t, updateTab]);

  const reconnectTab = async (tab: TerminalTab) => {
    if (tab.sessionId && !tab.runtimeClosed) {
      attachExistingSession(tab.id, t("terminal.reattaching"));
      return;
    }

    const host = hosts.find((item) => item.id === tab.hostId);
    if (!host) {
      const message = t("terminal.hostMissing");
      setWorkspaceError(message);
      toast.error(message);
      return;
    }

    setWorkspaceError(null);
    updateTab(tab.id, {
      status: "creating",
      message: t("terminal.recreating"),
      sessionId: "",
      websocketUrl: "",
      protocol: "",
      fingerprint: null,
      runtimeClosed: false
    });

    try {
      const response = await bootstrapTerminal(host);
      const nextTab = buildTab(
        host,
        response,
        response.session.id,
        tab.initialDirectory,
        tab.initialDirectoryFallbacks || []
      );
      setTabs((current) => current.map((item) => (item.id === tab.id ? nextTab : item)));
      setActiveTabId(nextTab.id);
    } catch (error) {
      const message = terminalSessionRequestErrorMessage(error, t("terminal.reconnectFailed"), t);
      toast.error(message);
      updateTab(tab.id, {
        status: "failed",
        message
      });
    }
  };

  const closeTab = async (tab: TerminalTab, options?: { fallbackActiveTabId?: string | null }) => {
    const closeReasons = [
      tab.hasPendingInput ? t("terminal.closeConfirmReasonPending") : "",
      tab.keepAliveUntil ? t("terminal.closeConfirmReasonKeepalive") : ""
    ].filter(Boolean);
    if (closeReasons.length > 0) {
      const confirmed = await confirmDialog.requestConfirmation({
        title: t("terminal.closeConfirmTitle"),
        message: t("terminal.closeConfirmMessage", {
          name: tab.hostLabel,
          reason: closeReasons.join(t("terminal.closeConfirmReasonSeparator"))
        }),
        confirmLabel: t("terminal.closeConfirmAction"),
        tone: "danger"
      });
      if (!confirmed) {
        return;
      }
    }
    clearReconnectTimer(tab.id);
    if (tab.sessionId) {
      try {
        await closeTerminalSession(tab.sessionId);
      } catch (error) {
        const message = getApiErrorMessage(error, t("terminal.closeFailed"), t);
        setWorkspaceError(message);
        toast.error(message);
      }
    }
    removeTab(tab.id, options?.fallbackActiveTabId);
  };

  const closeWorkspaceTabs = (workspaceTabIds: string[]) => {
    const workspaceTabIdSet = new Set(workspaceTabIds);
    const fallbackTab = tabs.find((tab) => !workspaceTabIdSet.has(tab.id));
    workspaceTabIds
      .map((tabId) => tabs.find((tab) => tab.id === tabId))
      .filter((tab): tab is TerminalTab => Boolean(tab))
      .forEach((tab) => {
        void closeTab(tab, { fallbackActiveTabId: fallbackTab?.id || null });
      });
  };

  const toggleKeepAlive = async (tab: TerminalTab) => {
    if (!tab.sessionId) {
      return;
    }

    const enabled = !tab.keepAliveUntil;
    updateTab(tab.id, {
      message: enabled ? t("terminal.keepaliveOpening") : t("terminal.keepaliveClosing"),
      keepAlivePending: true
    });

    try {
      const response = await setTerminalSessionKeepAlive(tab.sessionId, enabled);
      updateTab(tab.id, {
        keepAliveUntil: response.session.keep_alive_until,
        expiresAt: response.session.expires_at,
        attached: response.session.attached,
        detachedAt: response.session.detached_at,
        message: enabled ? t("terminal.keepaliveOpened") : t("terminal.keepaliveClosed"),
        keepAlivePending: false
      });
      toast.success(enabled ? t("terminal.keepaliveOpened") : t("terminal.keepaliveClosed"));
    } catch (error) {
      const message = getApiErrorMessage(error, t("terminal.keepaliveFailed"), t);
      updateTab(tab.id, {
        message,
        keepAlivePending: false
      });
      toast.error(message);
    }
  };

  useEffect(() => {
    if (!appliedStoredSnapshotRef.current) {
      return;
    }

    setWorkspaceTerminalSnapshot(buildTerminalWorkspaceSnapshot(tabs, activeTabId));
  }, [activeTabId, setWorkspaceTerminalSnapshot, tabs]);

  useEffect(() => {
    if (hostsLoading || appliedStoredSnapshotRef.current) {
      return;
    }

    appliedStoredSnapshotRef.current = true;
    const snapshot = workspaceTerminalSnapshot;
    const sessionSnapshots = snapshot.sessions || [];

    const restoreTabs = async () => {
      try {
        const result = await restoreRecoverableTabs(snapshot);
        setTabs(result.tabs);
        if (sessionSnapshots.length && result.recoverableCount === 0) {
          const message = t("terminal.noRecoverable");
          setWorkspaceError(message);
          toast.info(message);
        } else {
          setWorkspaceError(null);
        }

        const activeTab = chooseRestoredTerminalActiveTab(result.tabs, snapshot);
        setActiveTabId(activeTab?.id || null);
      } catch (error) {
        const message = getApiErrorMessage(error, t("terminal.loadRecoverableFailed"), t);
        setWorkspaceError(message);
        toast.error(message);
      }
    };

    void restoreTabs();
  }, [hostsLoading, restoreRecoverableTabs, workspaceTerminalSnapshot]);

  useEffect(() => {
    if (hostsLoading || location.pathname !== "/terminal") {
      return;
    }

    const hostId = searchParams.get("host_id");
    if (!hostId) {
      appliedQueryTerminalRef.current = null;
      return;
    }
    const initialDirectory = searchParams.get("cwd") || null;
    const queryKey = `${hostId}\n${initialDirectory || ""}`;
    if (appliedQueryTerminalRef.current === queryKey) {
      return;
    }

    const host = hosts.find((item) => item.id === hostId);
    if (!host) {
      const message = t("terminal.openFailedHostMissing");
      setWorkspaceError(message);
      toast.error(message);
      appliedQueryTerminalRef.current = queryKey;
      setSearchParams({}, { replace: true });
      return;
    }

    appliedQueryTerminalRef.current = queryKey;
    void openTerminal(host, { initialDirectory });
    setSearchParams({}, { replace: true });
  }, [hosts, hostsLoading, location.pathname, openTerminal, searchParams, setSearchParams]);

  const terminalPaneStackClassName = [
    "terminal-pane-stack",
    isSplitActive ? "terminal-pane-stack-split" : "",
    splitResizing ? "terminal-pane-stack-resizing" : "",
    terminalDropTarget ? `terminal-pane-stack-drop-${terminalDropTarget.zone}` : ""
  ].filter(Boolean).join(" ");
  const terminalTabStripWorkspaces: TerminalTabStripWorkspace[] = splitLayouts.map((layout, index) => {
    const workspaceTabIds = terminalLayoutLeafIds(layout);
    const workspaceActive = workspaceTabIds.includes(activeTabId || "");
    const workspaceId = terminalLayoutSignature(layout) || `workspace-${index}`;
    const workspaceLabel = index === 0 ? t("terminal.workspaceTab") : `${t("terminal.workspaceTab")} (${index})`;
    return {
      active: workspaceActive,
      broadcasting: broadcastWorkspaceIds.has(workspaceId),
      id: workspaceId,
      label: workspaceLabel,
      tabIds: workspaceTabIds
    };
  });
  const terminalTabStripTabs = displayTabs.filter((tab) => !allSplitMemberTabIds.has(tab.id));
  const terminalPaneStackStyle = {
    "--terminal-split-ratio": formatSplitRatio(rootSplitRatio)
  } as CSSProperties;
  const terminalDropPreviewStyle = terminalDropTarget
    ? {
      left: `${terminalDropTarget.rect.left}%`,
      top: `${terminalDropTarget.rect.top}%`,
      width: `${terminalDropTarget.rect.width}%`,
      height: `${terminalDropTarget.rect.height}%`
    } as CSSProperties
    : undefined;
  const connectionLogDialogTab = connectionLogDialogTabId
    ? displayTabs.find((tab) => tab.id === connectionLogDialogTabId) || null
    : null;
  const shareDialogTab = shareDialogTabId
    ? displayTabs.find((tab) => tab.id === shareDialogTabId) || null
    : null;
  const shareDialogShare = shareDialogTab && isTerminalShareVisibleAt(terminalSharesBySessionId[shareDialogTab.sessionId], shareClockTick)
    ? terminalSharesBySessionId[shareDialogTab.sessionId]
    : null;
  const shareDialogRemainingMs = terminalShareRemainingMs(shareDialogShare, shareClockTick);
  const shareDialogRemainingText = shareDialogShare
    ? t("terminal.share.remaining", { time: formatTerminalShareRemaining(shareDialogRemainingMs, language) })
    : "";
  const shareDialogFinalMinute = isTerminalShareFinalMinute(shareDialogShare, shareClockTick);
  const shareDialogSessionId = shareDialogTab?.sessionId || "";
  const shareDialogShareId = shareDialogShare?.id || "";

  useEffect(() => {
    if (shareDialogShareId) {
      void loadShareAccessLogs(shareDialogShareId);
    }
  }, [loadShareAccessLogs, shareDialogShareId]);

  useEffect(() => {
    if (!shareDialogSessionId || !shareDialogShareId) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void loadShareForSession(shareDialogSessionId, { force: true, silent: true });
      void loadShareAccessLogs(shareDialogShareId);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadShareAccessLogs, loadShareForSession, shareDialogSessionId, shareDialogShareId]);

  return (
    <div className="route-page terminal-workspace-page">
      <p className="eyebrow route-eyebrow">Terminal Workspace</p>

      <div className="terminal-workspace-layout terminal-workspace-layout-single">
        <section className="content-card terminal-session-panel">
          <TerminalWorkspaceHeader
            aiCommandLabel={t("terminal.ai.entry")}
            historyLabel={t("terminal.history.title")}
            onOpenAiCommand={openAiCommandDialog}
            onOpenHistory={() => setTerminalHistoryOpen(true)}
            onOpenSavedCommands={openSavedCommandsDialog}
            savedCommandsCount={savedCommands.length}
            savedCommandsLabel={t("terminal.savedCommandsTitle")}
            title={t("terminal.title")}
          />

          {hostsLoading ? <p>{t("terminal.loadingHosts")}</p> : null}

          <TerminalSavedCommandsDialog
            canSendToActiveTerminal={canSendToActiveTerminal}
            categories={savedCommandCategories}
            categoryFilter={savedCommandCategoryFilter}
            commands={savedCommands}
            copiedCommandId={copiedCommandId}
            draggingId={savedCommandDraggingId}
            dropTargetId={savedCommandDropTargetId}
            form={savedCommandForm}
            isHighRiskCommand={isHighRiskCommand}
            loading={savedCommandsLoading}
            mode={savedCommandDialogMode}
            onBeginCreate={beginCreateSavedCommand}
            onCancelForm={cancelSavedCommandForm}
            onCategoryFilterChange={setSavedCommandCategoryFilter}
            onCopy={(command) => void copySavedCommand(command)}
            onDelete={(command) => void removeSavedCommand(command)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDragStart={handleDragStart}
            onDrop={(event, commandId) => void handleDrop(event, commandId)}
            onEdit={editSavedCommand}
            onFormChange={setSavedCommandForm}
            onOpenChange={handleSavedCommandsOpenChange}
            onSend={(command) => void sendSavedCommandToTerminal(command)}
            onSubmit={submitSavedCommand}
            open={savedCommandsDialogOpen}
            reordering={savedCommandReordering}
            submitting={savedCommandSubmitting}
            t={t}
            visibleCommands={visibleSavedCommands}
          />

          {tabs.length === 0 ? (
            <div className="empty-state terminal-empty-state">
              <p>{t("terminal.empty1")}</p>
              <p>{t("terminal.empty2")}</p>
              <div className="terminal-empty-actions">
                <Popover
                  className="files-host-picker-popover"
                  onOpenChange={(open) => {
                    setHostPickerOpen(open);
                    if (!open) {
                      setHostPickerFilter("");
                    }
                  }}
                  open={hostPickerOpen}
                  side="right"
                  sideOffset={10}
                  trigger={(
                    <Button
                      leadingIcon={<Plus aria-hidden="true" />}
                      size="sm"
                      variant="primary"
                    >
                      {t("quickConnect.newConnection")}
                    </Button>
                  )}
                >
                  <TerminalHostPicker
                    filter={hostPickerFilter}
                    hosts={filteredHostPickerHosts}
                    onFilterChange={setHostPickerFilter}
                    onSelectHost={(host) => {
                      setHostPickerOpen(false);
                      void openTerminal(host);
                    }}
                    t={t}
                  />
                </Popover>
              </div>

              {!hostsLoading && terminalLauncherHosts.length > 0 ? (
                <div className="terminal-empty-hosts">
                  <div className="dashboard-host-strip-header">
                    <strong>{terminalLauncherTitle}</strong>
                  </div>
                  <div className="terminal-host-list">
                    {terminalLauncherHosts.map((host) => (
                      <article className="terminal-host-item" key={host.id}>
                        <div>
                          <strong>{getHostDisplayName(host)}</strong>
                          <p>{getHostEndpoint(host)}</p>
                        </div>
                        <Button
                          aria-label={t("dashboard.openHostTerminal", { host: getHostDisplayName(host) })}
                          leadingIcon={<Monitor aria-hidden="true" />}
                          onClick={() => void openTerminal(host)}
                          size="sm"
                          variant="secondary"
                        >
                          {t("dashboard.hostTerminal")}
                        </Button>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <TerminalTabStrip
                activeTabId={activeTabId}
                draggingTabId={terminalTabDraggingId}
                hostPickerFilter={hostPickerFilter}
                hostPickerHosts={filteredHostPickerHosts}
                hostPickerOpen={hostPickerOpen}
                onCloseTab={(tab) => void closeTab(tab)}
                onCloseWorkspace={closeWorkspaceTabs}
                onDragEnd={clearTerminalTabDrag}
                onDragListDrop={handleTerminalTabListDrop}
                onDragListLeave={handleTerminalTabListDragLeave}
                onDragListOver={handleTerminalTabListDragOver}
                onDragStart={(event, tab) => handleTerminalTabDragStart(event, tab.id)}
                onHostPickerFilterChange={setHostPickerFilter}
                onHostPickerOpenChange={(open) => {
                  setHostPickerOpen(open);
                  if (!open) {
                    setHostPickerFilter("");
                  }
                }}
                onReconnectTab={(tab) => void reconnectTab(tab)}
                onSelectHost={(host) => {
                  setHostPickerOpen(false);
                  void openTerminal(host);
                }}
                onSelectTab={setActiveTabId}
                onSelectWorkspace={(_, workspaceTabIds) => setActiveTabId((current) => (
                  current && workspaceTabIds.includes(current) ? current : workspaceTabIds[0] || current
                ))}
                onToggleWorkspaceBroadcast={toggleWorkspaceBroadcast}
                splitActive={splitLayouts.length > 0}
                t={t}
                tabs={terminalTabStripTabs}
                tabListDropActive={terminalTabListDropActive}
                workspaces={terminalTabStripWorkspaces}
              />

              <div
                className={terminalPaneStackClassName}
                data-testid="terminal-pane-stack"
                ref={paneStackRef}
                style={terminalPaneStackStyle}
                onDragLeave={handleTerminalPaneDragLeave}
                onDragOver={handleTerminalPaneDragOver}
                onDrop={handleTerminalPaneDrop}
              >
                {terminalTabDraggingId && terminalDropTarget ? (
                  <div
                    aria-hidden="true"
                    className={`terminal-drop-preview terminal-drop-preview-${terminalDropTarget.zone}`}
                    style={terminalDropPreviewStyle}
                  />
                ) : null}
                {displayTabs.map((tab) => (
                  <div
                    className={[
                      "terminal-pane-shell",
                      renderVisibleTabIds.includes(tab.id) ? "terminal-pane-shell-active" : "",
                      isSplitActive && tab.id === activeTabId ? "terminal-pane-shell-focused" : ""
                    ].filter(Boolean).join(" ")}
                    key={tab.id}
                    onMouseDown={() => setActiveTabId(tab.id)}
                    style={isSplitActive && splitGeometry.panes.has(tab.id)
                      ? {
                        "--terminal-pane-left": `${splitGeometry.panes.get(tab.id)?.left}%`,
                        "--terminal-pane-top": `${splitGeometry.panes.get(tab.id)?.top}%`,
                        "--terminal-pane-width": `${splitGeometry.panes.get(tab.id)?.width}%`,
                        "--terminal-pane-height": `${splitGeometry.panes.get(tab.id)?.height}%`
                      } as CSSProperties
                      : undefined}
                  >
                    {renderVisibleTabIds.includes(tab.id) ? renderPaneHeader(tab, { isWorkspacePane: isSplitActive }) : null}
                    {tab.sessionId && tab.websocketUrl && tab.protocol ? (
                          <div className="terminal-pane">
                        <TerminalPane
                          active={visible && renderVisibleTabIds.includes(tab.id)}
                          connectionInfoLabel={t("terminal.connectionLog.open")}
                          onActivity={(kind) => updateTabActivity(tab.id, kind)}
                          onInput={(data) => handleTerminalInput(tab.id, data)}
                          protocol={tab.protocol}
                          resizeSuspended={splitResizing}
                          sessionId={tab.sessionId}
                          showSurfaceActions={false}
                          websocketUrl={tab.websocketUrl}
                          key={`${tab.sessionId}-${tab.attachAttempt}`}
                          ref={(handle) => {
                            if (handle) {
                              paneRefs.current.set(tab.id, handle);
                            } else {
                              paneRefs.current.delete(tab.id);
                            }
                          }}
                          onStateChange={(update) => {
                            updateTab(tab.id, update);
                            if (update.reconnectRequested) {
                              scheduleReconnect(tab.id, update.message || t("terminal.disconnectedFallback"));
                            }
                          }}
                          onOpenConnectionInfo={() => setConnectionLogDialogTabId(tab.id)}
                        />
                      </div>
                    ) : (
                      <div className="terminal-pane terminal-pane-active">
                        <div className="terminal-surface-frame terminal-surface-frame-placeholder">
                          <p className="terminal-placeholder-message">{getTerminalPlaceholderMessage(tab.status, tab.message, t)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {isSplitActive ? splitGeometry.splitters.map((splitter) => (
                  <div
                    aria-label="Resize terminal panes"
                    aria-orientation={splitter.direction === "vertical" ? "vertical" : "horizontal"}
                    className={[
                      "terminal-pane-splitter",
                      splitter.direction === "vertical" ? "terminal-pane-splitter-vertical" : "terminal-pane-splitter-horizontal"
                    ].join(" ")}
                    key={splitter.path.join(".") || "root"}
                    onDoubleClick={() => resetSplitRatio(splitter.path)}
                    onMouseDown={(event) => startSplitResize(event, splitter)}
                    role="separator"
                    style={{
                      "--terminal-splitter-left": `${splitter.rect.left + splitter.rect.width * splitter.ratio}%`,
                      "--terminal-splitter-top": `${splitter.rect.top + splitter.rect.height * splitter.ratio}%`,
                      "--terminal-splitter-span-left": `${splitter.rect.left}%`,
                      "--terminal-splitter-span-top": `${splitter.rect.top}%`,
                      "--terminal-splitter-span-width": `${splitter.rect.width}%`,
                      "--terminal-splitter-span-height": `${splitter.rect.height}%`
                    } as CSSProperties}
                  />
                )) : null}
              </div>
            </>
          )}
          <TerminalAiCommandDialog
            canSendToActiveTerminal={canSendToActiveTerminal}
            description={activeDisplayTab?.hostLabel}
            draft={aiCommandDraft}
            error={aiCommandError}
            generating={aiCommandGenerating}
            importing={aiCommandImporting}
            includeSystemInfo={aiCommandIncludeSystemInfo}
            message={aiCommandMessage}
            onDraftChange={setAiCommandDraft}
            onImport={importAiCommandToSavedCommands}
            onIncludeSystemInfoChange={setAiCommandIncludeSystemInfo}
            onOpenChange={handleAiCommandDialogOpenChange}
            onPromptChange={setAiCommandPrompt}
            onSubmit={submitAiCommandPrompt}
            onWriteToTerminal={writeAiCommandToTerminal}
            open={aiCommandDialogOpen}
            prompt={aiCommandPrompt}
            rawResponse={aiCommandRawResponse}
            systemInfoAvailable={activeAiSystemInfoAvailable}
            t={t}
            unsupported={aiCommandUnsupported}
          />
        </section>
      </div>

      <TemporaryQuickConnectDialog
        onConnectFiles={openTemporaryFiles}
        onConnectTerminal={openQuickTerminal}
        onTestConnection={testQuickConnection}
        onOpenChange={setQuickConnectOpen}
        open={quickConnectOpen}
      />
      <TerminalHistoryDialog onOpenChange={setTerminalHistoryOpen} open={terminalHistoryOpen} />
      <TerminalShareDialog
        accessLogs={shareAccessLogs}
        description={shareDialogTab ? shareDialogTab.hostLabel : undefined}
        fieldErrors={shareFieldErrors}
        finalMinute={shareDialogFinalMinute}
        form={shareForm}
        formatDateTime={(value) => formatTerminalDateTime(value, language)}
        logsLoading={shareLogsLoading}
        onClose={closeShareDialog}
        onCopyLink={copyShareUrl}
        onCreate={createShareFromDialog}
        onExtend={(share, expiresInMinutes) => void extendShare(share, expiresInMinutes)}
        onFormFieldChange={updateShareFormField}
        onRefresh={() => {
          if (shareDialogTab) {
            void loadShareForSession(shareDialogTab.sessionId, { force: true, silent: true });
          }
        }}
        onRevoke={(share) => void revokeShareFromDialog(share)}
        open={Boolean(shareDialogTab)}
        remainingText={shareDialogRemainingText}
        share={shareDialogShare}
        submitting={shareSubmitting}
        t={t}
      />
      <Dialog
        closeLabel={t("common.close")}
        description={
          connectionLogDialogTab ? (
            <span>
              {connectionLogDialogTab.hostLabel} · {formatTerminalStatusLabel(connectionLogDialogTab.status, t)}
            </span>
          ) : undefined
        }
        onOpenChange={(open) => {
          if (!open) {
            setConnectionLogDialogTabId(null);
          }
        }}
        open={Boolean(connectionLogDialogTab)}
        size="md"
        title={t("terminal.connectionLog.title")}
      >
        {connectionLogDialogTab ? (
          <TerminalConnectionLogPanel
            language={language}
            logs={connectionLogDialogTab.connectionLogs}
            onCopy={() => void copyConnectionLog(connectionLogDialogTab)}
            t={t}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
