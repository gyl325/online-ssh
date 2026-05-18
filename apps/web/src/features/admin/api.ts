import { request, requestBlob } from "../../shared/api/http";
import type {
  AdminGeneralSettings,
  AdminGeneralSettingsLlmTestResponse,
  AdminGeneralSettingsResponse,
  AdminGeneralSettingsTestEmailResponse,
  AdminGeneralSettingsUpdate,
  AdminRole,
  AdminRoleResponse,
  AdminRolesResponse,
  AdminDatabaseImportResult,
  AdminRevokedSessionsResponse,
  AdminSessionsResponse,
  AdminUserMfaStatus,
  AdminUserRoleResponse,
  AdminUserStatusResult,
  AdminUsersResponse
} from "./types";

export function listAdminUsers() {
  return request<AdminUsersResponse>({
    path: "/api/admin/users"
  });
}

export function listAdminSessions() {
  return request<AdminSessionsResponse>({
    path: "/api/admin/sessions"
  });
}

export function listAdminRoles() {
  return request<AdminRolesResponse>({
    path: "/api/admin/roles"
  });
}

export function createAdminRole(role: AdminRole) {
  return request<AdminRoleResponse>({
    method: "POST",
    path: "/api/admin/roles",
    body: role
  });
}

export function updateAdminRole(roleKey: string, role: AdminRole) {
  return request<AdminRoleResponse>({
    method: "PATCH",
    path: `/api/admin/roles/${roleKey}`,
    body: role
  });
}

export function deleteAdminRole(roleKey: string) {
  return request<void>({
    method: "DELETE",
    path: `/api/admin/roles/${roleKey}`,
    responseType: "void"
  });
}

export function updateAdminUserStatus(userId: string, status: "active" | "disabled") {
  return request<AdminUserStatusResult>({
    method: "PATCH",
    path: `/api/admin/users/${userId}/status`,
    body: { status }
  });
}

export function updateAdminUserRole(userId: string, role: string) {
  return request<AdminUserRoleResponse>({
    method: "PATCH",
    path: `/api/admin/users/${userId}/role`,
    body: { role }
  });
}

export function deleteAdminUser(userId: string) {
  return request<void>({
    method: "DELETE",
    path: `/api/admin/users/${userId}`,
    responseType: "void"
  });
}

export function revokeAdminSession(sessionId: string) {
  return request<void>({
    method: "POST",
    path: `/api/admin/sessions/${sessionId}/revoke`,
    responseType: "void"
  });
}

export function revokeAdminUserSessions(userId: string) {
  return request<AdminRevokedSessionsResponse>({
    method: "POST",
    path: `/api/admin/users/${userId}/sessions/revoke`
  });
}

export function getAdminUserMfa(userId: string) {
  return request<AdminUserMfaStatus>({
    path: `/api/admin/users/${userId}/mfa`
  });
}

export function resetAdminUserMfa(userId: string) {
  return request<void>({
    method: "POST",
    path: `/api/admin/users/${userId}/mfa/reset`,
    responseType: "void"
  });
}

export function getAdminGeneralSettings() {
  return request<AdminGeneralSettingsResponse>({
    path: "/api/admin/settings/general"
  });
}

export function updateAdminGeneralSettings(settings: AdminGeneralSettingsUpdate) {
  return request<AdminGeneralSettingsResponse>({
    method: "PATCH",
    path: "/api/admin/settings/general",
    body: settings
  });
}

export function sendAdminGeneralSettingsTestEmail(to: string, settings?: Partial<AdminGeneralSettingsUpdate>) {
  return request<AdminGeneralSettingsTestEmailResponse>({
    method: "POST",
    path: "/api/admin/settings/general/test-email",
    body: { ...settings, to }
  });
}

export function testAdminGeneralSettingsLlm(settings: Partial<AdminGeneralSettingsUpdate>) {
  return request<AdminGeneralSettingsLlmTestResponse>({
    method: "POST",
    path: "/api/admin/settings/general/test-llm",
    body: settings
  });
}

export function exportAdminDatabase() {
  return requestBlob({ path: "/api/admin/database/export" });
}

export function importAdminDatabase(file: File) {
  return request<AdminDatabaseImportResult>({
    method: "POST",
    path: "/api/admin/database/import",
    body: file,
    bodyType: "raw",
    headers: {
      "Content-Type": file.type || "application/json"
    }
  });
}
