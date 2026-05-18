export type TerminalHighlightMatchType = "keyword" | "regex";

export type TerminalHighlightRuleColorOverride = {
  enabled?: boolean;
  foregroundColor?: string;
  backgroundColor?: string;
  priority?: number;
};

export type TerminalHighlightCustomRule = {
  id: string;
  name: string;
  enabled: boolean;
  matchType: TerminalHighlightMatchType;
  pattern: string;
  caseSensitive: boolean;
  foregroundColor: string;
  backgroundColor: string;
  priority: number;
};

export type TerminalHighlightPreferences = {
  version: 1;
  enabled: boolean;
  builtinRules: Record<string, TerminalHighlightRuleColorOverride>;
  customRules: TerminalHighlightCustomRule[];
};

export const terminalHighlightStorageKey = "online-ssh-terminal-highlighting";
export const terminalHighlightPreferencesVersion = 1;
export const maxTerminalHighlightCustomRules = 50;
export const transparentTerminalHighlightBackground = "transparent";

const colorPattern = /^#[0-9a-fA-F]{6}$/;

export const defaultTerminalHighlightPreferences: TerminalHighlightPreferences = {
  version: terminalHighlightPreferencesVersion,
  enabled: true,
  builtinRules: {},
  customRules: []
};

function normalizeColor(value: unknown, fallback: string) {
  return typeof value === "string" && colorPattern.test(value) ? value.toLowerCase() : fallback;
}

function normalizeBackgroundColor(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === transparentTerminalHighlightBackground) {
    return transparentTerminalHighlightBackground;
  }
  return colorPattern.test(normalized) ? normalized : fallback;
}

function normalizePriority(value: unknown, fallback: number) {
  const priority = Number(value);
  if (!Number.isFinite(priority)) {
    return fallback;
  }
  return Math.max(-999, Math.min(999, Math.round(priority)));
}

function normalizeCustomRule(value: unknown, fallbackIndex: number): TerminalHighlightCustomRule | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<TerminalHighlightCustomRule>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `custom-${fallbackIndex}`;
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : "Custom";
  const pattern = typeof record.pattern === "string" ? record.pattern : "";
  return {
    id,
    name,
    enabled: record.enabled !== false,
    matchType: record.matchType === "regex" ? "regex" : "keyword",
    pattern,
    caseSensitive: record.caseSensitive === true,
    foregroundColor: normalizeColor(record.foregroundColor, "#ffffff"),
    backgroundColor: normalizeBackgroundColor(record.backgroundColor, transparentTerminalHighlightBackground),
    priority: normalizePriority(record.priority, 10)
  };
}

export function normalizeTerminalHighlightPreferences(value: unknown): TerminalHighlightPreferences {
  if (!value || typeof value !== "object") {
    return defaultTerminalHighlightPreferences;
  }

  const record = value as Partial<TerminalHighlightPreferences>;
  const builtinRules: Record<string, TerminalHighlightRuleColorOverride> = {};
  if (record.builtinRules && typeof record.builtinRules === "object") {
    for (const [ruleId, override] of Object.entries(record.builtinRules)) {
      if (!override || typeof override !== "object") {
        continue;
      }
      builtinRules[ruleId] = {
        enabled: override.enabled,
        foregroundColor: normalizeColor(override.foregroundColor, ""),
        backgroundColor: normalizeBackgroundColor(override.backgroundColor, ""),
        priority: typeof override.priority === "number" ? normalizePriority(override.priority, 0) : undefined
      };
      if (!builtinRules[ruleId].foregroundColor) {
        delete builtinRules[ruleId].foregroundColor;
      }
      if (!builtinRules[ruleId].backgroundColor) {
        delete builtinRules[ruleId].backgroundColor;
      }
    }
  }

  const customRules = Array.isArray(record.customRules)
    ? record.customRules
      .slice(0, maxTerminalHighlightCustomRules)
      .map((rule, index) => normalizeCustomRule(rule, index))
      .filter((rule): rule is TerminalHighlightCustomRule => Boolean(rule))
    : [];

  return {
    version: terminalHighlightPreferencesVersion,
    enabled: record.enabled !== false,
    builtinRules,
    customRules
  };
}
