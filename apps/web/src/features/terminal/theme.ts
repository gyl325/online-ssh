const terminalThemeTokenNames = {
  background: "--xterm-background",
  foreground: "--xterm-foreground",
  cursor: "--xterm-cursor",
  selectionBackground: "--xterm-selection-background",
  selectionForeground: "--xterm-selection-foreground",
  black: "--xterm-black",
  red: "--xterm-red",
  green: "--xterm-green",
  yellow: "--xterm-yellow",
  blue: "--xterm-blue",
  magenta: "--xterm-magenta",
  cyan: "--xterm-cyan",
  white: "--xterm-white",
  brightBlack: "--xterm-bright-black",
  brightRed: "--xterm-bright-red",
  brightGreen: "--xterm-bright-green",
  brightYellow: "--xterm-bright-yellow",
  brightBlue: "--xterm-bright-blue",
  brightMagenta: "--xterm-bright-magenta",
  brightCyan: "--xterm-bright-cyan",
  brightWhite: "--xterm-bright-white"
} as const;

type TerminalThemeKey = keyof typeof terminalThemeTokenNames;
export type TerminalTheme = Record<TerminalThemeKey, string>;
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

export const terminalFontFamily =
  '"Cascadia Mono", "Cascadia Code", "JetBrains Mono", "Consolas", "SFMono-Regular", "IBM Plex Mono", monospace';

export const terminalThemeOptions: Array<{ label: string; value: TerminalThemePreference }> = [
  { label: "跟随界面 / System", value: "system" },
  { label: "Dracula", value: "dracula" },
  { label: "Solarized Dark", value: "solarized-dark" },
  { label: "Solarized Light", value: "solarized-light" },
  { label: "One Half Dark", value: "one-half-dark" },
  { label: "One Half Light", value: "one-half-light" },
  { label: "Tomorrow Night", value: "tomorrow-night" },
  { label: "Gruvbox Dark", value: "gruvbox-dark" },
  { label: "Monokai Vivid", value: "monokai-vivid" },
  { label: "GitHub", value: "github" },
  { label: "Ayu", value: "ayu" }
];

const ecosystemTerminalThemes: Record<Exclude<TerminalThemePreference, "system">, TerminalTheme> = {
  "dracula": {
    foreground: "#f8f8f2",
    background: "#1e1f29",
    cursor: "#bbbbbb",
    selectionBackground: "#44475a",
    selectionForeground: "#ffffff",
    black: "#000000",
    brightBlack: "#555555",
    red: "#ff5555",
    brightRed: "#ff5555",
    green: "#50fa7b",
    brightGreen: "#50fa7b",
    yellow: "#f1fa8c",
    brightYellow: "#f1fa8c",
    blue: "#bd93f9",
    brightBlue: "#bd93f9",
    magenta: "#ff79c6",
    brightMagenta: "#ff79c6",
    cyan: "#8be9fd",
    brightCyan: "#8be9fd",
    white: "#bbbbbb",
    brightWhite: "#ffffff"
  },
  "solarized-dark": {
    foreground: "#708284",
    background: "#001e27",
    cursor: "#708284",
    selectionBackground: "#174652",
    selectionForeground: "#fcf4dc",
    black: "#002831",
    brightBlack: "#001e27",
    red: "#d11c24",
    brightRed: "#bd3613",
    green: "#738a05",
    brightGreen: "#475b62",
    yellow: "#a57706",
    brightYellow: "#536870",
    blue: "#2176c7",
    brightBlue: "#708284",
    magenta: "#c61c6f",
    brightMagenta: "#5956ba",
    cyan: "#259286",
    brightCyan: "#819090",
    white: "#eae3cb",
    brightWhite: "#fcf4dc"
  },
  "solarized-light": {
    foreground: "#536870",
    background: "#fcf4dc",
    cursor: "#536870",
    selectionBackground: "#2176c7",
    selectionForeground: "#ffffff",
    black: "#002831",
    brightBlack: "#001e27",
    red: "#d11c24",
    brightRed: "#bd3613",
    green: "#738a05",
    brightGreen: "#475b62",
    yellow: "#a57706",
    brightYellow: "#536870",
    blue: "#2176c7",
    brightBlue: "#708284",
    magenta: "#c61c6f",
    brightMagenta: "#5956ba",
    cyan: "#259286",
    brightCyan: "#819090",
    white: "#eae3cb",
    brightWhite: "#fcf4dc"
  },
  "one-half-dark": {
    foreground: "#dcdfe4",
    background: "#282c34",
    cursor: "#a3b3cc",
    selectionBackground: "#4b5263",
    selectionForeground: "#ffffff",
    black: "#282c34",
    brightBlack: "#282c34",
    red: "#e06c75",
    brightRed: "#e06c75",
    green: "#98c379",
    brightGreen: "#98c379",
    yellow: "#e5c07b",
    brightYellow: "#e5c07b",
    blue: "#61afef",
    brightBlue: "#61afef",
    magenta: "#c678dd",
    brightMagenta: "#c678dd",
    cyan: "#56b6c2",
    brightCyan: "#56b6c2",
    white: "#dcdfe4",
    brightWhite: "#dcdfe4"
  },
  "one-half-light": {
    foreground: "#383a42",
    background: "#fafafa",
    cursor: "#bfceff",
    selectionBackground: "#0184bc",
    selectionForeground: "#ffffff",
    black: "#383a42",
    brightBlack: "#4f525e",
    red: "#e45649",
    brightRed: "#e06c75",
    green: "#50a14f",
    brightGreen: "#98c379",
    yellow: "#c18401",
    brightYellow: "#e5c07b",
    blue: "#0184bc",
    brightBlue: "#61afef",
    magenta: "#a626a4",
    brightMagenta: "#c678dd",
    cyan: "#0997b3",
    brightCyan: "#56b6c2",
    white: "#fafafa",
    brightWhite: "#ffffff"
  },
  "tomorrow-night": {
    foreground: "#c5c8c6",
    background: "#1d1f21",
    cursor: "#c5c8c6",
    selectionBackground: "#373b41",
    selectionForeground: "#ffffff",
    black: "#000000",
    brightBlack: "#000000",
    red: "#cc6666",
    brightRed: "#cc6666",
    green: "#b5bd68",
    brightGreen: "#b5bd68",
    yellow: "#f0c674",
    brightYellow: "#f0c674",
    blue: "#81a2be",
    brightBlue: "#81a2be",
    magenta: "#b294bb",
    brightMagenta: "#b294bb",
    cyan: "#8abeb7",
    brightCyan: "#8abeb7",
    white: "#ffffff",
    brightWhite: "#ffffff"
  },
  "gruvbox-dark": {
    foreground: "#e6d4a3",
    background: "#1e1e1e",
    cursor: "#bbbbbb",
    selectionBackground: "#665c54",
    selectionForeground: "#fbf1c7",
    black: "#161819",
    brightBlack: "#7f7061",
    red: "#f73028",
    brightRed: "#be0f17",
    green: "#aab01e",
    brightGreen: "#868715",
    yellow: "#f7b125",
    brightYellow: "#cc881a",
    blue: "#719586",
    brightBlue: "#377375",
    magenta: "#c77089",
    brightMagenta: "#a04b73",
    cyan: "#7db669",
    brightCyan: "#578e57",
    white: "#faefbb",
    brightWhite: "#e6d4a3"
  },
  "monokai-vivid": {
    foreground: "#f9f9f9",
    background: "#121212",
    cursor: "#fb0007",
    selectionBackground: "#49483e",
    selectionForeground: "#ffffff",
    black: "#121212",
    brightBlack: "#838383",
    red: "#fa2934",
    brightRed: "#f6669d",
    green: "#98e123",
    brightGreen: "#b1e05f",
    yellow: "#fff30a",
    brightYellow: "#fff26d",
    blue: "#0443ff",
    brightBlue: "#0443ff",
    magenta: "#f800f8",
    brightMagenta: "#f200f6",
    cyan: "#01b6ed",
    brightCyan: "#51ceff",
    white: "#ffffff",
    brightWhite: "#ffffff"
  },
  "github": {
    foreground: "#3e3e3e",
    background: "#f4f4f4",
    cursor: "#3f3f3f",
    selectionBackground: "#0969da",
    selectionForeground: "#ffffff",
    black: "#3e3e3e",
    brightBlack: "#666666",
    red: "#970b16",
    brightRed: "#de0000",
    green: "#07962a",
    brightGreen: "#87d5a2",
    yellow: "#f8eec7",
    brightYellow: "#f1d007",
    blue: "#003e8a",
    brightBlue: "#2e6cba",
    magenta: "#e94691",
    brightMagenta: "#ffa29f",
    cyan: "#89d1ec",
    brightCyan: "#1cfafe",
    white: "#ffffff",
    brightWhite: "#ffffff"
  },
  "ayu": {
    foreground: "#e6e1cf",
    background: "#0f1419",
    cursor: "#f29718",
    selectionBackground: "#253340",
    selectionForeground: "#ffffff",
    black: "#000000",
    brightBlack: "#323232",
    red: "#ff3333",
    brightRed: "#ff6565",
    green: "#b8cc52",
    brightGreen: "#eafe84",
    yellow: "#e7c547",
    brightYellow: "#fff779",
    blue: "#36a3d9",
    brightBlue: "#68d5ff",
    magenta: "#f07178",
    brightMagenta: "#ffa3aa",
    cyan: "#95e6cb",
    brightCyan: "#c7fffd",
    white: "#ffffff",
    brightWhite: "#ffffff"
  }
};

export function isTerminalThemePreference(value: string | null | undefined): value is TerminalThemePreference {
  return value === "system" || Object.prototype.hasOwnProperty.call(ecosystemTerminalThemes, value || "");
}

export function terminalThemeLabel(value: TerminalThemePreference) {
  return terminalThemeOptions.find((item) => item.value === value)?.label || value;
}

const terminalThemeFallbacks: Record<"dark" | "light", TerminalTheme> = {
  dark: {
    background: "#0e1425",
    foreground: "#f4efe7",
    cursor: "#f6a96b",
    selectionBackground: "#193253",
    selectionForeground: "#ffffff",
    black: "#111825",
    red: "#ef7d57",
    green: "#8bd49c",
    yellow: "#f4b860",
    blue: "#6fa8ff",
    magenta: "#cf8fff",
    cyan: "#78dce8",
    white: "#f4efe7",
    brightBlack: "#4f5d75",
    brightRed: "#ff9f80",
    brightGreen: "#b4f1bf",
    brightYellow: "#ffd48b",
    brightBlue: "#9dc0ff",
    brightMagenta: "#e2bbff",
    brightCyan: "#acf0ff",
    brightWhite: "#ffffff"
  },
  light: {
    background: "#f8fafc",
    foreground: "#1f2937",
    cursor: "#d97706",
    selectionBackground: "#2563eb",
    selectionForeground: "#ffffff",
    black: "#111827",
    red: "#dc2626",
    green: "#15803d",
    yellow: "#b45309",
    blue: "#2563eb",
    magenta: "#7c3aed",
    cyan: "#0891b2",
    white: "#4b5563",
    brightBlack: "#6b7280",
    brightRed: "#ef4444",
    brightGreen: "#16a34a",
    brightYellow: "#d97706",
    brightBlue: "#3b82f6",
    brightMagenta: "#8b5cf6",
    brightCyan: "#06b6d4",
    brightWhite: "#111827"
  }
};

function terminalBackgroundLuminance(background: string) {
  const normalized = background.trim();
  const match = /^#([0-9a-fA-F]{6})$/.exec(normalized);
  if (!match) {
    return 0;
  }

  const channels = [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function terminalThemeTone(theme: TerminalTheme): "dark" | "light" {
  return terminalBackgroundLuminance(theme.background) < 0.5 ? "dark" : "light";
}

export function terminalThemeFor(appTheme: "dark" | "light", preference: TerminalThemePreference = "system"): TerminalTheme {
  if (preference !== "system") {
    return ecosystemTerminalThemes[preference];
  }

  const fallback = terminalThemeFallbacks[appTheme];
  const computedStyle =
    typeof window === "undefined" || typeof document === "undefined"
      ? null
      : window.getComputedStyle(document.documentElement);

  return (Object.keys(terminalThemeTokenNames) as TerminalThemeKey[]).reduce<TerminalTheme>((theme, key) => {
    const tokenName = terminalThemeTokenNames[key];
    const tokenValue = computedStyle?.getPropertyValue(tokenName).trim();
    theme[key] = tokenValue || fallback[key];
    return theme;
  }, {} as TerminalTheme);
}
