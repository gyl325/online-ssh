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

export const languageStorageKey = "online-ssh-language";
export const themeStorageKey = "online-ssh-theme";
export const terminalFontSizeStorageKey = "online-ssh-terminal-font-size";
export const terminalThemeStorageKey = "online-ssh-terminal-theme";
export const defaultTerminalFontSize = 13;
export const minTerminalFontSize = 10;
export const maxTerminalFontSize = 22;

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
