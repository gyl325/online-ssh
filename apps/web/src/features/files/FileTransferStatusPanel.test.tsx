import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import { FileTransferStatusPanel } from "./FileTransferStatusPanel";

const labels: Record<string, string> = {
  "files.downloadProgress": "Download progress",
  "files.transferPanelActive": "Active transfer",
  "files.transferPanelEmpty": "No upload or download tasks.",
  "files.transferPanelIdle": "Idle",
  "files.transferPanelTitle": "Transfer queue",
  "files.uploadProgress": "Upload progress",
  "files.uploadQueueSummary": "{{count}} file(s)",
  "files.uploadQueueTitle": "Upload queue",
  "files.uploadStatus.completed": "Completed",
  "files.uploadStatus.failed": "Failed",
  "files.uploadStatus.queued": "Queued",
  "files.uploadStatus.uploading": "Uploading"
};

function t(key: string, values?: Record<string, string | number>) {
  let value = labels[key] || key;
  Object.entries(values || {}).forEach(([name, replacement]) => {
    value = value.replace(`{{${name}}}`, String(replacement));
  });
  return value;
}

function renderPanel(overrides: Partial<ComponentProps<typeof FileTransferStatusPanel>> = {}) {
  const props: ComponentProps<typeof FileTransferStatusPanel> = {
    activeTransfer: null,
    formatBytes: (bytes) => `${bytes} B`,
    t,
    uploadQueue: [],
    ...overrides
  };

  render(<FileTransferStatusPanel {...props} />);
  return props;
}

describe("FileTransferStatusPanel", () => {
  it("renders idle transfer panel copy when no transfer or queue exists", () => {
    renderPanel();

    const panel = screen.getByRole("region", { name: "Transfer queue" });
    expect(within(panel).getByText("Idle")).toBeInTheDocument();
    expect(within(panel).getByText("No upload or download tasks.")).toHaveClass("files-sidebar-empty");
  });

  it("renders active download progress with byte counts and status", () => {
    renderPanel({
      activeTransfer: {
        fileName: "backup.tar.gz",
        kind: "download",
        note: "Downloading remote file",
        status: "transferring",
        totalBytes: 200,
        transferredBytes: 50
      }
    });

    const panel = screen.getByRole("region", { name: "Transfer queue" });
    expect(within(panel).getByText("Active transfer")).toBeInTheDocument();
    expect(within(panel).getByText("Download progress")).toBeInTheDocument();
    expect(within(panel).getByText("25%")).toBeInTheDocument();
    expect(within(panel).getByText("backup.tar.gz")).toHaveClass("mono-wrap");
    expect(within(panel).getByText("50 B / 200 B")).toBeInTheDocument();
    expect(within(panel).getByText("transferring")).toBeInTheDocument();
    expect(within(panel).getByText("Downloading remote file")).toBeInTheDocument();

    const progress = within(panel).getByLabelText("Download progress");
    expect(progress).toHaveClass("files-transfer-progress-track");
    expect(progress).toHaveAttribute("aria-valuenow", "25");
  });

  it("renders active upload progress and clamps invalid totals to zero percent", () => {
    renderPanel({
      activeTransfer: {
        fileName: "empty.txt",
        kind: "upload",
        note: "Preparing upload",
        status: "preparing",
        totalBytes: 0,
        transferredBytes: 10
      }
    });

    const panel = screen.getByRole("region", { name: "Transfer queue" });
    expect(within(panel).getByText("Upload progress")).toBeInTheDocument();
    expect(within(panel).getByText("0%")).toBeInTheDocument();
    expect(within(panel).getByLabelText("Upload progress")).toHaveAttribute("aria-valuenow", "0");
  });

  it("renders upload queue rows with status classes, progress, and messages", () => {
    renderPanel({
      uploadQueue: [
        {
          fileName: "alpha.txt",
          id: "1",
          message: "Uploading chunks",
          status: "uploading",
          totalBytes: 20,
          transferredBytes: 5
        },
        {
          fileName: "beta.txt",
          id: "2",
          message: null,
          status: "completed",
          totalBytes: 10,
          transferredBytes: 10
        },
        {
          fileName: "gamma.txt",
          id: "3",
          message: "Network failed",
          status: "failed",
          totalBytes: 0,
          transferredBytes: 5
        }
      ]
    });

    const panel = screen.getByRole("region", { name: "Transfer queue" });
    const queue = within(panel).getByRole("region", { name: "Upload queue" });
    expect(within(queue).getByText("3 file(s)")).toBeInTheDocument();

    const alphaRow = within(queue).getByText("alpha.txt").closest(".files-upload-queue-row");
    expect(alphaRow).toHaveClass("files-upload-queue-uploading");
    expect(within(alphaRow as HTMLElement).getByText("5 B / 20 B")).toBeInTheDocument();
    expect(within(alphaRow as HTMLElement).getByText("Uploading")).toBeInTheDocument();
    expect(within(alphaRow as HTMLElement).getByText("Uploading chunks")).toBeInTheDocument();
    const alphaProgress = within(alphaRow as HTMLElement).getByRole("progressbar");
    expect(alphaProgress).toHaveClass("ui-progress");
    expect(alphaProgress).not.toHaveClass("files-upload-queue-track");
    expect(alphaProgress).toHaveAttribute("aria-valuenow", "25");

    const betaRow = within(queue).getByText("beta.txt").closest(".files-upload-queue-row");
    expect(betaRow).toHaveClass("files-upload-queue-completed");
    expect(within(betaRow as HTMLElement).getByText("Completed")).toBeInTheDocument();
    expect((betaRow as HTMLElement).querySelector("p")).toBeNull();

    const gammaRow = within(queue).getByText("gamma.txt").closest(".files-upload-queue-row");
    expect(gammaRow).toHaveClass("files-upload-queue-failed");
    expect(within(gammaRow as HTMLElement).getByText("Network failed")).toBeInTheDocument();
    const gammaProgress = within(gammaRow as HTMLElement).getByRole("progressbar");
    expect(gammaProgress).toHaveClass("ui-progress");
    expect(gammaProgress).not.toHaveClass("files-upload-queue-track");
    expect(gammaProgress).toHaveAttribute("aria-valuenow", "0");
  });
});
