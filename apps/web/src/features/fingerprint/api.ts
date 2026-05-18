import { request } from "../../shared/api/http";
import type { HostFingerprint } from "../hosts/types";

type ConfirmFingerprintResponse = {
  fingerprint: HostFingerprint;
};

export function confirmHostFingerprint(hostId: string, input: { algorithm: string; fingerprint: string }) {
  return request<ConfirmFingerprintResponse>({
    method: "POST",
    path: `/api/hosts/${hostId}/fingerprint/confirm`,
    body: input
  });
}
