import { describe, expect, it } from "vitest";

import { defaultTerminalHighlightPreferences } from "../terminal/highlighting";
import {
  applyThemeToDocument,
  persistLanguage,
  persistTerminalFontSize,
  persistTerminalHighlightPreferences,
  persistTerminalTheme,
  readStoredLanguage,
  readStoredTerminalFontSize,
  readStoredTerminalHighlightPreferences,
  readStoredTerminalTheme,
  readStoredTheme
} from "./preferencesStorage";

describe("preferencesStorage", () => {
  it("normalizes stored preference values", () => {
    window.localStorage.setItem("online-ssh-language", "fr-FR");
    window.localStorage.setItem("online-ssh-theme", "sepia");
    window.localStorage.setItem("online-ssh-terminal-font-size", "99");
    window.localStorage.setItem("online-ssh-terminal-theme", "unknown");
    window.localStorage.setItem("online-ssh-terminal-highlighting", "{");

    expect(readStoredLanguage()).toBe("zh-CN");
    expect(readStoredTheme()).toBe("system");
    expect(readStoredTerminalFontSize()).toBe(22);
    expect(readStoredTerminalTheme()).toBe("system");
    expect(readStoredTerminalHighlightPreferences()).toEqual(defaultTerminalHighlightPreferences);
  });

  it("persists normalized preference values", () => {
    persistLanguage("en-US");
    applyThemeToDocument("system", "dark");
    persistTerminalFontSize(6);
    persistTerminalTheme("dracula");
    persistTerminalHighlightPreferences({
      version: 1,
      enabled: false,
      builtinRules: {},
      customRules: []
    });

    expect(window.localStorage.getItem("online-ssh-language")).toBe("en-US");
    expect(document.documentElement.lang).toBe("en-US");
    expect(window.localStorage.getItem("online-ssh-theme")).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeMode).toBe("system");
    expect(window.localStorage.getItem("online-ssh-terminal-font-size")).toBe("10");
    expect(window.localStorage.getItem("online-ssh-terminal-theme")).toBe("dracula");
    expect(JSON.parse(window.localStorage.getItem("online-ssh-terminal-highlighting") || "{}")).toMatchObject({
      version: 1,
      enabled: false
    });
  });
});
