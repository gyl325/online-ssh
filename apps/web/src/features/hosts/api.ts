import { request } from "../../shared/api/http";
import { withFingerprintConflict } from "../fingerprint/apiResult";
import type {
  CreateHostInput,
  HostGroupListResponse,
  HostGroupResponse,
  HostListResponse,
  HostMetricsResponse,
  HostResponse,
  SaveHostGroupInput,
  TestHostInput,
  TestHostResponse,
  UpdateHostInput
} from "./types";

export function listHosts(keyword?: string, favoriteOnly?: boolean, groupId?: string) {
  return request<HostListResponse>({
    path: "/api/hosts",
    query: {
      page: 1,
      page_size: 100,
      keyword: keyword || undefined,
      favorite_only: favoriteOnly ? true : undefined,
      group_id: groupId || undefined
    }
  });
}

export function listHostGroups() {
  return request<HostGroupListResponse>({
    path: "/api/host-groups"
  });
}

export function createHostGroup(input: SaveHostGroupInput) {
  return request<HostGroupResponse>({
    method: "POST",
    path: "/api/host-groups",
    body: input
  });
}

export function updateHostGroup(groupId: string, input: SaveHostGroupInput) {
  return request<HostGroupResponse>({
    method: "PUT",
    path: `/api/host-groups/${groupId}`,
    body: input
  });
}

export function deleteHostGroup(groupId: string) {
  return request<void>({
    method: "DELETE",
    path: `/api/host-groups/${groupId}`,
    responseType: "void"
  });
}

export function getHost(hostId: string) {
  return request<HostResponse>({
    path: `/api/hosts/${hostId}`
  });
}

export function getHostMetrics(hostId: string) {
  return request<HostMetricsResponse>({
    path: `/api/hosts/${hostId}/metrics`
  });
}

export function createHost(input: CreateHostInput) {
  return request<HostResponse>({
    method: "POST",
    path: "/api/hosts",
    body: input
  });
}

export function updateHost(hostId: string, input: UpdateHostInput) {
  return request<HostResponse>({
    method: "PUT",
    path: `/api/hosts/${hostId}`,
    body: input
  });
}

export function deleteHost(hostId: string) {
  return request<void>({
    method: "DELETE",
    path: `/api/hosts/${hostId}`,
    responseType: "void"
  });
}

export async function testHost(hostId: string, input?: TestHostInput) {
  return withFingerprintConflict(() =>
    request<TestHostResponse>({
      method: "POST",
      path: `/api/hosts/${hostId}/test`,
      body: input ?? {}
    })
  );
}
