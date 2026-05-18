import { describe, expect, it, vi } from "vitest";

import { defaultTerminalHighlightPreferences } from "../terminal/highlighting";
import { createPreferencesContextValue } from "./preferencesContextValue";

describe("preferences context value", () => {
  it("assembles the public preferences value with a translator", () => {
    const setLanguage = vi.fn();
    const setTheme = vi.fn();
    const setTerminalFontSize = vi.fn();
    const setTerminalTheme = vi.fn();
    const setTerminalHighlightPreferences = vi.fn();

    const value = createPreferencesContextValue({
      effectiveTheme: "dark",
      language: "en-US",
      setLanguage,
      setTerminalFontSize,
      setTerminalHighlightPreferences,
      setTerminalTheme,
      setTheme,
      terminalFontSize: 14,
      terminalHighlightPreferences: defaultTerminalHighlightPreferences,
      terminalTheme: "dracula",
      theme: "system"
    });

    expect(value.t("preferences.title")).toBe("Interface preferences");
    expect(value.effectiveTheme).toBe("dark");
    expect(value.terminalFontSize).toBe(14);

    value.setTheme("light");
    expect(setTheme).toHaveBeenCalledWith("light");
  });
});
