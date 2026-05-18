import confirmDialogContextSource from "./ConfirmDialogContext.tsx?raw";
import fingerprintDialogContextSource from "../fingerprint/FingerprintDialogContext.tsx?raw";
import { describe, expect, it } from "vitest";

describe("global dialog provider bundle boundary", () => {
  it("does not statically import dialog UI into the app entry providers", () => {
    expect(confirmDialogContextSource).not.toContain("../../shared/ui");
    expect(fingerprintDialogContextSource).not.toContain("../../shared/ui");
  });
});
