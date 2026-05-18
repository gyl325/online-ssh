import {
  defaultTerminalHighlightPreferences,
  normalizeTerminalHighlightPreferences,
  terminalHighlightStorageKey,
  type TerminalHighlightPreferences
} from "../terminal/highlightPreferences";
import { isTerminalThemePreference, type TerminalThemePreference } from "../terminal/themePreference";
import type { AppLanguage } from "./i18n/translations";

export type EffectiveAppTheme = "dark" | "light";
export type AppTheme = EffectiveAppTheme | "system";
export type DefaultRemotePathMode = "home" | "root" | "custom";
export type DefaultRemotePathPreference = {
  mode: DefaultRemotePathMode;
  customPath: string;
};

export const languageStorageKey = "online-ssh-language";
export const themeStorageKey = "online-ssh-theme";
export const terminalFontSizeStorageKey = "online-ssh-terminal-font-size";
export const terminalThemeStorageKey = "online-ssh-terminal-theme";
export const filesDefaultPathStorageKey = "online-ssh-files-default-path";
export const terminalDefaultPathStorageKey = "online-ssh-terminal-default-path";
export const defaultTerminalFontSize = 13;
export const minTerminalFontSize = 10;
export const maxTerminalFontSize = 22;
export const defaultRemotePathPreference: DefaultRemotePathPreference = { mode: "home", customPath: "" };

export function readStoredLanguage(): AppLanguage {
  return window.localStorage.getItem(languageStorageKey) === "en-US" ? "en-US" : "zh-CN";
}

export function readStoredTheme(): AppTheme {
  const storedTheme = window.localStorage.getItem(themeStorageKey);
  return storedTheme === "dark" || storedTheme === "light" || storedTheme === "system" ? storedTheme : "system";
}

export function clampTerminalFontSize(fontSize: number) {
  if (!Number.isFinite(fontSize)) {
    return defaultTerminalFontSize;
  }
  return Math.max(minTerminalFontSize, Math.min(maxTerminalFontSize, Math.round(fontSize)));
}

export function readStoredTerminalFontSize() {
  const stored = Number(window.localStorage.getItem(terminalFontSizeStorageKey));
  return clampTerminalFontSize(stored || defaultTerminalFontSize);
}

export function readStoredTerminalTheme(): TerminalThemePreference {
  const stored = window.localStorage.getItem(terminalThemeStorageKey);
  return isTerminalThemePreference(stored) ? stored : "system";
}

export function readStoredTerminalHighlightPreferences(): TerminalHighlightPreferences {
  const stored = window.localStorage.getItem(terminalHighlightStorageKey);
  if (!stored) {
    return defaultTerminalHighlightPreferences;
  }
  try {
    return normalizeTerminalHighlightPreferences(JSON.parse(stored));
  } catch {
    return defaultTerminalHighlightPreferences;
  }
}

function isDefaultRemotePathMode(value: unknown): value is DefaultRemotePathMode {
  return value === "home" || value === "root" || value === "custom";
}

function normalizeCustomRemotePath(value: unknown): { path: string; valid: boolean } {
  if (typeof value !== "string") {
    return { path: "", valid: true };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { path: "", valid: true };
  }
  if (trimmed.length > 4096 || /[\x00\r\n]/.test(trimmed)) {
    return { path: "", valid: false };
  }
  const absolutePath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return { path: absolutePath.replace(/\/+$/, "") || "/", valid: true };
}

export function normalizeDefaultRemotePathPreference(value: unknown): DefaultRemotePathPreference {
  if (!value || typeof value !== "object") {
    return defaultRemotePathPreference;
  }

  const candidate = value as Partial<DefaultRemotePathPreference>;
  if (!isDefaultRemotePathMode(candidate.mode)) {
    return defaultRemotePathPreference;
  }

  if (candidate.mode === "root") {
    return { mode: "root", customPath: "" };
  }
  if (candidate.mode === "home") {
    return defaultRemotePathPreference;
  }

  const customPath = normalizeCustomRemotePath(candidate.customPath);
  return customPath.valid
    ? { mode: "custom", customPath: customPath.path }
    : defaultRemotePathPreference;
}

function readStoredDefaultRemotePathPreference(storageKey: string): DefaultRemotePathPreference {
  const stored = window.localStorage.getItem(storageKey);
  if (!stored) {
    return defaultRemotePathPreference;
  }
  try {
    return normalizeDefaultRemotePathPreference(JSON.parse(stored));
  } catch {
    return defaultRemotePathPreference;
  }
}

export function readStoredFilesDefaultPathPreference(): DefaultRemotePathPreference {
  return readStoredDefaultRemotePathPreference(filesDefaultPathStorageKey);
}

export function readStoredTerminalDefaultPathPreference(): DefaultRemotePathPreference {
  return readStoredDefaultRemotePathPreference(terminalDefaultPathStorageKey);
}

export function applyThemeToDocument(theme: AppTheme, effectiveTheme: EffectiveAppTheme) {
  window.localStorage.setItem(themeStorageKey, theme);
  document.documentElement.dataset.theme = effectiveTheme;
  document.documentElement.dataset.themeMode = theme;
}

export function persistLanguage(language: AppLanguage) {
  window.localStorage.setItem(languageStorageKey, language);
  document.documentElement.lang = language;
}

export function persistTerminalFontSize(fontSize: number) {
  const normalized = clampTerminalFontSize(fontSize);
  window.localStorage.setItem(terminalFontSizeStorageKey, String(normalized));
  return normalized;
}

export function persistTerminalTheme(theme: TerminalThemePreference) {
  const normalized = isTerminalThemePreference(theme) ? theme : "system";
  window.localStorage.setItem(terminalThemeStorageKey, normalized);
  return normalized;
}

export function persistTerminalHighlightPreferences(preferences: TerminalHighlightPreferences) {
  const normalized = normalizeTerminalHighlightPreferences(preferences);
  window.localStorage.setItem(terminalHighlightStorageKey, JSON.stringify(normalized));
  return normalized;
}

function persistDefaultRemotePathPreference(storageKey: string, preference: DefaultRemotePathPreference) {
  const normalized = normalizeDefaultRemotePathPreference(preference);
  window.localStorage.setItem(storageKey, JSON.stringify(normalized));
  return normalized;
}

export function persistFilesDefaultPathPreference(preference: DefaultRemotePathPreference) {
  return persistDefaultRemotePathPreference(filesDefaultPathStorageKey, preference);
}

export function persistTerminalDefaultPathPreference(preference: DefaultRemotePathPreference) {
  return persistDefaultRemotePathPreference(terminalDefaultPathStorageKey, preference);
}
