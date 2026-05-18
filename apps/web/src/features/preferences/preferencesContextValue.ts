import type { TerminalHighlightPreferences } from "../terminal/highlighting";
import type { TerminalThemePreference } from "../terminal/theme";
import { createTranslator, type Translator } from "./i18n/translator";
import type { AppLanguage } from "./i18n/translations";
import type { AppTheme, EffectiveAppTheme } from "./preferencesStorage";

export type PreferencesContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  theme: AppTheme;
  effectiveTheme: EffectiveAppTheme;
  setTheme: (theme: AppTheme) => void;
  terminalFontSize: number;
  setTerminalFontSize: (fontSize: number) => void;
  terminalTheme: TerminalThemePreference;
  setTerminalTheme: (theme: TerminalThemePreference) => void;
  terminalHighlightPreferences: TerminalHighlightPreferences;
  setTerminalHighlightPreferences: (preferences: TerminalHighlightPreferences) => void;
  t: Translator;
};

type PreferencesContextValueInput = Omit<PreferencesContextValue, "t">;

export function createPreferencesContextValue(input: PreferencesContextValueInput): PreferencesContextValue {
  return {
    ...input,
    t: createTranslator(input.language)
  };
}
