export type TransferTaskType = "upload" | "download";

export type TransferTaskStatus =
  | "pending"
  | "uploading_to_platform"
  | "queued_for_remote_transfer"
  | "transferring"
  | "paused"
  | "failed"
  | "completed"
  | "canceled";

export type TransferTask = {
  id: string;
  task_type: TransferTaskType;
  source_type?: string | null;
  target_type?: string | null;
  source_host_id?: string | null;
  target_host_id?: string | null;
  source_path?: string | null;
  target_path?: string | null;
  file_name: string;
  total_bytes: number;
  transferred_bytes: number;
  chunk_size?: number | null;
  status: TransferTaskStatus;
  resumable: boolean;
  retry_count: number;
  error_code?: string | null;
  error_message?: string | null;
  download_url?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type TransferTaskResponse = {
  task: TransferTask;
};

export type TransferTaskListResponse = {
  items: TransferTask[];
  page: number;
  page_size: number;
  total: number;
};

export type InitUploadInput = {
  target_host_id: string;
  target_path: string;
  file_name: string;
  file_size: number;
};

export type InitUploadResponse = {
  task_id: string;
  chunk_size: number;
  resume_offset: number;
  status: TransferTaskStatus;
};

export type UploadChunkResponse = {
  accepted_bytes: number;
  received_bytes: number;
  next_offset: number;
  status: TransferTaskStatus;
};

export function isTransferActiveStatus(status: TransferTaskStatus) {
  return (
    status === "pending" ||
    status === "uploading_to_platform" ||
    status === "queued_for_remote_transfer" ||
    status === "transferring"
  );
}

export function isTransferTerminalStatus(status: TransferTaskStatus) {
  return status === "completed" || status === "failed" || status === "canceled";
}

export function canPauseTransfer(task: TransferTask) {
  return (
    task.status === "pending" ||
    task.status === "uploading_to_platform" ||
    task.status === "queued_for_remote_transfer" ||
    task.status === "transferring"
  );
}

export function canResumeTransfer(task: TransferTask) {
  return task.status === "paused";
}

export function canRetryTransfer(task: TransferTask) {
  return task.status === "failed";
}

export function canCancelTransfer(task: TransferTask) {
  return !isTransferTerminalStatus(task.status);
}
