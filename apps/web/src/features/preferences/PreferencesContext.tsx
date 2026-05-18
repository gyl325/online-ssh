import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren
} from "react";

import { type TerminalHighlightPreferences } from "../terminal/highlighting";
import { type TerminalThemePreference } from "../terminal/theme";
import { type AppLanguage } from "./i18n/translations";
import {
  createPreferencesContextValue,
  type PreferencesContextValue
} from "./preferencesContextValue";
import {
  applyThemeToDocument,
  persistLanguage,
  persistFilesDefaultPathPreference,
  persistTerminalFontSize,
  persistTerminalHighlightPreferences,
  persistTerminalDefaultPathPreference,
  persistTerminalTheme,
  readStoredFilesDefaultPathPreference,
  readStoredLanguage,
  readStoredTerminalFontSize,
  readStoredTerminalHighlightPreferences,
  readStoredTerminalDefaultPathPreference,
  readStoredTerminalTheme,
  readStoredTheme,
  type AppTheme,
  type DefaultRemotePathPreference,
  type EffectiveAppTheme
} from "./preferencesStorage";

export type { AppLanguage } from "./i18n/translations";
export type { AppTheme, DefaultRemotePathPreference, EffectiveAppTheme } from "./preferencesStorage";

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function getSystemTheme(): EffectiveAppTheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

function resolveEffectiveTheme(theme: AppTheme, systemTheme: EffectiveAppTheme): EffectiveAppTheme {
  return theme === "system" ? systemTheme : theme;
}

export function PreferencesProvider({ children }: PropsWithChildren) {
  const [language, setLanguageState] = useState<AppLanguage>(readStoredLanguage);
  const [theme, setThemeState] = useState<AppTheme>(readStoredTheme);
  const [filesDefaultPathPreference, setFilesDefaultPathPreferenceState] = useState<DefaultRemotePathPreference>(
    readStoredFilesDefaultPathPreference
  );
  const [terminalDefaultPathPreference, setTerminalDefaultPathPreferenceState] = useState<DefaultRemotePathPreference>(
    readStoredTerminalDefaultPathPreference
  );
  const [terminalFontSize, setTerminalFontSizeState] = useState(readStoredTerminalFontSize);
  const [terminalTheme, setTerminalThemeState] = useState<TerminalThemePreference>(readStoredTerminalTheme);
  const [terminalHighlightPreferences, setTerminalHighlightPreferencesState] = useState<TerminalHighlightPreferences>(
    readStoredTerminalHighlightPreferences
  );
  const [systemTheme, setSystemTheme] = useState<EffectiveAppTheme>(getSystemTheme);
  const effectiveTheme = resolveEffectiveTheme(theme, systemTheme);
  const themeRef = useRef(theme);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    persistLanguage(language);
  }, [language]);

  useLayoutEffect(() => {
    applyThemeToDocument(theme, effectiveTheme);
  }, [effectiveTheme, theme]);

  const setTheme = useCallback((nextTheme: AppTheme) => {
    applyThemeToDocument(nextTheme, resolveEffectiveTheme(nextTheme, systemTheme));
    setThemeState(nextTheme);
  }, [systemTheme]);

  const setFilesDefaultPathPreference = useCallback((nextPreference: DefaultRemotePathPreference) => {
    setFilesDefaultPathPreferenceState(persistFilesDefaultPathPreference(nextPreference));
  }, []);

  const setTerminalDefaultPathPreference = useCallback((nextPreference: DefaultRemotePathPreference) => {
    setTerminalDefaultPathPreferenceState(persistTerminalDefaultPathPreference(nextPreference));
  }, []);

  const setTerminalFontSize = useCallback((nextFontSize: number) => {
    setTerminalFontSizeState(persistTerminalFontSize(nextFontSize));
  }, []);

  const setTerminalTheme = useCallback((nextTheme: TerminalThemePreference) => {
    setTerminalThemeState(persistTerminalTheme(nextTheme));
  }, []);

  const setTerminalHighlightPreferences = useCallback((nextPreferences: TerminalHighlightPreferences) => {
    setTerminalHighlightPreferencesState(persistTerminalHighlightPreferences(nextPreferences));
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mediaQuery) {
      return;
    }

    const updateSystemTheme = (matches: boolean) => {
      const nextSystemTheme = matches ? "dark" : "light";
      if (themeRef.current === "system") {
        applyThemeToDocument("system", nextSystemTheme);
      }
      setSystemTheme(nextSystemTheme);
    };
    const handleSystemThemeChange = (event: MediaQueryListEvent) => updateSystemTheme(event.matches);

    updateSystemTheme(mediaQuery.matches);
    mediaQuery.addEventListener?.("change", handleSystemThemeChange);
    mediaQuery.addListener?.(handleSystemThemeChange);

    return () => {
      mediaQuery.removeEventListener?.("change", handleSystemThemeChange);
      mediaQuery.removeListener?.(handleSystemThemeChange);
    };
  }, []);

  const value = useMemo<PreferencesContextValue>(() => {
    return createPreferencesContextValue({
      language,
      setLanguage: setLanguageState,
      theme,
      effectiveTheme,
      setTheme,
      filesDefaultPathPreference,
      setFilesDefaultPathPreference,
      terminalDefaultPathPreference,
      setTerminalDefaultPathPreference,
      terminalFontSize,
      setTerminalFontSize,
      terminalTheme,
      setTerminalTheme,
      terminalHighlightPreferences,
      setTerminalHighlightPreferences
    });
  }, [
    effectiveTheme,
    filesDefaultPathPreference,
    language,
    setFilesDefaultPathPreference,
    setTerminalFontSize,
    setTerminalDefaultPathPreference,
    setTerminalHighlightPreferences,
    setTerminalTheme,
    setTheme,
    terminalDefaultPathPreference,
    terminalFontSize,
    terminalHighlightPreferences,
    terminalTheme,
    theme
  ]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) {
    throw new Error("usePreferences must be used within PreferencesProvider");
  }
  return value;
}
