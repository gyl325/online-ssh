export type TerminalThemePreference =
  | "system"
  | "dracula"
  | "solarized-dark"
  | "solarized-light"
  | "one-half-dark"
  | "one-half-light"
  | "tomorrow-night"
  | "gruvbox-dark"
  | "monokai-vivid"
  | "github"
  | "ayu";

const terminalThemePreferenceValues = new Set<TerminalThemePreference>([
  "system",
  "dracula",
  "solarized-dark",
  "solarized-light",
  "one-half-dark",
  "one-half-light",
  "tomorrow-night",
  "gruvbox-dark",
  "monokai-vivid",
  "github",
  "ayu"
]);

export function isTerminalThemePreference(value: string | null | undefined): value is TerminalThemePreference {
  return terminalThemePreferenceValues.has(value as TerminalThemePreference);
}
