import { describe, expect, it, vi } from "vitest";

import { defaultTerminalHighlightPreferences } from "../terminal/highlighting";
import { createPreferencesContextValue } from "./preferencesContextValue";

describe("preferences context value", () => {
  it("assembles the public preferences value with a translator", () => {
    const setLanguage = vi.fn();
    const setTheme = vi.fn();
    const setFilesDefaultPathPreference = vi.fn();
    const setTerminalDefaultPathPreference = vi.fn();
    const setTerminalFontSize = vi.fn();
    const setTerminalTheme = vi.fn();
    const setTerminalHighlightPreferences = vi.fn();

    const value = createPreferencesContextValue({
      effectiveTheme: "dark",
      filesDefaultPathPreference: { mode: "home", customPath: "" },
      language: "en-US",
      setFilesDefaultPathPreference,
      setLanguage,
      setTerminalDefaultPathPreference,
      setTerminalFontSize,
      setTerminalHighlightPreferences,
      setTerminalTheme,
      setTheme,
      terminalDefaultPathPreference: { mode: "custom", customPath: "/srv/app" },
      terminalFontSize: 14,
      terminalHighlightPreferences: defaultTerminalHighlightPreferences,
      terminalTheme: "dracula",
      theme: "system"
    });

    expect(value.t("preferences.title")).toBe("Interface preferences");
    expect(value.effectiveTheme).toBe("dark");
    expect(value.terminalDefaultPathPreference).toEqual({ mode: "custom", customPath: "/srv/app" });
    expect(value.terminalFontSize).toBe(14);

    value.setTheme("light");
    expect(setTheme).toHaveBeenCalledWith("light");
  });
});
