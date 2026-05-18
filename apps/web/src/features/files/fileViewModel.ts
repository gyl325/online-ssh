import type { FileEntry } from "./types";

export type FileEntrySortingState = Array<{ id: string; desc?: boolean }>;

export const maxEditableFileBytes = 1024 * 1024;

const imagePreviewFileExtensions = new Set(["bmp", "gif", "jpeg", "jpg", "png", "webp"]);
const pdfPreviewFileExtensions = new Set(["pdf"]);
const nonPreviewableFileExtensions = new Set([
  "7z",
  "bin",
  "class",
  "deb",
  "dmg",
  "dll",
  "doc",
  "docx",
  "exe",
  "gz",
  "ico",
  "iso",
  "jar",
  "o",
  "ppt",
  "pptx",
  "pyc",
  "rar",
  "so",
  "tar",
  "tgz",
  "xls",
  "xlsx",
  "xz",
  "zip"
]);

const extractableArchiveExtensions = [
  ".tar.gz",
  ".tgz",
  ".tar.bz2",
  ".tbz2",
  ".tar.xz",
  ".txz",
  ".tar",
  ".zip"
];

export const compressArchiveFormats = [
  { extension: ".tar.gz", id: "tar.gz", labelKey: "files.archiveFormat.tarGz" },
  { extension: ".tar", id: "tar", labelKey: "files.archiveFormat.tar" },
  { extension: ".zip", id: "zip", labelKey: "files.archiveFormat.zip" }
] as const;

export type CompressArchiveFormat = typeof compressArchiveFormats[number]["id"];
export type FilePreviewKind = "text" | "image" | "pdf";

export function parentPathOf(currentPath: string) {
  if (currentPath === "/") {
    return "/";
  }

  const parts = currentPath.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return "/";
  }

  return `/${parts.slice(0, -1).join("/")}`;
}

export function joinPath(basePath: string, name: string) {
  const normalizedName = name.trim().replace(/^\/+/, "");
  if (!normalizedName) {
    return basePath;
  }

  return basePath === "/" ? `/${normalizedName}` : `${basePath}/${normalizedName}`;
}

export function pathSegments(currentPath: string) {
  const segments = currentPath.split("/").filter(Boolean);
  const items = [{ label: "/", value: "/" }];

  let cursor = "";
  for (const segment of segments) {
    cursor += `/${segment}`;
    items.push({ label: segment, value: cursor });
  }

  return items;
}

export function defaultHomePath(host: { username?: string | null } | null) {
  if (!host?.username) {
    return "/";
  }
  return host.username === "root" ? "/root" : `/home/${host.username}`;
}

export function fileExtension(entry: FileEntry | null) {
  if (!entry || entry.entry_type !== "file") {
    return "";
  }
  const name = entry.name.toLowerCase();
  const extensionIndex = name.lastIndexOf(".");
  if (extensionIndex <= 0 || extensionIndex === name.length - 1) {
    return "";
  }
  return name.slice(extensionIndex + 1);
}

export function previewKindForEntry(entry: FileEntry | null): FilePreviewKind | null {
  if (!entry || entry.entry_type !== "file") {
    return null;
  }
  const extension = fileExtension(entry);
  if (imagePreviewFileExtensions.has(extension)) {
    return "image";
  }
  if (pdfPreviewFileExtensions.has(extension)) {
    return "pdf";
  }
  if (!extension || !nonPreviewableFileExtensions.has(extension)) {
    return "text";
  }
  return null;
}

export function canPreview(entry: FileEntry | null) {
  return previewKindForEntry(entry) !== null;
}

export function canExtractArchive(entry: FileEntry | null) {
  if (!entry || entry.entry_type !== "file") {
    return false;
  }
  const name = entry.name.toLowerCase();
  return extractableArchiveExtensions.some((extension) => name.endsWith(extension));
}

export function archiveFormatExtension(format: CompressArchiveFormat) {
  return compressArchiveFormats.find((item) => item.id === format)?.extension ?? ".tar.gz";
}

export function stripKnownArchiveExtension(fileName: string) {
  const lower = fileName.toLowerCase();
  const knownExtensions = [...extractableArchiveExtensions].sort((a, b) => b.length - a.length);
  const extension = knownExtensions.find((candidate) => lower.endsWith(candidate));
  return extension ? fileName.slice(0, -extension.length) : fileName;
}

export function defaultArchiveName(entry: FileEntry, format: CompressArchiveFormat) {
  return `${stripKnownArchiveExtension(entry.name)}${archiveFormatExtension(format)}`;
}

export function archiveOutputPath(entry: FileEntry, archiveName: string) {
  return joinPath(parentPathOf(entry.path), archiveName);
}

export function duplicateFileName(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex > 0) {
    return `${fileName.slice(0, dotIndex)}-copy${fileName.slice(dotIndex)}`;
  }
  return `${fileName}-copy`;
}

export function terminalDirectoryForEntry(entry: FileEntry) {
  return entry.entry_type === "directory" ? entry.path : parentPathOf(entry.path);
}

export function canMoveEntryToDirectory(source: FileEntry, target: FileEntry | null) {
  if (!target || target.entry_type !== "directory") {
    return false;
  }
  if (source.path === target.path) {
    return false;
  }
  if (source.entry_type === "directory" && target.path.startsWith(`${source.path}/`)) {
    return false;
  }
  return true;
}

export function isTooLargeForPreview(entry: FileEntry) {
  return entry.size_bytes > maxEditableFileBytes;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function entryKindLabel(entryType: FileEntry["entry_type"], t: (key: string) => string) {
  switch (entryType) {
    case "directory":
      return t("files.kind.directory");
    case "file":
      return t("files.kind.file");
    case "symlink":
      return t("files.kind.symlink");
    default:
      return t("files.kind.other");
  }
}

const fileEntryTypeRank: Record<FileEntry["entry_type"], number> = {
  directory: 0,
  symlink: 1,
  file: 2,
  other: 3
};

function compareFileText(left: string, right: string) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function compareFileDate(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
  const safeRight = Number.isFinite(rightTime) ? rightTime : 0;
  return safeLeft - safeRight;
}

function compareFileByColumn(left: FileEntry, right: FileEntry, columnId: string) {
  switch (columnId) {
    case "size":
      return left.size_bytes - right.size_bytes;
    case "permissions":
      return compareFileText(left.permissions, right.permissions);
    case "modified":
      return compareFileDate(left.modified_at, right.modified_at);
    case "name":
    default:
      return compareFileText(left.name, right.name);
  }
}

export function sortFileEntries(items: FileEntry[], sorting: FileEntrySortingState) {
  const sorters = sorting.length > 0 ? sorting : [{ id: "name", desc: false }];

  return [...items].sort((left, right) => {
    const typeRank = fileEntryTypeRank[left.entry_type] - fileEntryTypeRank[right.entry_type];
    if (typeRank !== 0) {
      return typeRank;
    }

    for (const sorter of sorters) {
      const result = compareFileByColumn(left, right, sorter.id);
      if (result !== 0) {
        return sorter.desc ? -result : result;
      }
    }

    return compareFileText(left.path, right.path);
  });
}
