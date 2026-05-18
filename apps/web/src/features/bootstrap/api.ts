import { request } from "../../shared/api/http";
import type { BootstrapSetupInput, BootstrapSetupResponse, BootstrapStatus } from "./types";

export function getBootstrapStatus() {
  return request<BootstrapStatus>({
    path: "/api/bootstrap/status",
    skipAuthRefresh: true
  });
}

export function setupBootstrap(input: BootstrapSetupInput) {
  return request<BootstrapSetupResponse>({
    method: "POST",
    path: "/api/bootstrap/setup",
    body: input,
    skipAuthRefresh: true
  });
}
