export type AuditResult = "success" | "failure";

export type AuditLog = {
  id: string;
  session_id?: string | null;
  terminal_session_id?: string | null;
  target_host_id?: string | null;
  event_type: string;
  resource_type?: string | null;
  resource_id?: string | null;
  target_path?: string | null;
  result: AuditResult;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
  client_ip?: string | null;
  user_agent?: string | null;
  occurred_at: string;
};

export type AuditLogResponse = {
  log: AuditLog;
};

export type AuditLogListResponse = {
  items: AuditLog[];
  page: number;
  page_size: number;
  total: number;
};
