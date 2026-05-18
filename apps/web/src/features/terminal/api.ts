import { HttpError, request } from "../../shared/api/http";
import { withFingerprintConflict } from "../fingerprint/apiResult";
import type {
  CreateTerminalSessionResult,
  CreateTerminalSessionResponse,
  CreateQuickTerminalSessionInput,
  CreateTerminalShareResponse,
  OpenTerminalShareAccessResponse,
  TerminalCommandAssistantRequest,
  TerminalCommandAssistantResponse,
  TerminalRecordingChunkListResponse,
  TerminalRecordingListResponse,
  TerminalRecordingResponse,
  TerminalRecordingSettingsResponse,
  TerminalShareAccessLogListResponse,
  TerminalShareResponse,
  TerminalSessionListResponse,
  TerminalSessionResponse
} from "./types";

type TerminalSessionLimitPayload = {
  code?: string;
  message?: string;
  scope?: string;
  limit?: number;
};

export async function createTerminalSession(input: {
  host_id: string;
  rows: number;
  cols: number;
  formatSessionLimitMessage?: (payload: TerminalSessionLimitPayload) => string;
}): Promise<CreateTerminalSessionResult> {
  try {
    return await withFingerprintConflict(() => request<CreateTerminalSessionResponse>({
      method: "POST",
      path: "/api/terminal/sessions",
      body: {
        host_id: input.host_id,
        rows: input.rows,
        cols: input.cols
      }
    }));
  } catch (error) {
    if (error instanceof HttpError && error.status === 429 && error.code === "TERMINAL_SESSION_LIMIT_EXCEEDED") {
      throw new Error(input.formatSessionLimitMessage?.(error.payload as TerminalSessionLimitPayload) || error.message);
    }

    throw error;
  }
}

export function createQuickTerminalSession(input: CreateQuickTerminalSessionInput) {
  return request<CreateTerminalSessionResponse>({
    method: "POST",
    path: "/api/terminal/sessions/quick-connect",
    body: input
  });
}

export function listTerminalSessions() {
  return request<TerminalSessionListResponse>({
    method: "GET",
    path: "/api/terminal/sessions"
  });
}

export function generateTerminalCommand(input: TerminalCommandAssistantRequest) {
  return request<TerminalCommandAssistantResponse>({
    method: "POST",
    path: "/api/terminal/command-assistant/generate",
    body: input
  });
}

export function getTerminalSession(sessionId: string) {
  return request<TerminalSessionResponse>({
    method: "GET",
    path: `/api/terminal/sessions/${sessionId}`
  });
}

export function setTerminalSessionKeepAlive(sessionId: string, enabled: boolean) {
  return request<TerminalSessionResponse>({
    method: "POST",
    path: `/api/terminal/sessions/${sessionId}/keepalive`,
    body: { enabled }
  });
}

export function closeTerminalSession(sessionId: string) {
  return request<TerminalSessionResponse>({
    method: "POST",
    path: `/api/terminal/sessions/${sessionId}/close`
  });
}

export function getTerminalShare(sessionId: string) {
  return request<TerminalShareResponse>({
    method: "GET",
    path: `/api/terminal/sessions/${sessionId}/share`
  });
}

export function createTerminalShare(sessionId: string, input: {
  expires_in_minutes: number;
  max_accesses?: number | null;
  password?: string;
  sensitive_prompt?: string;
}) {
  return request<CreateTerminalShareResponse>({
    method: "POST",
    path: `/api/terminal/sessions/${sessionId}/share`,
    body: input
  });
}

export function extendTerminalShare(shareId: string, expiresInMinutes: number) {
  return request<TerminalShareResponse>({
    method: "PATCH",
    path: `/api/terminal/shares/${shareId}`,
    body: { expires_in_minutes: expiresInMinutes }
  });
}

export function revokeTerminalShare(shareId: string) {
  return request<TerminalShareResponse>({
    method: "DELETE",
    path: `/api/terminal/shares/${shareId}`
  });
}

export function listTerminalShareAccessLogs(shareId: string, params: { page?: number; page_size?: number } = {}) {
  return request<TerminalShareAccessLogListResponse>({
    method: "GET",
    path: `/api/terminal/shares/${shareId}/access-logs`,
    query: params
  });
}

export function openTerminalShareAccess(token: string, password = "", options: { idempotencyKey?: string } = {}) {
  return request<OpenTerminalShareAccessResponse>({
    method: "POST",
    path: "/api/terminal/shares/open",
    body: {
      token,
      password,
      idempotency_key: options.idempotencyKey || undefined
    },
    skipAuthRefresh: true
  });
}

export function getTerminalRecordingSettings() {
  return request<TerminalRecordingSettingsResponse>({
    method: "GET",
    path: "/api/terminal/settings"
  });
}

export function updateTerminalRecordingSettings(input: {
  enabled: boolean;
  retention_days: number;
}) {
  return request<TerminalRecordingSettingsResponse>({
    method: "PUT",
    path: "/api/terminal/settings",
    body: input
  });
}

export function listTerminalRecordings(params: { page?: number; page_size?: number } = {}) {
  return request<TerminalRecordingListResponse>({
    method: "GET",
    path: "/api/terminal/recordings",
    query: params
  });
}

export function getTerminalRecording(recordingId: string) {
  return request<TerminalRecordingResponse>({
    method: "GET",
    path: `/api/terminal/recordings/${recordingId}`
  });
}

export function listTerminalRecordingChunks(recordingId: string, params: { cursor?: number; limit?: number } = {}) {
  return request<TerminalRecordingChunkListResponse>({
    method: "GET",
    path: `/api/terminal/recordings/${recordingId}/chunks`,
    query: params
  });
}

export function updateTerminalRecordingBookmark(recordingId: string, isBookmarked: boolean) {
  return request<TerminalRecordingResponse>({
    method: "PUT",
    path: `/api/terminal/recordings/${recordingId}/bookmark`,
    body: { is_bookmarked: isBookmarked }
  });
}

export function deleteTerminalRecording(recordingId: string) {
  return request<void>({
    method: "DELETE",
    path: `/api/terminal/recordings/${recordingId}`,
    responseType: "void"
  });
}
