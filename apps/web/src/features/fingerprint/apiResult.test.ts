import { describe, expect, it } from "vitest";

import { HttpError } from "../../shared/api/http";
import { withFingerprintConflict } from "./apiResult";

const fingerprintConflict = {
  code: "HOST_FINGERPRINT_CHANGED",
  message: "host fingerprint changed",
  current_fingerprint: {
    algorithm: "SHA256",
    fingerprint: "SHA256:new",
    ok: false,
    message: "changed"
  },
  previous_fingerprint: {
    algorithm: "SHA256",
    fingerprint: "SHA256:old",
    ok: true,
    message: "trusted"
  }
};

describe("withFingerprintConflict", () => {
  it("wraps successful responses", async () => {
    await expect(withFingerprintConflict(async () => ({ ok: true }))).resolves.toEqual({
      kind: "success",
      data: { ok: true }
    });
  });

  it("maps 409 http errors to fingerprint conflict results", async () => {
    await expect(withFingerprintConflict(async () => {
      throw new HttpError(409, fingerprintConflict);
    })).resolves.toEqual({
      kind: "fingerprint_conflict",
      data: fingerprintConflict
    });
  });

  it("rethrows non-fingerprint errors", async () => {
    const error = new HttpError(500, { code: "SERVER_ERROR", message: "server failed" });

    await expect(withFingerprintConflict(async () => {
      throw error;
    })).rejects.toBe(error);
  });
});
