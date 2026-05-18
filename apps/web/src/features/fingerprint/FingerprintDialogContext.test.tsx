import { useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithPreferences } from "../../test/renderWithProviders";
import { FingerprintDialogProvider, useFingerprintDialog } from "./FingerprintDialogContext";
import { confirmHostFingerprint } from "./api";

vi.mock("./api", () => ({
  confirmHostFingerprint: vi.fn()
}));

const confirmHostFingerprintMock = vi.mocked(confirmHostFingerprint);

function FingerprintDialogHarness() {
  const dialog = useFingerprintDialog();
  const [result, setResult] = useState<string>("pending");

  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          const confirmed = await dialog.requestConfirmation({
            hostId: "host-1",
            hostLabel: "Prod SSH",
            actionLabel: "测试主机连接",
            conflict: {
              code: "HOST_FINGERPRINT_CONFLICT",
              message: "fingerprint changed",
              current_fingerprint: {
                algorithm: "ssh-ed25519",
                fingerprint: "SHA256:current-fingerprint",
                status: "changed",
                first_seen_at: "2026-04-24T10:00:00Z",
                last_verified_at: "2026-04-24T11:00:00Z"
              },
              previous_fingerprint: {
                algorithm: "ssh-rsa",
                fingerprint: "SHA256:previous-fingerprint",
                status: "trusted"
              }
            }
          });
          setResult(confirmed ? "confirmed" : "cancelled");
        }}
      >
        Open Fingerprint Dialog
      </button>
      <output data-testid="dialog-result">{result}</output>
    </div>
  );
}

function renderFingerprintDialogHarness() {
  return renderWithPreferences(
    <FingerprintDialogProvider>
      <FingerprintDialogHarness />
    </FingerprintDialogProvider>
  );
}

describe("FingerprintDialogProvider", () => {
  beforeEach(() => {
    confirmHostFingerprintMock.mockReset();
  });

  it("opens the dialog and resolves false when the user cancels", async () => {
    const user = userEvent.setup();
    renderFingerprintDialogHarness();

    await user.click(screen.getByRole("button", { name: "Open Fingerprint Dialog" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /host fingerprint confirmation required|需要确认主机指纹/i })).toBeInTheDocument();
    expect(screen.getByText("fingerprint changed")).toBeInTheDocument();
    expect(screen.getByText("ssh-rsa / SHA256:previous-fingerprint")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel and stop|取消并中止/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("dialog-result")).toHaveTextContent("cancelled");
    expect(confirmHostFingerprintMock).not.toHaveBeenCalled();
  });

  it("keeps the confirmation notes in the dialog description instead of a bottom note card", async () => {
    const user = userEvent.setup();
    renderFingerprintDialogHarness();

    await user.click(screen.getByRole("button", { name: "Open Fingerprint Dialog" }));

    const dialog = await screen.findByRole("dialog");
    const description = dialog.querySelector(".ui-dialog-description");

    expect(description).toHaveTextContent(/target action|目标操作/i);
    expect(description).toHaveTextContent(/after confirmation|确认后/i);
    expect(description).toHaveTextContent(/if canceled|如果取消/i);
    expect(dialog.querySelector(".inline-note")).not.toBeInTheDocument();
  });

  it("confirms the fingerprint, calls the api, and resolves true", async () => {
    const user = userEvent.setup();
    confirmHostFingerprintMock.mockResolvedValueOnce({
      fingerprint: {
        algorithm: "ssh-ed25519",
        fingerprint: "SHA256:current-fingerprint",
        status: "trusted"
      }
    });

    renderFingerprintDialogHarness();

    await user.click(screen.getByRole("button", { name: "Open Fingerprint Dialog" }));
    await user.click(screen.getByRole("button", { name: /confirm fingerprint and continue|确认 fingerprint 并继续/i }));

    expect(confirmHostFingerprintMock).toHaveBeenCalledWith("host-1", {
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:current-fingerprint"
    });
    expect(await screen.findByTestId("dialog-result")).toHaveTextContent("confirmed");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows an error and keeps the dialog open when confirmation fails", async () => {
    const user = userEvent.setup();
    confirmHostFingerprintMock.mockRejectedValueOnce(new Error("confirm failed"));

    renderFingerprintDialogHarness();

    await user.click(screen.getByRole("button", { name: "Open Fingerprint Dialog" }));
    await user.click(screen.getByRole("button", { name: /confirm fingerprint and continue|确认 fingerprint 并继续/i }));

    expect(await screen.findByText("confirm failed")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("dialog-result")).toHaveTextContent("pending");

    await user.click(screen.getByRole("button", { name: /cancel and stop|取消并中止/i }));
    expect(screen.getByTestId("dialog-result")).toHaveTextContent("cancelled");
  });
});
