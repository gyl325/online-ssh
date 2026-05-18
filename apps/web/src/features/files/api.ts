import { request } from "../../shared/api/http";
import { withFingerprintConflict } from "../fingerprint/apiResult";
import type {
  FileChecksumResponse,
  FileContentResponse,
  FileListResponse,
  FileOperationResponse,
  FileSearchResultListResponse,
  FileSearchResponse,
  FileSearchTaskResponse,
  FilesCallResult,
  TransferTaskResponse
} from "./types";

function withFingerprint<T>(runner: () => Promise<T>): Promise<FilesCallResult<T>> {
  return withFingerprintConflict(runner);
}

export function listDirectory(input: { host_id: string; path: string; limit?: number; cursor?: string }) {
  return withFingerprint(() =>
    request<FileListResponse>({
      path: "/api/files/list",
      query: input
    })
  );
}

export function searchFiles(input: {
  host_id: string;
  base_path: string;
  keyword: string;
  recursive?: boolean;
}) {
  return withFingerprint(() =>
    request<FileSearchResponse>({
      path: "/api/files/search",
      query: input
    })
  );
}

export function createFileSearchTask(input: {
  host_id: string;
  base_path: string;
  keyword: string;
  match_mode?: "name" | "path";
  recursive?: boolean;
  include_hidden?: boolean;
  max_depth?: number;
  max_results?: number;
  max_scanned_entries?: number;
  timeout_seconds?: number;
}) {
  return withFingerprint(() =>
    request<FileSearchTaskResponse>({
      method: "POST",
      path: "/api/files/search-tasks",
      body: input
    })
  );
}

export function getFileSearchTask(taskId: string) {
  return withFingerprint(() =>
    request<FileSearchTaskResponse>({
      path: `/api/files/search-tasks/${taskId}`
    })
  );
}

export function listFileSearchTaskResults(input: { task_id: string; page?: number; page_size?: number }) {
  return withFingerprint(() =>
    request<FileSearchResultListResponse>({
      path: `/api/files/search-tasks/${input.task_id}/results`,
      query: {
        page: input.page,
        page_size: input.page_size
      }
    })
  );
}

export function cancelFileSearchTask(taskId: string) {
  return withFingerprint(() =>
    request<FileSearchTaskResponse>({
      method: "POST",
      path: `/api/files/search-tasks/${taskId}/cancel`
    })
  );
}

export function createDirectory(input: { host_id: string; path: string }) {
  return withFingerprint(() =>
    request<FileOperationResponse>({
      method: "POST",
      path: "/api/files/mkdir",
      body: input
    })
  );
}

export function createFile(input: { host_id: string; path: string }) {
  return withFingerprint(() =>
    request<FileOperationResponse>({
      method: "POST",
      path: "/api/files/touch",
      body: input
    })
  );
}

export function renameFile(input: { host_id: string; old_path: string; new_path: string }) {
  return withFingerprint(() =>
    request<FileOperationResponse>({
      method: "POST",
      path: "/api/files/rename",
      body: input
    })
  );
}

export function deleteFile(input: { host_id: string; path: string; recursive?: boolean }) {
  return withFingerprint(() =>
    request<FileOperationResponse>({
      method: "POST",
      path: "/api/files/delete",
      body: input
    })
  );
}

export function chmodFile(input: { host_id: string; path: string; mode: string }) {
  return withFingerprint(() =>
    request<FileOperationResponse>({
      method: "POST",
      path: "/api/files/chmod",
      body: input
    })
  );
}

export function copyFile(input: { host_id: string; source_path: string; target_path: string }) {
  return withFingerprint(() =>
    request<FileOperationResponse>({
      method: "POST",
      path: "/api/files/copy",
      body: input
    })
  );
}

export function calculateFileChecksum(input: { host_id: string; path: string; algorithm: "md5" | "sha256" }) {
  return withFingerprint(() =>
    request<FileChecksumResponse>({
      method: "POST",
      path: "/api/files/checksum",
      body: input
    })
  );
}

export function compressArchive(input: { host_id: string; path: string; output_path?: string }) {
  return withFingerprint(() =>
    request<FileOperationResponse>({
      method: "POST",
      path: "/api/files/archive/compress",
      body: input
    })
  );
}

export function extractArchive(input: { host_id: string; path: string; target_path?: string }) {
  return withFingerprint(() =>
    request<FileOperationResponse>({
      method: "POST",
      path: "/api/files/archive/extract",
      body: input
    })
  );
}

export function readFileContent(input: { host_id: string; path: string }) {
  return withFingerprint(() =>
    request<FileContentResponse>({
      path: "/api/files/content",
      query: input
    })
  );
}

export function writeFileContent(input: { host_id: string; path: string; content: string }) {
  return withFingerprint(() =>
    request<FileContentResponse>({
      method: "PUT",
      path: "/api/files/content",
      body: input
    })
  );
}

export function createDownloadTask(input: { host_id: string; source_path: string }) {
  return withFingerprint(() =>
    request<TransferTaskResponse>({
      method: "POST",
      path: "/api/files/download",
      body: input
    })
  );
}
