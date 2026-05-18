import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreferencesProvider, usePreferences } from "./PreferencesContext";

const originalMatchMedia = window.matchMedia;

function installMatchMedia(initialDark: boolean) {
  let matches = initialDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQuery = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (type === "change" && typeof listener === "function") {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      }
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (type === "change" && typeof listener === "function") {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      }
    }),
    addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    dispatchEvent: vi.fn()
  } as unknown as MediaQueryList;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue(mediaQuery),
    writable: true
  });

  return {
    setDark(nextDark: boolean) {
      matches = nextDark;
      listeners.forEach((listener) => listener({ matches: nextDark, media: mediaQuery.media } as MediaQueryListEvent));
    }
  };
}

function ThemeProbe() {
  const {
    effectiveTheme,
    filesDefaultPathPreference,
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
  } = usePreferences();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="effective-theme">{effectiveTheme}</span>
      <span data-testid="terminal-font-size">{terminalFontSize}</span>
      <span data-testid="terminal-theme">{terminalTheme}</span>
      <span data-testid="files-default-path">{`${filesDefaultPathPreference.mode}:${filesDefaultPathPreference.customPath}`}</span>
      <span data-testid="terminal-default-path">{`${terminalDefaultPathPreference.mode}:${terminalDefaultPathPreference.customPath}`}</span>
      <span data-testid="terminal-highlight-enabled">{String(terminalHighlightPreferences.enabled)}</span>
      <span data-testid="terminal-highlight-custom-count">{terminalHighlightPreferences.customRules.length}</span>
      <button onClick={() => setTheme("system")} type="button">system</button>
      <button onClick={() => setTheme("light")} type="button">light</button>
      <button onClick={() => setTerminalFontSize(16)} type="button">font 16</button>
      <button onClick={() => setTerminalTheme("dracula")} type="button">theme dracula</button>
      <button onClick={() => setFilesDefaultPathPreference({ mode: "custom", customPath: "srv/app" })} type="button">files custom path</button>
      <button onClick={() => setTerminalDefaultPathPreference({ mode: "root", customPath: "/ignored" })} type="button">terminal root path</button>
      <button
        onClick={() =>
          setTerminalHighlightPreferences({
            version: 1,
            enabled: false,
            builtinRules: {
              error: {
                enabled: false,
                backgroundColor: "#4c0519"
              }
            },
            customRules: [
              {
                id: "custom-trace",
                name: "Trace ID",
                enabled: true,
                matchType: "regex",
                pattern: "trace-[0-9]+",
                caseSensitive: false,
                foregroundColor: "#f8fafc",
                backgroundColor: "#1e3a8a",
                priority: 55
              }
            ]
          })
        }
        type="button"
      >
        configure highlights
      </button>
    </div>
  );
}

describe("PreferencesContext", () => {
  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
      writable: true
    });
  });

  it("defaults to system theme and applies the current system color scheme", async () => {
    window.localStorage.removeItem("online-ssh-theme");
    installMatchMedia(true);

    render(
      <PreferencesProvider>
        <ThemeProbe />
      </PreferencesProvider>
    );

    expect(screen.getByTestId("theme")).toHaveTextContent("system");
    expect(screen.getByTestId("effective-theme")).toHaveTextContent("dark");
    await waitFor(() => expect(window.localStorage.getItem("online-ssh-theme")).toBe("system"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeMode).toBe("system");
  });

  it("updates the effective theme when system mode is active", async () => {
    window.localStorage.setItem("online-ssh-theme", "system");
    const systemTheme = installMatchMedia(false);

    render(
      <PreferencesProvider>
        <ThemeProbe />
      </PreferencesProvider>
    );

    expect(screen.getByTestId("effective-theme")).toHaveTextContent("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    systemTheme.setDark(true);

    await waitFor(() => expect(screen.getByTestId("effective-theme")).toHaveTextContent("dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("applies explicit theme selection to the document before dependent effects read CSS variables", async () => {
    window.localStorage.setItem("online-ssh-theme", "light");
    installMatchMedia(false);
    const themeSnapshots: string[] = [];

    function DependentEffectProbe() {
      const { effectiveTheme, setTheme } = usePreferences();

      useLayoutEffect(() => {
        themeSnapshots.push(`${effectiveTheme}:${document.documentElement.dataset.theme || ""}`);
      }, [effectiveTheme]);

      return <button onClick={() => setTheme("dark")} type="button">dark</button>;
    }

    const user = userEvent.setup();
    render(
      <PreferencesProvider>
        <DependentEffectProbe />
      </PreferencesProvider>
    );

    await user.click(screen.getByRole("button", { name: "dark" }));

    await waitFor(() => expect(themeSnapshots).toContain("dark:dark"));
    expect(themeSnapshots).not.toContain("dark:light");
  });

  it("persists terminal font size preferences with bounds", async () => {
    window.localStorage.removeItem("online-ssh-terminal-font-size");
    installMatchMedia(false);
    const user = userEvent.setup();

    render(
      <PreferencesProvider>
        <ThemeProbe />
      </PreferencesProvider>
    );

    expect(screen.getByTestId("terminal-font-size")).toHaveTextContent("13");

    await user.click(screen.getByRole("button", { name: "font 16" }));

    expect(screen.getByTestId("terminal-font-size")).toHaveTextContent("16");
    expect(window.localStorage.getItem("online-ssh-terminal-font-size")).toBe("16");
  });

  it("persists terminal theme preferences", async () => {
    window.localStorage.removeItem("online-ssh-terminal-theme");
    installMatchMedia(false);
    const user = userEvent.setup();

    render(
      <PreferencesProvider>
        <ThemeProbe />
      </PreferencesProvider>
    );

    expect(screen.getByTestId("terminal-theme")).toHaveTextContent("system");

    await user.click(screen.getByRole("button", { name: "theme dracula" }));

    expect(screen.getByTestId("terminal-theme")).toHaveTextContent("dracula");
    expect(window.localStorage.getItem("online-ssh-terminal-theme")).toBe("dracula");
  });

  it("persists default remote path preferences", async () => {
    window.localStorage.removeItem("online-ssh-files-default-path");
    window.localStorage.removeItem("online-ssh-terminal-default-path");
    installMatchMedia(false);
    const user = userEvent.setup();

    render(
      <PreferencesProvider>
        <ThemeProbe />
      </PreferencesProvider>
    );

    expect(screen.getByTestId("files-default-path")).toHaveTextContent("home:");
    expect(screen.getByTestId("terminal-default-path")).toHaveTextContent("home:");

    await user.click(screen.getByRole("button", { name: "files custom path" }));
    await user.click(screen.getByRole("button", { name: "terminal root path" }));

    expect(screen.getByTestId("files-default-path")).toHaveTextContent("custom:/srv/app");
    expect(screen.getByTestId("terminal-default-path")).toHaveTextContent("root:");
    expect(JSON.parse(window.localStorage.getItem("online-ssh-files-default-path") || "{}")).toEqual({
      mode: "custom",
      customPath: "/srv/app"
    });
    expect(JSON.parse(window.localStorage.getItem("online-ssh-terminal-default-path") || "{}")).toEqual({
      mode: "root",
      customPath: ""
    });
  });

  it("persists versioned terminal highlight preferences", async () => {
    window.localStorage.removeItem("online-ssh-terminal-highlighting");
    installMatchMedia(false);
    const user = userEvent.setup();

    render(
      <PreferencesProvider>
        <ThemeProbe />
      </PreferencesProvider>
    );

    expect(screen.getByTestId("terminal-highlight-enabled")).toHaveTextContent("true");

    await user.click(screen.getByRole("button", { name: "configure highlights" }));

    expect(screen.getByTestId("terminal-highlight-enabled")).toHaveTextContent("false");
    expect(screen.getByTestId("terminal-highlight-custom-count")).toHaveTextContent("1");
    expect(JSON.parse(window.localStorage.getItem("online-ssh-terminal-highlighting") || "{}")).toMatchObject({
      version: 1,
      enabled: false,
      builtinRules: {
        error: {
          enabled: false,
          backgroundColor: "#4c0519"
        }
      },
      customRules: [
        {
          id: "custom-trace",
          name: "Trace ID",
          matchType: "regex",
          pattern: "trace-[0-9]+"
        }
      ]
    });
  });
});
