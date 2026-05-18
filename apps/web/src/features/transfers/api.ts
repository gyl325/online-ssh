import { request, requestBlob } from "../../shared/api/http";
import type {
  InitUploadInput,
  InitUploadResponse,
  TransferTaskListResponse,
  TransferTaskResponse,
  TransferTaskStatus,
  TransferTaskType,
  UploadChunkResponse
} from "./types";

export function initUploadTask(input: InitUploadInput) {
  return request<InitUploadResponse>({
    method: "POST",
    path: "/api/transfers/upload/init",
    body: input
  });
}

export function uploadTransferChunk(taskId: string, offset: number, payload: Blob) {
  return request<UploadChunkResponse>({
    method: "PATCH",
    path: `/api/transfers/upload/${taskId}/chunk`,
    query: { offset },
    body: payload,
    bodyType: "raw",
    headers: {
      "Content-Type": "application/octet-stream"
    }
  });
}

export function listTransferTasks(input?: {
  page?: number;
  page_size?: number;
  status?: TransferTaskStatus | "";
  task_type?: TransferTaskType | "";
  created_from?: string;
  created_to?: string;
}) {
  return request<TransferTaskListResponse>({
    path: "/api/transfers",
    query: input
  });
}

export function getTransferTask(taskId: string) {
  return request<TransferTaskResponse>({
    path: `/api/transfers/${taskId}`
  });
}

export function pauseTransferTask(taskId: string) {
  return request<TransferTaskResponse>({
    method: "POST",
    path: `/api/transfers/${taskId}/pause`
  });
}

export function resumeTransferTask(taskId: string) {
  return request<TransferTaskResponse>({
    method: "POST",
    path: `/api/transfers/${taskId}/resume`
  });
}

export function cancelTransferTask(taskId: string) {
  return request<TransferTaskResponse>({
    method: "POST",
    path: `/api/transfers/${taskId}/cancel`
  });
}

export function retryTransferTask(taskId: string) {
  return request<TransferTaskResponse>({
    method: "POST",
    path: `/api/transfers/${taskId}/retry`
  });
}

export function downloadTransferTaskContent(taskId: string) {
  return requestBlob({ path: `/api/transfers/${taskId}/content` });
}
