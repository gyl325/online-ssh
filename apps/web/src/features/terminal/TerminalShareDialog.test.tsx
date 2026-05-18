import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  defaultTerminalShareForm,
  TerminalShareDialog,
  type TerminalShareForm
} from "./TerminalShareDialog";
import type { TerminalShare, TerminalShareAccessLog } from "./types";

const labels: Record<string, string> = {
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.loading": "Loading...",
  "common.saving": "Saving...",
  "auth.showPassword": "Show password",
  "auth.hidePassword": "Hide password",
  "terminal.share.title": "Share terminal",
  "terminal.share.menuManage": "Sharing",
  "terminal.share.refreshStatus": "Refresh share status",
  "terminal.share.expiresInMinutes": "Expires in minutes",
  "terminal.share.accessLimit": "Access limit",
  "terminal.share.password": "Password (optional)",
  "terminal.share.sensitivePrompt": "Description: visible to viewers",
  "terminal.share.createWarning": "While sharing, information you type, terminal content, and command output may contain sensitive data. Use terminal sharing carefully.",
  "terminal.share.remaining": "{{time}} left",
  "terminal.share.create": "Create share",
  "terminal.share.viewers": "{{count}} viewers",
  "terminal.share.accessUsage": "{{count}} / {{limit}} accesses",
  "terminal.share.accessUnlimited": "{{count}} accesses",
  "terminal.share.copyLink": "Copy link",
  "terminal.share.linkUnavailable": "Share link is temporarily unavailable. Refresh the share status.",
  "terminal.share.extend": "Extend 10 minutes",
  "terminal.share.revoke": "Revoke share",
  "terminal.share.accessLogs": "Access logs",
  "terminal.share.noAccessLogs": "No access records yet.",
  "terminal.share.accessSuccess": "Access granted",
  "terminal.share.accessFailed": "Access failed",
  "terminal.share.accessInvalidPassword": "Invalid password",
  "terminal.share.accessLimitReached": "Access limit reached",
  "terminal.share.accessUnavailable": "Share unavailable",
  "terminal.share.passwordProtected": "Password protected",
  "terminal.share.noPassword": "No password"
};

function t(key: string, values?: Record<string, string | number>) {
  let template = labels[key] || key;
  Object.entries(values || {}).forEach(([name, value]) => {
    template = template.replaceAll(`{{${name}}}`, String(value));
  });
  return template;
}

function formatDateTime(value: string) {
  return `formatted ${value}`;
}

const activeShare: TerminalShare = {
  id: "share-1",
  terminal_session_id: "session-1",
  host_id: "host-1",
  expires_at: "2026-05-11T10:10:00.000Z",
  revoked_at: null,
  max_accesses: 5,
  access_count: 2,
  password_required: false,
  sensitive_prompt: "Sensitive production output",
  viewer_count: 3,
  url: "https://app.example.com/share/terminal/share-token"
};

const accessLogs: TerminalShareAccessLog[] = [
  {
    id: "log-1",
    share_id: "share-1",
    terminal_session_id: "session-1",
    result: "success",
    failure_reason: null,
    accessed_at: "2026-05-11T10:01:00.000Z"
  },
  {
    id: "log-2",
    share_id: "share-1",
    terminal_session_id: "session-1",
    result: "failure",
    failure_reason: "invalid_password",
    accessed_at: "2026-05-11T10:02:00.000Z"
  }
];

function CreateDialogHarness({
  onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault())
}: {
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [form, setForm] = useState<TerminalShareForm>({ ...defaultTerminalShareForm });

  return (
    <TerminalShareDialog
      accessLogs={[]}
      description="Prod SSH"
      fieldErrors={{}}
      finalMinute={false}
      form={form}
      formatDateTime={formatDateTime}
      logsLoading={false}
      onClose={vi.fn()}
      onCopyLink={vi.fn()}
      onCreate={onSubmit}
      onExtend={vi.fn()}
      onFormFieldChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))}
      onRefresh={vi.fn()}
      onRevoke={vi.fn()}
      open
      remainingText=""
      share={null}
      submitting={false}
      t={t}
    />
  );
}

describe("TerminalShareDialog", () => {
  it("renders active share details and delegates management actions", async () => {
    const user = userEvent.setup();
    const onCopyLink = vi.fn();
    const onExtend = vi.fn();
    const onRefresh = vi.fn();
    const onRevoke = vi.fn();

    render(
      <TerminalShareDialog
        accessLogs={accessLogs}
        description="Prod SSH"
        fieldErrors={{}}
        finalMinute={false}
        form={{ ...defaultTerminalShareForm }}
        formatDateTime={formatDateTime}
        logsLoading={false}
        onClose={vi.fn()}
        onCopyLink={onCopyLink}
        onCreate={vi.fn()}
        onExtend={onExtend}
        onFormFieldChange={vi.fn()}
        onRefresh={onRefresh}
        onRevoke={onRevoke}
        open
        remainingText="10m left"
        share={activeShare}
        submitting={false}
        t={t}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Share terminal" });
    expect(within(dialog).getByText("Sharing")).toBeInTheDocument();
    expect(within(dialog).getByText("No password")).toBeInTheDocument();
    expect(within(dialog).getByText("10m left")).toBeInTheDocument();
    expect(within(dialog).getByText("3 viewers")).toBeInTheDocument();
    expect(within(dialog).getByText("2 / 5 accesses")).toBeInTheDocument();
    expect(within(dialog).getByText("Sensitive production output")).toBeInTheDocument();
    expect(within(dialog).getByText("Access granted")).toBeInTheDocument();
    expect(within(dialog).getByText("Invalid password")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Refresh share status" }));
    await user.click(within(dialog).getByRole("button", { name: "Copy link" }));
    await user.click(within(dialog).getByRole("button", { name: "Extend 10 minutes" }));
    await user.click(within(dialog).getByRole("button", { name: "Revoke share" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onCopyLink).toHaveBeenCalledWith(activeShare.url);
    expect(onExtend).toHaveBeenCalledWith(activeShare, 10);
    expect(onRevoke).toHaveBeenCalledWith(activeShare);
  });

  it("uses shared UI primitives for active share status, metrics, and sensitive notes", () => {
    render(
      <TerminalShareDialog
        accessLogs={accessLogs}
        description="Prod SSH"
        fieldErrors={{}}
        finalMinute
        form={{ ...defaultTerminalShareForm }}
        formatDateTime={formatDateTime}
        logsLoading={false}
        onClose={vi.fn()}
        onCopyLink={vi.fn()}
        onCreate={vi.fn()}
        onExtend={vi.fn()}
        onFormFieldChange={vi.fn()}
        onRefresh={vi.fn()}
        onRevoke={vi.fn()}
        open
        remainingText="45s left"
        share={activeShare}
        submitting={false}
        t={t}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Share terminal" });
    const sharingBadge = within(dialog).getByText("Sharing").closest(".ui-badge");
    const passwordBadge = within(dialog).getByText("No password").closest(".ui-badge");
    const countdownBadge = within(dialog).getByText("45s left").closest(".ui-badge");
    const viewerMetric = within(dialog).getByText("3 viewers").closest(".ui-card");
    const expiryMetric = within(dialog).getByText("formatted 2026-05-11T10:10:00.000Z").closest(".ui-card");
    const accessMetric = within(dialog).getByText("2 / 5 accesses").closest(".ui-card");
    const sensitiveNote = within(dialog).getByText("Sensitive production output").closest(".ui-inline-note");

    expect(sharingBadge).toHaveClass("ui-badge-info");
    expect(passwordBadge).toHaveClass("ui-badge-neutral");
    expect(countdownBadge).toHaveClass("ui-badge-danger");
    expect(viewerMetric).not.toBeNull();
    expect(expiryMetric).not.toBeNull();
    expect(accessMetric).not.toBeNull();
    expect(sensitiveNote).toHaveClass("ui-inline-note-warning");

    expect(within(dialog).getByText("Sharing").closest(".terminal-share-dialog-status")).toBeNull();
    expect(within(dialog).getByText("3 viewers").closest(".terminal-share-metric")).toBeNull();
    expect(within(dialog).getByText("Sensitive production output").closest(".terminal-share-sensitive")).toBeNull();
  });

  it("renders the create form and clamps numeric inputs at the dialog boundary", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    render(<CreateDialogHarness onSubmit={onSubmit} />);

    const dialog = screen.getByRole("dialog", { name: "Share terminal" });
    await user.clear(within(dialog).getByLabelText("Expires in minutes"));
    await user.type(within(dialog).getByLabelText("Expires in minutes"), "1");
    expect(within(dialog).getByLabelText("Expires in minutes")).toHaveValue("2");

    await user.clear(within(dialog).getByLabelText("Access limit"));
    await user.type(within(dialog).getByLabelText("Access limit"), "8000");
    expect(within(dialog).getByLabelText("Access limit")).toHaveValue("1000");

    await user.click(within(dialog).getByRole("button", { name: "Create share" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("uses the shared eye-icon control for optional share passwords", async () => {
    const user = userEvent.setup();
    render(<CreateDialogHarness />);

    const dialog = screen.getByRole("dialog", { name: "Share terminal" });
    const passwordInput = within(dialog).getByLabelText("Password (optional)") as HTMLInputElement;
    const revealButton = within(dialog).getByRole("button", { name: "Show password" });

    expect(passwordInput.type).toBe("password");
    expect(revealButton).toHaveClass("auth-password-toggle");
    expect(revealButton).toHaveTextContent("");
    expect(revealButton.querySelector(".lucide-eye")).not.toBeNull();

    await user.click(revealButton);

    expect(passwordInput.type).toBe("text");
    expect(within(dialog).getByRole("button", { name: "Hide password" })).toBeInTheDocument();
  });

  it("uses a shared warning note for the create-form sensitive-data prompt", () => {
    render(<CreateDialogHarness />);

    const dialog = screen.getByRole("dialog", { name: "Share terminal" });
    const warning = within(dialog).getByText(/information you type/i);

    expect(warning.closest(".ui-inline-note")).toHaveClass("ui-inline-note-warning");
    expect(warning.closest(".terminal-share-create-warning")).toBeNull();
  });
});
