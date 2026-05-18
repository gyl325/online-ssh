import { request } from "../../shared/api/http";
import type { AuditLogListResponse, AuditLogResponse, AuditResult } from "./types";

export function listAuditLogs(input?: {
  page?: number;
  page_size?: number;
  event_type?: string;
  target_host_id?: string;
  result?: AuditResult | "";
  start_time?: string;
  end_time?: string;
}) {
  return request<AuditLogListResponse>({
    path: "/api/audit/logs",
    query: input
  });
}

export function getAuditLog(logId: string) {
  return request<AuditLogResponse>({
    path: `/api/audit/logs/${logId}`
  });
}
