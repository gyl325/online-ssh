import type { FingerprintCallResult } from "../fingerprint/apiResult";
import type { CredentialAuthType } from "../credentials/types";
import type { QuickConnectionKeyType } from "../connections/types";

export type TerminalSession = {
  id: string;
  host_id: string;
  status: "connecting" | "connected" | "disconnected" | "failed";
  started_at: string;
  ended_at?: string | null;
  attached?: boolean | null;
  detached_at?: string | null;
  expires_at?: string | null;
  keep_alive_until?: string | null;
  attach_token?: string | null;
};

export type TerminalShare = {
  id: string;
  terminal_session_id: string;
  host_id: string;
  expires_at: string;
  revoked_at?: string | null;
  max_accesses?: number | null;
  access_count: number;
  password_required: boolean;
  sensitive_prompt: string;
  viewer_count: number;
  url?: string;
};

export type TerminalShareAccessLog = {
  id: string;
  share_id: string;
  terminal_session_id: string;
  client_ip?: string | null;
  user_agent?: string | null;
  result: "success" | "failure";
  failure_reason?: string | null;
  accessed_at: string;
};

export type TerminalWebSocketInfo = {
  url: string;
  protocol: string;
  token?: string | null;
};

export type TerminalConnectionLogEntryPayload = {
  level: "info" | "success" | "warning" | "error";
  message: string;
  occurred_at: string;
};

export type CreateTerminalSessionResponse = {
  session: TerminalSession;
  websocket: TerminalWebSocketInfo;
  connection_log?: TerminalConnectionLogEntryPayload[] | null;
};

export type TerminalSessionResponse = {
  session: TerminalSession;
};

export type TerminalShareResponse = {
  share: TerminalShare;
};

export type CreateTerminalShareResponse = {
  share: TerminalShare;
  token: string;
};

export type OpenTerminalShareAccessResponse = {
  share: TerminalShare;
  viewer_token: string;
  viewer_token_expires_at: string;
  websocket: {
    url: string;
    protocol: "terminal-share.v1";
  };
};

export type TerminalShareAccessLogListResponse = {
  items: TerminalShareAccessLog[];
  page: number;
  page_size: number;
  total: number;
};

export type TerminalSessionListResponse = {
  items: TerminalSession[];
};

export type TerminalCommandAssistantRequest = {
  prompt: string;
  host_label?: string;
  shell_hint?: string;
  working_directory?: string;
  system_info?: string;
};

export type TerminalCommandAssistantResult = {
  command_text: string;
  name: string;
  category?: string;
  description?: string;
  risk_level: "low" | "medium" | "high";
  notes?: string[];
};

export type TerminalCommandAssistantResponse =
  | {
      result: TerminalCommandAssistantResult;
      raw_response?: never;
      invalid_response?: never;
      unsupported_request?: never;
      refusal_message?: never;
      suggested_prompt?: never;
    }
  | {
      raw_response: string;
      invalid_response: true;
      result?: never;
      unsupported_request?: never;
      refusal_message?: never;
      suggested_prompt?: never;
    }
  | {
      unsupported_request: true;
      refusal_message: string;
      suggested_prompt?: string;
      result?: never;
      raw_response?: never;
      invalid_response?: never;
    };

export type TerminalRecordingSettings = {
  enabled: boolean;
  retention_days: number;
  updated_at?: string | null;
};

export type TerminalRecording = {
  id: string;
  terminal_session_id?: string | null;
  host_id?: string | null;
  status: "active" | "completed" | "failed";
  started_at: string;
  ended_at?: string | null;
  expires_at: string;
  is_bookmarked: boolean;
  input_bytes: number;
  output_bytes: number;
  dropped_bytes: number;
  created_at: string;
};

export type TerminalRecordingChunk = {
  sequence: number;
  direction: "input" | "output";
  occurred_at: string;
  data: string;
  byte_count: number;
};

export type TerminalRecordingSettingsResponse = {
  settings: TerminalRecordingSettings;
};

export type TerminalRecordingListResponse = {
  items: TerminalRecording[];
  page: number;
  page_size: number;
  total: number;
};

export type TerminalRecordingResponse = {
  recording: TerminalRecording;
};

export type TerminalRecordingChunkListResponse = {
  items: TerminalRecordingChunk[];
  next_cursor: number;
  has_more: boolean;
};

export type TerminalReadyEvent = {
  type: "ready";
  session_id: string;
  host_id: string;
  status: string;
  protocol: string;
  readonly?: boolean;
  share_id?: string;
  attached?: boolean | null;
  detached_at?: string | null;
  expires_at?: string | null;
  keep_alive_until?: string | null;
  fingerprint?: {
    algorithm: string;
    fingerprint: string;
    status: string;
  };
};

export type TerminalShareUpdateEvent = {
  type: "share_update";
  share_id: string;
  expires_at: string;
};

export type TerminalPongEvent = {
  type: "pong";
  session_id: string;
};

export type TerminalErrorEvent = {
  type: "error";
  code: string;
  message: string;
};

export type TerminalExitEvent = {
  type: "exit";
  status: "disconnected" | "failed";
  message: string;
  runtime_closed?: boolean;
};

export type TerminalControlEvent =
  | TerminalReadyEvent
  | TerminalShareUpdateEvent
  | TerminalPongEvent
  | TerminalErrorEvent
  | TerminalExitEvent;

export type CreateTerminalSessionResult = FingerprintCallResult<CreateTerminalSessionResponse>;

export type CreateQuickTerminalSessionInput = {
  auth_type: CredentialAuthType;
  cols: number;
  credential_id?: string;
  host: string;
  key_type?: QuickConnectionKeyType;
  passphrase?: string;
  password?: string;
  port: number;
  private_key?: string;
  rows: number;
  username: string;
};
