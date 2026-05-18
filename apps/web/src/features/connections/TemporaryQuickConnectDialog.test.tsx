import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithPreferences } from "../../test/renderWithProviders";
import { listCredentials } from "../credentials/api";
import { TemporaryQuickConnectDialog } from "./TemporaryQuickConnectDialog";

vi.mock("../credentials/api", () => ({
  listCredentials: vi.fn()
}));

const listCredentialsMock = vi.mocked(listCredentials);

function renderDialog(props?: Partial<ComponentProps<typeof TemporaryQuickConnectDialog>>) {
  return renderWithPreferences(
    <TemporaryQuickConnectDialog
      onConnectFiles={vi.fn()}
      onConnectTerminal={vi.fn()}
      onOpenChange={vi.fn()}
      onTestConnection={vi.fn()}
      open
      {...props}
    />
  );
}

describe("TemporaryQuickConnectDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCredentialsMock.mockResolvedValue({
      items: [],
      page: 1,
      page_size: 100,
      total: 0
    });
  });

  it("shows connection test failures through toast only", async () => {
    const user = userEvent.setup();
    const onTestConnection = vi.fn().mockRejectedValue(new Error("SSH authentication failed"));
    renderDialog({ onTestConnection });

    await waitFor(() => expect(listCredentialsMock).toHaveBeenCalled());
    const dialog = await screen.findByRole("dialog", { name: "Quick connect" });
    await user.type(within(dialog).getByLabelText("Host address"), "203.0.113.227");
    await user.type(within(dialog).getByLabelText("Username"), "gyl");
    await user.type(within(dialog).getByLabelText("SSH password"), "wrong-password");
    await user.click(within(dialog).getByRole("button", { name: "Test connection" }));

    const friendlyMessage = "SSH authentication failed. Check the username, password, or key.";
    expect(await screen.findByText(friendlyMessage, { selector: ".toast-content p" })).toBeInTheDocument();
    expect(within(dialog).queryByText(friendlyMessage)).not.toBeInTheDocument();
    expect(within(dialog).queryByText("SSH authentication failed")).not.toBeInTheDocument();
  });

  it("uses the shared eye-icon password controls", async () => {
    const user = userEvent.setup();
    renderDialog();

    await waitFor(() => expect(listCredentialsMock).toHaveBeenCalled());
    const dialog = await screen.findByRole("dialog", { name: "Quick connect" });
    const passwordInput = within(dialog).getByLabelText("SSH password") as HTMLInputElement;
    const revealButton = within(dialog).getByRole("button", { name: "Show password" });

    expect(passwordInput.type).toBe("password");
    expect(revealButton).toHaveClass("auth-password-toggle");
    expect(revealButton).toHaveTextContent("");
    expect(revealButton.querySelector(".lucide-eye")).not.toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();

    await user.click(revealButton);

    expect(passwordInput.type).toBe("text");
    expect(within(dialog).getByRole("button", { name: "Hide password" })).toBeInTheDocument();
  });

  it("shows temporary connect failures through toast only", async () => {
    const user = userEvent.setup();
    const onConnectTerminal = vi.fn().mockRejectedValue(new Error("TCP connection refused"));
    renderDialog({ onConnectTerminal });

    await waitFor(() => expect(listCredentialsMock).toHaveBeenCalled());
    const dialog = await screen.findByRole("dialog", { name: "Quick connect" });
    await user.type(within(dialog).getByLabelText("Host address"), "203.0.113.227");
    await user.type(within(dialog).getByLabelText("Username"), "gyl");
    await user.type(within(dialog).getByLabelText("SSH password"), "wrong-password");
    await user.click(within(dialog).getByRole("button", { name: "Connect to terminal" }));

    const friendlyMessage = "The target host refused the connection. Check that SSH is running and the port is correct.";
    expect(await screen.findByText(friendlyMessage, { selector: ".toast-content p" })).toBeInTheDocument();
    expect(within(dialog).queryByText(friendlyMessage)).not.toBeInTheDocument();
    expect(within(dialog).queryByText("TCP connection refused")).not.toBeInTheDocument();
  });
});
