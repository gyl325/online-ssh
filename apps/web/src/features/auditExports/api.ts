import { request, requestBlob } from "../../shared/api/http";
import type { AuditExportTaskListResponse, AuditExportTaskResponse, CreateAuditExportInput } from "./types";

export function createAuditExport(input: CreateAuditExportInput) {
  return request<AuditExportTaskResponse>({
    method: "POST",
    path: "/api/audit/exports",
    body: input
  });
}

export function listAuditExports(input?: { page?: number; page_size?: number }) {
  return request<AuditExportTaskListResponse>({
    path: "/api/audit/exports",
    query: input
  });
}

export function getAuditExport(exportId: string) {
  return request<AuditExportTaskResponse>({
    path: `/api/audit/exports/${exportId}`
  });
}

export function downloadAuditExport(exportId: string) {
  return requestBlob({ path: `/api/audit/exports/${exportId}/download` });
}

export function cancelAuditExport(exportId: string) {
  return request<AuditExportTaskResponse>({
    method: "POST",
    path: `/api/audit/exports/${exportId}/cancel`
  });
}

export function deleteAuditExport(exportId: string) {
  return request<void>({
    method: "DELETE",
    path: `/api/audit/exports/${exportId}`,
    responseType: "void"
  });
}
