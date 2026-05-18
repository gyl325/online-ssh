import type { DefaultRemotePathPreference } from "./preferencesStorage";

export function uniqueRemotePathCandidates(paths: string[]) {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const value = path.trim();
    if (!value || seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

export function defaultRemotePathCandidates(
  preference: DefaultRemotePathPreference,
  homePath: string
) {
  const home = homePath.trim() || "/";
  if (preference.mode === "root") {
    return ["/"];
  }
  if (preference.mode === "custom") {
    return uniqueRemotePathCandidates([preference.customPath, home, "/"]);
  }
  return uniqueRemotePathCandidates([home, "/"]);
}
