import type { AuditResult } from "../audit/types";

export type AuditExportTaskStatus = "pending" | "running" | "completed" | "failed" | "canceled";

export type AuditExportTask = {
  id: string;
  user_id: string;
  filter_event_type: string;
  filter_target_host_id?: string | null;
  filter_result: AuditResult | "";
  filter_start_time?: string | null;
  filter_end_time?: string | null;
  status: AuditExportTaskStatus;
  total_rows: number;
  exported_rows: number;
  error_code?: string | null;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type CreateAuditExportInput = {
  event_type?: string;
  target_host_id?: string;
  result?: AuditResult | "";
  start_time?: string;
  end_time?: string;
};

export type AuditExportTaskResponse = {
  task: AuditExportTask;
};

export type AuditExportTaskListResponse = {
  items: AuditExportTask[];
  page: number;
  page_size: number;
  total: number;
};
