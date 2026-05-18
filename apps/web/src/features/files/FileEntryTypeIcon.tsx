import { File as FileIcon, FileSymlink, Folder } from "lucide-react";

import type { FileEntry } from "./types";

type FileEntryTypeIconProps = {
  entryType: FileEntry["entry_type"];
};

export function FileEntryTypeIcon({ entryType }: FileEntryTypeIconProps) {
  if (entryType === "directory") {
    return <Folder aria-hidden="true" />;
  }
  if (entryType === "symlink") {
    return <FileSymlink aria-hidden="true" />;
  }
  return <FileIcon aria-hidden="true" />;
}
