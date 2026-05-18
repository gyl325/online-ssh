import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { selectInputOption } from "../../test/selectInput";
import {
  FileActionDialogs,
  type ActionDialogState,
  type CompressDialogState
} from "./FileActionDialogs";
import type { FileEntry } from "./types";

const labels: Record<string, string> = {
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.deleting": "Deleting...",
  "common.execute": "Execute",
  "common.executing": "Executing...",
  "files.action.chmod": "Change permissions",
  "files.archiveFormat": "Archive format",
  "files.archiveFormat.tar": "tar",
  "files.archiveFormat.tarGz": "tar.gz",
  "files.archiveFormat.zip": "zip",
  "files.archiveName": "Archive name",
  "files.archiveNamePlaceholder": "archive.tar.gz",
  "files.archiveSource": "Source",
  "files.chmod": "Change permissions",
  "files.compress": "Compress",
  "files.compressArchiveCopy": "Compress 1 item",
  "files.compressArchiveTitle": "Compress archive",
  "files.confirmDelete": "Delete",
  "files.confirmDeleteDirectory": "Delete directory /srv/app?",
  "files.confirmDeleteFile": "Delete file /srv/app/readme.txt?",
  "files.createDirectory": "Create directory",
  "files.createFile": "Create file",
  "files.deleteConfirmTitle": "Delete item",
  "files.mode": "Mode",
  "files.modePlaceholder": "755",
  "files.name": "Name",
  "files.namePlaceholder": "name.txt",
  "files.newName": "New name",
  "files.rename": "Rename"
};

function t(key: string) {
  return labels[key] || key;
}

function buildEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    entry_type: "file",
    group: "root",
    is_hidden: false,
    modified_at: "2026-04-24T12:00:00Z",
    name: "readme.txt",
    owner: "root",
    path: "/srv/app/readme.txt",
    permissions: "-rw-r--r--",
    size_bytes: 128,
    ...overrides
  };
}

function DialogHarness({
  actionDialog = null,
  actionSubmitting = false,
  compressDialog = null,
  compressSubmitting = false,
  onActionSubmit = vi.fn(),
  onCompressSubmit = vi.fn()
}: {
  actionDialog?: ActionDialogState | null;
  actionSubmitting?: boolean;
  compressDialog?: CompressDialogState | null;
  compressSubmitting?: boolean;
  onActionSubmit?: () => void;
  onCompressSubmit?: () => void;
}) {
  const [currentActionDialog, setCurrentActionDialog] = useState(actionDialog);
  const [currentCompressDialog, setCurrentCompressDialog] = useState(compressDialog);

  return (
    <FileActionDialogs
      actionDialog={currentActionDialog}
      actionSubmitting={actionSubmitting}
      compressDialog={currentCompressDialog}
      compressSubmitting={compressSubmitting}
      onActionClose={() => setCurrentActionDialog(null)}
      onActionSubmit={onActionSubmit}
      onActionValueChange={(value) =>
        setCurrentActionDialog((current) =>
          current && current.kind !== "delete" ? { ...current, value } : current
        )
      }
      onCompressClose={() => setCurrentCompressDialog(null)}
      onCompressFormatChange={(format) =>
        setCurrentCompressDialog((current) => current ? { ...current, format } : current)
      }
      onCompressNameChange={(name) =>
        setCurrentCompressDialog((current) => current ? { ...current, name } : current)
      }
      onCompressSubmit={onCompressSubmit}
      t={t}
    />
  );
}

describe("FileActionDialogs", () => {
  it("renders create, rename, and chmod action inputs and delegates value changes and submit", async () => {
    const user = userEvent.setup();
    const onCreateSubmit = vi.fn();
    const { unmount } = render(
      <DialogHarness
        actionDialog={{ kind: "create-directory", value: "logs" }}
        onActionSubmit={onCreateSubmit}
      />
    );

    const createDialog = screen.getByRole("dialog", { name: "Create directory" });
    await user.clear(within(createDialog).getByLabelText("Name"));
    await user.type(within(createDialog).getByLabelText("Name"), "tmp");
    expect(within(createDialog).getByDisplayValue("tmp")).toBeInTheDocument();
    await user.click(within(createDialog).getByRole("button", { name: "Execute" }));
    expect(onCreateSubmit).toHaveBeenCalledTimes(1);

    unmount();
    const renameRender = render(
      <DialogHarness actionDialog={{ kind: "rename", entry: buildEntry(), value: "readme.txt" }} />
    );
    const renameDialog = screen.getByRole("dialog", { name: "Rename" });
    await user.clear(within(renameDialog).getByLabelText("New name"));
    await user.type(within(renameDialog).getByLabelText("New name"), "README.md");
    expect(within(renameDialog).getByDisplayValue("README.md")).toBeInTheDocument();

    renameRender.unmount();
    render(<DialogHarness actionDialog={{ kind: "chmod", entry: buildEntry(), value: "644" }} />);
    const chmodDialog = screen.getByRole("dialog", { name: "Change permissions" });
    await user.clear(within(chmodDialog).getByLabelText("Mode"));
    await user.type(within(chmodDialog).getByLabelText("Mode"), "755");
    expect(within(chmodDialog).getByDisplayValue("755")).toBeInTheDocument();
  });

  it("renders delete confirmation copy and disables the danger action while submitting", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <DialogHarness
        actionDialog={{ kind: "delete", entry: buildEntry({ entry_type: "directory", name: "app", path: "/srv/app" }) }}
        actionSubmitting
        onActionSubmit={onSubmit}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Delete item" });

    expect(within(dialog).getByText("Delete directory /srv/app?")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Deleting..." })).toBeDisabled();

    await user.click(within(dialog).getByRole("button", { name: "Deleting..." }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps action and compress dialogs open when close is requested while submitting", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <DialogHarness
        actionDialog={{ kind: "create-file", value: "notes.txt" }}
        actionSubmitting
      />
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog", { name: "Create file" })).toBeInTheDocument();

    unmount();
    render(
      <DialogHarness
        compressDialog={{
          entry: buildEntry({ entry_type: "directory", name: "app", path: "/srv/app" }),
          format: "tar.gz",
          name: "app.tar.gz"
        }}
        compressSubmitting
      />
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog", { name: "Compress archive" })).toBeInTheDocument();
  });

  it("renders compress archive fields and delegates name, format, and submit actions", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <DialogHarness
        compressDialog={{
          entry: buildEntry({ entry_type: "directory", name: "app", path: "/srv/app" }),
          format: "tar.gz",
          name: "app.tar.gz"
        }}
        onCompressSubmit={onSubmit}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Compress archive" });
    expect(within(dialog).getByText("Source")).toBeInTheDocument();
    expect(within(dialog).getByText("app")).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText("Archive name"));
    await user.type(within(dialog).getByLabelText("Archive name"), "app.zip");
    expect(within(dialog).getByDisplayValue("app.zip")).toBeInTheDocument();

    await selectInputOption(user, within(dialog).getByRole("combobox", { name: "Archive format" }), "zip");
    expect(within(dialog).getByRole("combobox", { name: "Archive format" })).toHaveTextContent("zip");

    await user.click(within(dialog).getByRole("button", { name: "Compress" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
