import { describe, expect, it } from "vitest";

import type { FileEntry } from "./types";
import {
  archiveFormatExtension,
  archiveOutputPath,
  canExtractArchive,
  canMoveEntryToDirectory,
  defaultArchiveName,
  defaultHomePath,
  duplicateFileName,
  entryKindLabel,
  formatBytes,
  isTooLargeForPreview,
  joinPath,
  maxEditableFileBytes,
  parentPathOf,
  pathSegments,
  previewKindForEntry,
  sortFileEntries,
  stripKnownArchiveExtension,
  terminalDirectoryForEntry
} from "./fileViewModel";

function file(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    name: "notes.txt",
    path: "/root/notes.txt",
    entry_type: "file",
    size_bytes: 128,
    permissions: "-rw-r--r--",
    owner: "root",
    group: "root",
    modified_at: "2026-04-24T12:00:00Z",
    is_hidden: false,
    ...overrides
  };
}

function directory(overrides: Partial<FileEntry> = {}): FileEntry {
  return file({
    name: "project",
    path: "/root/project",
    entry_type: "directory",
    permissions: "drwxr-xr-x",
    ...overrides
  });
}

describe("file view model helpers", () => {
  it("keeps path derivation behavior stable", () => {
    expect(parentPathOf("/")).toBe("/");
    expect(parentPathOf("/root/notes.txt")).toBe("/root");
    expect(parentPathOf("/root")).toBe("/");
    expect(joinPath("/root", "  /notes.txt  ")).toBe("/root/notes.txt");
    expect(joinPath("/", "/notes.txt")).toBe("/notes.txt");
    expect(joinPath("/root", "   ")).toBe("/root");
    expect(pathSegments("/var/log/nginx")).toEqual([
      { label: "/", value: "/" },
      { label: "var", value: "/var" },
      { label: "log", value: "/var/log" },
      { label: "nginx", value: "/var/log/nginx" }
    ]);
    expect(defaultHomePath(null)).toBe("/");
    expect(defaultHomePath({ username: "root" })).toBe("/root");
    expect(defaultHomePath({ username: "deploy" })).toBe("/home/deploy");
  });

  it("classifies previewable file entries without touching page state", () => {
    expect(previewKindForEntry(file({ name: "photo.JPG" }))).toBe("image");
    expect(previewKindForEntry(file({ name: "manual.pdf" }))).toBe("pdf");
    expect(previewKindForEntry(file({ name: ".env" }))).toBe("text");
    expect(previewKindForEntry(file({ name: "README" }))).toBe("text");
    expect(previewKindForEntry(file({ name: "archive.zip" }))).toBeNull();
    expect(previewKindForEntry(directory())).toBeNull();
    expect(isTooLargeForPreview(file({ size_bytes: maxEditableFileBytes }))).toBe(false);
    expect(isTooLargeForPreview(file({ size_bytes: maxEditableFileBytes + 1 }))).toBe(true);
  });

  it("derives archive names and output paths", () => {
    const source = directory({ name: "release.tar.gz", path: "/tmp/release.tar.gz" });

    expect(canExtractArchive(file({ name: "backup.TGZ" }))).toBe(true);
    expect(canExtractArchive(file({ name: "backup.gz" }))).toBe(false);
    expect(canExtractArchive(directory({ name: "archive.zip" }))).toBe(false);
    expect(archiveFormatExtension("zip")).toBe(".zip");
    expect(stripKnownArchiveExtension("release.tar.gz")).toBe("release");
    expect(defaultArchiveName(source, "zip")).toBe("release.zip");
    expect(archiveOutputPath(source, "release.zip")).toBe("/tmp/release.zip");
  });

  it("derives file action paths for copy, terminal, and drag moves", () => {
    const source = directory({ name: "src", path: "/root/src" });
    const child = file({ name: "index.ts", path: "/root/src/index.ts" });
    const target = directory({ name: "dest", path: "/root/dest" });

    expect(duplicateFileName("notes.txt")).toBe("notes-copy.txt");
    expect(duplicateFileName("README")).toBe("README-copy");
    expect(terminalDirectoryForEntry(source)).toBe("/root/src");
    expect(terminalDirectoryForEntry(child)).toBe("/root/src");
    expect(canMoveEntryToDirectory(source, target)).toBe(true);
    expect(canMoveEntryToDirectory(source, source)).toBe(false);
    expect(canMoveEntryToDirectory(source, directory({ path: "/root/src/nested" }))).toBe(false);
    expect(canMoveEntryToDirectory(child, file({ path: "/root/other.txt" }))).toBe(false);
  });

  it("formats file metadata for route display", () => {
    const t = (key: string) => key;

    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
    expect(entryKindLabel("directory", t)).toBe("files.kind.directory");
    expect(entryKindLabel("file", t)).toBe("files.kind.file");
    expect(entryKindLabel("symlink", t)).toBe("files.kind.symlink");
    expect(entryKindLabel("other", t)).toBe("files.kind.other");
  });

  it("sorts file entries by type rank before active table sorters", () => {
    const entries = [
      file({ entry_type: "file", name: "file-10.log", path: "/root/file-10.log", size_bytes: 10 }),
      directory({ name: "dir-2", path: "/root/dir-2", size_bytes: 0 }),
      file({ entry_type: "file", name: "file-2.log", path: "/root/file-2.log", size_bytes: 2 }),
      file({ entry_type: "symlink", name: "link-1", path: "/root/link-1", size_bytes: 1 })
    ];

    expect(sortFileEntries(entries, []).map((entry) => entry.name)).toEqual([
      "dir-2",
      "link-1",
      "file-2.log",
      "file-10.log"
    ]);
    expect(sortFileEntries(entries, [{ id: "size", desc: true }]).map((entry) => entry.name)).toEqual([
      "dir-2",
      "link-1",
      "file-10.log",
      "file-2.log"
    ]);
  });
});
