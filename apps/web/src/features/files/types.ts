import type { FingerprintCallResult } from "../fingerprint/apiResult";

export type FileEntry = {
  name: string;
  path: string;
  entry_type: "file" | "directory" | "symlink" | "other";
  size_bytes: number;
  permissions: string;
  owner?: string | null;
  group?: string | null;
  modified_at: string;
  is_hidden: boolean;
};

export type FileListResponse = {
  host_id: string;
  path: string;
  items: FileEntry[];
  next_cursor?: string | null;
};

export type FileSearchResponse = {
  host_id: string;
  base_path: string;
  keyword: string;
  items: FileEntry[];
};

export type FileSearchTaskStatus = "pending" | "running" | "completed" | "failed" | "canceled";

export type FileSearchTaskWarning = {
  path: string;
  message: string;
};

export type FileSearchTask = {
  id: string;
  host_id: string;
  base_path: string;
  keyword: string;
  match_mode: "name" | "path";
  recursive: boolean;
  include_hidden: boolean;
  max_depth: number;
  max_results: number;
  max_scanned_entries: number;
  timeout_seconds: number;
  status: FileSearchTaskStatus;
  scanned_dirs: number;
  scanned_entries: number;
  matched_entries: number;
  skipped_errors_count: number;
  limit_reached: boolean;
  error_code?: string | null;
  error_message?: string | null;
  warnings_json: FileSearchTaskWarning[];
  started_at?: string | null;
  finished_at?: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type FileSearchTaskResponse = {
  task: FileSearchTask;
};

export type FileSearchResult = FileEntry & {
  id: string;
  task_id: string;
  rank: number;
  created_at: string;
};

export type FileSearchResultListResponse = {
  items: FileSearchResult[];
  page: number;
  page_size: number;
  total: number;
};

export type FileOperationResponse = {
  success: boolean;
  message: string;
};

export type FileChecksumResponse = {
  host_id: string;
  path: string;
  algorithm: "md5" | "sha256";
  checksum: string;
};

export type FileContentResponse = {
  host_id: string;
  path: string;
  content: string;
  encoding: string;
  size_bytes: number;
  last_modified_at: string;
};

export type TransferTaskLite = {
  id: string;
  task_type: string;
  status: string;
  file_name: string;
  total_bytes: number;
  transferred_bytes: number;
  target_host_id?: string | null;
  source_host_id?: string | null;
  target_path?: string | null;
  source_path?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  download_url?: string | null;
};

export type TransferTaskResponse = {
  task: TransferTaskLite;
};

export type FilesCallResult<T> = FingerprintCallResult<T>;
