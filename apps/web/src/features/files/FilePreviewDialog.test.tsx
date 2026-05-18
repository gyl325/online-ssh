import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  FilePreviewDialog,
  type FilePreviewDialogState
} from "./FilePreviewDialog";
import type { FileEntry } from "./types";

vi.mock("./FileTextEditor", () => ({
  FileTextEditor: ({
    ariaLabel,
    disabled,
    editable,
    onChange,
    value
  }: {
    ariaLabel: string;
    disabled?: boolean;
    editable: boolean;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      disabled={disabled || !editable}
      onChange={(event) => onChange(event.target.value)}
      readOnly={!editable}
      value={value}
    />
  )
}));

vi.mock("./FilePdfPreview", () => ({
  FilePdfPreview: ({ fileName }: { fileName: string }) => (
    <div aria-label={`${fileName} PDF`} data-testid="pdf-preview">PDF preview</div>
  )
}));

const labels: Record<string, string> = {
  "common.close": "Close",
  "common.lastModified": "Last modified: {{time}}",
  "common.notRecorded": "Not recorded",
  "common.save": "Save",
  "common.saving": "Saving...",
  "files.cancelEdit": "Cancel edit",
  "files.download": "Download",
  "files.draftSize": "Current draft size: {{size}}",
  "files.editContent": "Edit",
  "files.editorNote": "Editing remote file. Save changes when finished.",
  "files.editorReadOnlyNote": "Read-only preview. Choose Edit before changing and saving this file.",
  "files.imagePreviewNote": "Images are previewed read-only.",
  "files.loadingPreview": "Loading preview...",
  "files.pdfLoadFailed": "PDF preview failed.",
  "files.pdfLoading": "Loading PDF...",
  "files.pdfNextPage": "Next page",
  "files.pdfPageStatus": "Page {{page}} / {{total}}",
  "files.pdfPreviousPage": "Previous page",
  "files.pdfPreviewNote": "PDF files are previewed read-only.",
  "files.pdfZoomIn": "Zoom in",
  "files.pdfZoomOut": "Zoom out",
  "files.previewKind.image": "Image",
  "files.previewKind.pdf": "PDF",
  "files.previewKind.text": "Text",
  "files.previewTextAria": "File text content",
  "files.readingContent": "Reading text content..."
};

function t(key: string, params?: Record<string, string | number>) {
  let value = labels[key] || key;
  Object.entries(params || {}).forEach(([param, replacement]) => {
    value = value.replace(`{{${param}}}`, String(replacement));
  });
  return value;
}

function entry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    entry_type: "file",
    group: "root",
    is_hidden: false,
    modified_at: "2026-04-24T12:00:00Z",
    name: "notes.txt",
    owner: "root",
    path: "/root/notes.txt",
    permissions: "-rw-r--r--",
    size_bytes: 12,
    ...overrides
  };
}

function readyTextDialog(overrides: Partial<FilePreviewDialogState> = {}): FilePreviewDialogState {
  return {
    content: {
      content: "old contents",
      encoding: "utf-8",
      host_id: "host-1",
      last_modified_at: "2026-04-24T12:00:00Z",
      path: "/root/notes.txt",
      size_bytes: 12
    },
    draft: "old contents",
    editing: false,
    entry: entry(),
    errorMessage: null,
    objectUrl: null,
    previewKind: "text",
    saving: false,
    status: "ready",
    ...overrides
  };
}

function renderPreviewDialog(
  dialog: FilePreviewDialogState,
  overrides: Partial<ComponentProps<typeof FilePreviewDialog>> = {}
) {
  const props: ComponentProps<typeof FilePreviewDialog> = {
    dialog,
    draftChanged: dialog.status === "ready" && dialog.content ? dialog.draft !== dialog.content.content : false,
    draftSizeBytes: new TextEncoder().encode(dialog.draft).length,
    language: "en",
    onCancelEdit: vi.fn(),
    onClose: vi.fn(),
    onDownload: vi.fn(),
    onDraftChange: vi.fn(),
    onSave: vi.fn(),
    onStartEdit: vi.fn(),
    t,
    ...overrides
  };

  const result = render(<FilePreviewDialog {...props} />);
  return { ...props, ...result };
}

describe("FilePreviewDialog", () => {
  it("renders shared loading state for text previews", () => {
    renderPreviewDialog({
      ...readyTextDialog(),
      content: null,
      draft: "",
      status: "loading"
    });

    expect(screen.getByRole("status", { name: "Reading text content..." })).toHaveClass(
      "ui-loading-state",
      "files-preview-loading"
    );
  });

  it("renders error copy and delegates close and download", async () => {
    const user = userEvent.setup();
    const props = renderPreviewDialog({
      ...readyTextDialog(),
      content: null,
      draft: "",
      errorMessage: "Preview failed",
      status: "error"
    });

    const dialog = screen.getByRole("dialog", { name: "notes.txt" });
    expect(within(dialog).getByText("Preview failed")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Download" }));
    await user.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1) as HTMLElement);

    expect(props.onDownload).toHaveBeenCalledWith(props.dialog.entry);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("renders text preview metadata and delegates edit, draft, and save actions", async () => {
    const user = userEvent.setup();
    const props = renderPreviewDialog(readyTextDialog({
      draft: "changed contents",
      editing: true
    }), {
      draftChanged: true
    });

    const dialog = screen.getByRole("dialog", { name: "notes.txt" });
    expect(within(dialog).getAllByText((_, element) => {
      const text = element?.textContent || "";
      return element?.tagName.toLowerCase() === "span" &&
        text.includes("utf-8") &&
        text.includes("12 B") &&
        text.includes("Last modified:");
    })).toHaveLength(1);
    expect(within(dialog).getByText("Text")).toHaveClass("ui-badge");
    expect(within(dialog).getByText("Editing remote file. Save changes when finished.")).toHaveClass("ui-inline-note-title");

    const editor = await within(dialog).findByRole("textbox", { name: "File text content" });
    fireEvent.change(editor, { target: { value: "new contents" } });
    await user.click(within(dialog).getByRole("button", { name: "Cancel edit" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(props.onDraftChange).toHaveBeenLastCalledWith("new contents");
    expect(props.onCancelEdit).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it("uses shared save button loading and disables invalid saves", () => {
    renderPreviewDialog(readyTextDialog({
      draft: "changed contents",
      editing: true,
      saving: true
    }), {
      draftChanged: true
    });

    const savingButton = screen.getByRole("button", { name: "Saving..." });
    expect(savingButton).toHaveClass("ui-button-loading");
    expect(savingButton).toHaveAttribute("aria-busy", "true");
    expect(savingButton.querySelector(".ui-button-spinner")).not.toBeNull();
  });

  it("renders image and pdf previews as read-only surfaces", async () => {
    renderPreviewDialog(readyTextDialog({
      content: null,
      draft: "",
      objectUrl: "blob:image",
      previewKind: "image"
    }));
    expect(screen.getByRole("img", { name: "notes.txt" })).toHaveAttribute("src", "blob:image");
    expect(screen.getByText("Images are previewed read-only.").closest(".ui-inline-note")).toHaveClass("files-preview-note");

    cleanup();
    renderPreviewDialog(readyTextDialog({
      content: null,
      draft: "",
      objectUrl: "blob:pdf",
      previewKind: "pdf"
    }));
    expect(await screen.findByTestId("pdf-preview")).toHaveTextContent("PDF preview");
    expect(screen.getByText("PDF files are previewed read-only.").closest(".ui-inline-note")).toHaveClass("files-preview-note");
  });
});
