import { HttpError } from "../../shared/api/http";
import type { HostFingerprintConflictResponse } from "../hosts/types";

export type FingerprintCallResult<T> =
  | { kind: "success"; data: T }
  | { kind: "fingerprint_conflict"; data: HostFingerprintConflictResponse };

export async function withFingerprintConflict<T>(runner: () => Promise<T>): Promise<FingerprintCallResult<T>> {
  try {
    const data = await runner();
    return { kind: "success", data };
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) {
      return {
        kind: "fingerprint_conflict",
        data: error.payload as HostFingerprintConflictResponse
      };
    }

    throw error;
  }
}
