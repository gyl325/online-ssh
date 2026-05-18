import { request } from "../../shared/api/http";
import type { QuickConnectInput, QuickConnectResponse, TemporaryConnectionInput, TemporaryConnectionResponse } from "./types";

export function quickConnect(input: QuickConnectInput) {
  return request<QuickConnectResponse>({
    method: "POST",
    path: "/api/connections/quick-connect",
    body: input
  });
}

export function createTemporaryConnection(input: TemporaryConnectionInput) {
  return request<TemporaryConnectionResponse>({
    method: "POST",
    path: "/api/connections/temporary",
    body: input
  });
}
