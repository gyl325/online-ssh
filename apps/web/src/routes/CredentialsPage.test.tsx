import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithPageProviders } from "../test/renderWithProviders";
import { selectInputOption } from "../test/selectInput";
import type { Credential, CredentialListResponse, CredentialResponse } from "../features/credentials/types";
import * as credentialApi from "../features/credentials/api";
import { HttpError } from "../shared/api/http";
import { CredentialsPage, writeCredentialClipboardText } from "./CredentialsPage";

vi.mock("../features/credentials/api", () => ({
  createCredential: vi.fn(),
  deleteCredential: vi.fn(),
  generateCredentialKeyPair: vi.fn(),
  getCredential: vi.fn(),
  listCredentials: vi.fn(),
  updateCredential: vi.fn()
}));

const createCredentialMock = vi.mocked(credentialApi.createCredential);
const deleteCredentialMock = vi.mocked(credentialApi.deleteCredential);
const generateCredentialKeyPairMock = vi.mocked(credentialApi.generateCredentialKeyPair);
const getCredentialMock = vi.mocked(credentialApi.getCredential);
const listCredentialsMock = vi.mocked(credentialApi.listCredentials);
const updateCredentialMock = vi.mocked(credentialApi.updateCredential);

const baseCredential: Credential = {
  id: "cred-1",
  name: "Deploy Key",
  auth_type: "private_key",
  has_secret: false,
  has_private_key: true,
  has_passphrase: true,
  key_version: "1",
  is_default: false,
  created_at: "2026-04-24T00:00:00Z",
  updated_at: "2026-04-24T01:00:00Z"
};

const passwordCredential: Credential = {
  id: "cred-2",
  name: "Password Login",
  auth_type: "password",
  has_secret: true,
  has_private_key: false,
  has_passphrase: false,
  key_version: "1",
  is_default: false,
  created_at: "2026-04-24T00:00:00Z",
  updated_at: "2026-04-24T01:00:00Z"
};

function listResponse(items: Credential[]): CredentialListResponse {
  return {
    items,
    page: 1,
    page_size: 100,
    total: items.length
  };
}

function credentialResponse(credential: Credential): CredentialResponse {
  return { credential };
}

function mockClipboardEventCopy() {
  const setClipboardData = vi.fn();
  const execCommand = vi.fn((command: string) => {
    if (command !== "copy") {
      return false;
    }
    const event = new Event("copy") as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      configurable: true,
      value: {
        setData: setClipboardData
      }
    });
    document.dispatchEvent(event);
    return true;
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand
  });
  return { execCommand, setClipboardData };
}

describe("CredentialsPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn() }
    });
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: navigator.clipboard
    });
  });

  it("exposes the credential list loading state as a status", () => {
    listCredentialsMock.mockReturnValue(new Promise(() => {}) as Promise<CredentialListResponse>);

    renderWithPageProviders(<CredentialsPage />);

    expect(screen.getByRole("status", { name: "Loading credentials..." })).toBeInTheDocument();
  });

  it("labels credential cards for assistive technology", async () => {
    listCredentialsMock.mockResolvedValue(listResponse([baseCredential]));

    renderWithPageProviders(<CredentialsPage />);

    const card = await screen.findByRole("article", { name: "Deploy Key" });

    expect(within(card).getByRole("button", { name: "Edit credential" })).toBeInTheDocument();
  });

  it("shows a permission-specific message when credential loading is forbidden", async () => {
    listCredentialsMock.mockRejectedValue(
      new HttpError(403, { code: "FORBIDDEN", message: "permission required" })
    );

    renderWithPageProviders(<CredentialsPage />);

    expect(await screen.findByText("You do not have permission to perform this action.")).toBeInTheDocument();
    expect(screen.queryByText("Failed to load credentials.")).not.toBeInTheDocument();
  });

  it("creates a password credential and refreshes the list", async () => {
    listCredentialsMock
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce(listResponse([passwordCredential]));
    createCredentialMock.mockResolvedValue(credentialResponse(passwordCredential));

    const user = userEvent.setup();
    renderWithPageProviders(<CredentialsPage />);

    await screen.findByText("No credentials match the current filter.");
    await user.click(screen.getByRole("button", { name: "New credential" }));

    await user.type(screen.getByLabelText("Name"), "Password Login");
    await user.type(screen.getAllByLabelText("SSH password")[0], "secret-password");
    await user.click(screen.getByRole("button", { name: "Create credential" }));

    await waitFor(() =>
      expect(createCredentialMock).toHaveBeenCalledWith({
        name: "Password Login",
        auth_type: "password",
        password: "secret-password"
      })
    );
    await waitFor(() => expect(listCredentialsMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Credential created.")).toBeInTheDocument();
    expect(screen.getByText("Password Login")).toBeInTheDocument();
  });

  it("creates a private key credential and refreshes the list", async () => {
    const privateKeyCredential = { ...baseCredential, name: "Deploy Key" };
    listCredentialsMock
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce(listResponse([privateKeyCredential]));
    createCredentialMock.mockResolvedValue(credentialResponse(privateKeyCredential));

    const user = userEvent.setup();
    renderWithPageProviders(<CredentialsPage />);

    await screen.findByText("No credentials match the current filter.");
    await user.click(screen.getByRole("button", { name: "New credential" }));
    await user.click(screen.getByRole("button", { name: "Private key auth" }));

    await user.type(screen.getByLabelText("Name"), "Deploy Key");
    await user.type(screen.getByLabelText("Private key content"), "-----BEGIN TEST OPENSSH PRIVATE KEY-----");
    await user.type(screen.getByLabelText("Passphrase (optional)"), "key-passphrase");
    await user.click(screen.getByRole("button", { name: "Create credential" }));

    await waitFor(() =>
      expect(createCredentialMock).toHaveBeenCalledWith({
        name: "Deploy Key",
        auth_type: "private_key",
        private_key: "-----BEGIN TEST OPENSSH PRIVATE KEY-----",
        passphrase: "key-passphrase"
      })
    );
    await waitFor(() => expect(listCredentialsMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Credential created.")).toBeInTheDocument();
    expect(screen.getByText("Deploy Key")).toBeInTheDocument();
  });

  it("loads a private key credential from an uploaded file", async () => {
    const privateKeyCredential = { ...baseCredential, name: "Uploaded Key" };
    listCredentialsMock
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce(listResponse([privateKeyCredential]));
    createCredentialMock.mockResolvedValue(credentialResponse(privateKeyCredential));

    const user = userEvent.setup();
    renderWithPageProviders(<CredentialsPage />);

    await screen.findByText("No credentials match the current filter.");
    await user.click(screen.getByRole("button", { name: "New credential" }));
    await user.click(screen.getByRole("button", { name: "Private key auth" }));

    const uploadedKey = "-----BEGIN TEST OPENSSH PRIVATE KEY-----\nuploaded\n-----END TEST OPENSSH PRIVATE KEY-----\n";
    await user.upload(
      screen.getByLabelText("Upload private key file"),
      new File([uploadedKey], "id_ed25519.pem", { type: "text/plain" })
    );
    await waitFor(() => expect(screen.getByLabelText("Private key content")).toHaveValue(uploadedKey));
    await user.type(screen.getByLabelText("Name"), "Uploaded Key");
    await user.click(screen.getByRole("button", { name: "Create credential" }));

    await waitFor(() =>
      expect(createCredentialMock).toHaveBeenCalledWith({
        name: "Uploaded Key",
        auth_type: "private_key",
        private_key: uploadedKey
      })
    );
    expect(await screen.findByText("Private key file loaded: id_ed25519.pem.")).toBeInTheDocument();
  });

  it("orders private key creation controls for generation, upload, then manual paste", async () => {
    listCredentialsMock.mockResolvedValue(listResponse([]));

    const user = userEvent.setup();
    renderWithPageProviders(<CredentialsPage />);

    await screen.findByText("No credentials match the current filter.");
    await user.click(screen.getByRole("button", { name: "New credential" }));
    await user.click(screen.getByRole("button", { name: "Private key auth" }));

    const generator = screen.getByRole("region", { name: "Generate SSH key pair" });
    const uploadButton = screen.getByRole("button", { name: "Upload private key file" });
    const privateKeyInput = screen.getByLabelText("Private key content");
    expect(generator.compareDocumentPosition(uploadButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(uploadButton.compareDocumentPosition(privateKeyInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter your username")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Paste your private key here...")).toBeInTheDocument();
  });

  it("generates a key pair and shows the deployment command", async () => {
    const generatedCredential = { ...baseCredential, name: "Generated Key" };
    const generatedPrivateKey = "-----BEGIN TEST OPENSSH PRIVATE KEY-----\nmock\n-----END TEST OPENSSH PRIVATE KEY-----\n";
    listCredentialsMock
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce(listResponse([generatedCredential]));
    generateCredentialKeyPairMock.mockResolvedValue({
      key_pair: {
        algorithm: "rsa",
        private_key: generatedPrivateKey,
        public_key: "ssh-rsa AAAATEST generated@test",
        authorized_key_line: "ssh-rsa AAAATEST generated@test",
        deploy_command: "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo 'ssh-rsa AAAATEST generated@test' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
      }
    });
    createCredentialMock.mockResolvedValue(credentialResponse(generatedCredential));

    const user = userEvent.setup();
    renderWithPageProviders(<CredentialsPage />);

    await screen.findByText("No credentials match the current filter.");
    await user.click(screen.getByRole("button", { name: "New credential" }));
    await user.click(screen.getByRole("button", { name: "Private key auth" }));

    await selectInputOption(user, screen.getByRole("combobox", { name: "Key type" }), "rsa");
    await user.type(screen.getByLabelText("Deployment command comment"), "deploy user");
    await user.click(screen.getByRole("button", { name: "Generate key pair" }));

    await waitFor(() =>
      expect(generateCredentialKeyPairMock).toHaveBeenCalledWith({
        algorithm: "rsa",
        comment: "deploy user"
      })
    );
    const command = "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo 'ssh-rsa AAAATEST deploy_user' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys";
    expect(await screen.findByText(command)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Name"), "Generated Key");
    await user.click(screen.getByRole("button", { name: "Create credential" }));

    await waitFor(() =>
      expect(createCredentialMock).toHaveBeenCalledWith({
        name: "Generated Key",
        auth_type: "private_key",
        private_key: generatedPrivateKey
      })
    );
  });

  it("writes deployment commands to the browser clipboard", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn().mockReturnValue(false)
    });

    await expect(writeCredentialClipboardText("deploy command")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("deploy command");
  });

  it("falls back to the copy event when clipboard writeText is unavailable", async () => {
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: undefined
    });
    const { execCommand, setClipboardData } = mockClipboardEventCopy();

    await expect(writeCredentialClipboardText("deploy command")).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(setClipboardData).toHaveBeenCalledWith("text/plain", "deploy command");
  });

  it("falls back to the copy event when clipboard writeText rejects", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("clipboard denied"));
    const { execCommand, setClipboardData } = mockClipboardEventCopy();

    await expect(writeCredentialClipboardText("deploy command")).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(setClipboardData).toHaveBeenCalledWith("text/plain", "deploy command");
  });

  it("updates only the credential name when sensitive edit toggles stay off", async () => {
    const renamedCredential = { ...baseCredential, name: "Deploy Key Renamed" };
    listCredentialsMock
      .mockResolvedValueOnce(listResponse([baseCredential]))
      .mockResolvedValueOnce(listResponse([renamedCredential]));
    getCredentialMock.mockResolvedValue(credentialResponse(baseCredential));
    updateCredentialMock.mockResolvedValue(credentialResponse(renamedCredential));

    const user = userEvent.setup();
    renderWithPageProviders(<CredentialsPage />);

    const card = (await screen.findByText("Deploy Key")).closest("article");
    expect(card).not.toBeNull();
    await user.click(within(card as HTMLElement).getByRole("button", { name: "Edit credential" }));

    expect(await screen.findByRole("heading", { name: "Edit credential" })).toBeInTheDocument();
    const nameInput = screen.getByLabelText("Name");
    await user.clear(nameInput);
    await user.type(nameInput, "Deploy Key Renamed");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateCredentialMock).toHaveBeenCalledWith("cred-1", {
        name: "Deploy Key Renamed"
      })
    );
    expect(updateCredentialMock.mock.calls[0][1]).not.toHaveProperty("private_key");
    expect(updateCredentialMock.mock.calls[0][1]).not.toHaveProperty("passphrase");
    expect(await screen.findByText("Credential updated.")).toBeInTheDocument();
  });

  it("updates a private key credential from generated key material in edit mode", async () => {
    const updatedCredential = { ...baseCredential, name: "Deploy Key" };
    const generatedPrivateKey = "-----BEGIN TEST OPENSSH PRIVATE KEY-----\nedit\n-----END TEST OPENSSH PRIVATE KEY-----\n";
    listCredentialsMock
      .mockResolvedValueOnce(listResponse([baseCredential]))
      .mockResolvedValueOnce(listResponse([updatedCredential]));
    getCredentialMock.mockResolvedValue(credentialResponse(baseCredential));
    generateCredentialKeyPairMock.mockResolvedValue({
      key_pair: {
        algorithm: "ecdsa",
        private_key: generatedPrivateKey,
        public_key: "ecdsa-sha2-nistp256 AAAAEDIT generated@test",
        authorized_key_line: "ecdsa-sha2-nistp256 AAAAEDIT generated@test",
        deploy_command: "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo 'ecdsa-sha2-nistp256 AAAAEDIT generated@test' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
      }
    });
    updateCredentialMock.mockResolvedValue(credentialResponse(updatedCredential));

    const user = userEvent.setup();
    renderWithPageProviders(<CredentialsPage />);

    const card = (await screen.findByText("Deploy Key")).closest("article");
    expect(card).not.toBeNull();
    await user.click(within(card as HTMLElement).getByRole("button", { name: "Edit credential" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit credential" });
    await user.click(within(dialog).getByLabelText("Re-enter private key content"));
    expect(within(dialog).getByRole("region", { name: "Generate SSH key pair" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Upload private key file" })).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText("Paste your private key here...")).toBeInTheDocument();

    await selectInputOption(user, within(dialog).getByRole("combobox", { name: "Key type" }), "ecdsa");
    await user.type(within(dialog).getByLabelText("Deployment command comment"), "edit user");
    await user.click(within(dialog).getByRole("button", { name: "Generate key pair" }));

    await waitFor(() =>
      expect(generateCredentialKeyPairMock).toHaveBeenCalledWith({
        algorithm: "ecdsa",
        comment: "edit user"
      })
    );
    expect(await within(dialog).findByText("mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo 'ecdsa-sha2-nistp256 AAAAEDIT edit_user' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("New private key")).toHaveValue(generatedPrivateKey);

    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateCredentialMock).toHaveBeenCalledWith("cred-1", {
        name: "Deploy Key",
        private_key: generatedPrivateKey
      })
    );
  });

  it("updates a private key credential from an uploaded file in edit mode", async () => {
    const uploadedPrivateKey = "-----BEGIN TEST OPENSSH PRIVATE KEY-----\nuploaded-edit\n-----END TEST OPENSSH PRIVATE KEY-----\n";
    listCredentialsMock
      .mockResolvedValueOnce(listResponse([baseCredential]))
      .mockResolvedValueOnce(listResponse([baseCredential]));
    getCredentialMock.mockResolvedValue(credentialResponse(baseCredential));
    updateCredentialMock.mockResolvedValue(credentialResponse(baseCredential));

    const user = userEvent.setup();
    renderWithPageProviders(<CredentialsPage />);

    const card = (await screen.findByText("Deploy Key")).closest("article");
    expect(card).not.toBeNull();
    await user.click(within(card as HTMLElement).getByRole("button", { name: "Edit credential" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit credential" });
    await user.click(within(dialog).getByLabelText("Re-enter private key content"));
    await user.upload(
      within(dialog).getByLabelText("Upload private key file"),
      new File([uploadedPrivateKey], "edit_id_ed25519.pem", { type: "text/plain" })
    );

    await waitFor(() => expect(within(dialog).getByLabelText("New private key")).toHaveValue(uploadedPrivateKey));
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateCredentialMock).toHaveBeenCalledWith("cred-1", {
        name: "Deploy Key",
        private_key: uploadedPrivateKey
      })
    );
  });

  it("deletes a credential only after confirmation", async () => {
    listCredentialsMock
      .mockResolvedValueOnce(listResponse([baseCredential]))
      .mockResolvedValueOnce(listResponse([]));
    deleteCredentialMock.mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderWithPageProviders(<CredentialsPage />);

    const card = (await screen.findByText("Deploy Key")).closest("article");
    expect(card).not.toBeNull();
    await user.click(within(card as HTMLElement).getByRole("button", { name: "Delete credential" }));

    expect(await screen.findByRole("heading", { name: "Delete credential" })).toBeInTheDocument();
    expect(deleteCredentialMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteCredentialMock).toHaveBeenCalledWith("cred-1"));
    await waitFor(() => expect(listCredentialsMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Credential deleted.")).toBeInTheDocument();
  });
});
