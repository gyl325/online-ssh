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

export type TerminalHighlightValidationCode =
  | "EMPTY_PATTERN"
  | "PATTERN_TOO_LONG"
  | "INVALID_REGEX"
  | "COMPLEX_REGEX"
  | "ENABLED_RULE_LIMIT";

export type TerminalHighlightValidationIssue = {
  code: TerminalHighlightValidationCode;
  ruleId: string;
  message: string;
};

export type CompiledTerminalHighlightRule = TerminalHighlightCustomRule & {
  order: number;
  regex?: RegExp;
  keywords?: string[];
};

export type TerminalHighlightMatch = {
  ruleId: string;
  name: string;
  start: number;
  end: number;
  foregroundColor: string;
  backgroundColor: string;
  priority: number;
};

export const terminalHighlightStorageKey = "online-ssh-terminal-highlighting";
export const terminalHighlightPreferencesVersion = 1;
export const maxTerminalHighlightPatternLength = 160;
export const maxTerminalHighlightCustomRules = 50;
export const maxTerminalHighlightEnabledRules = 40;
export const maxTerminalHighlightLineLength = 1000;
export const maxTerminalHighlightScanLines = 80;
export const transparentTerminalHighlightBackground = "transparent";

const colorPattern = /^#[0-9a-fA-F]{6}$/;

export const builtinTerminalHighlightRules: TerminalHighlightCustomRule[] = [
  {
    id: "error",
    name: "Error",
    enabled: true,
    matchType: "keyword",
    pattern: "error\nfailed\nexception\nfatal\ndenied\nrefused",
    caseSensitive: false,
    foregroundColor: "#b91c1c",
    backgroundColor: transparentTerminalHighlightBackground,
    priority: 100
  },
  {
    id: "warning",
    name: "Warning",
    enabled: true,
    matchType: "keyword",
    pattern: "warn\nwarning\ndeprecated",
    caseSensitive: false,
    foregroundColor: "#92400e",
    backgroundColor: transparentTerminalHighlightBackground,
    priority: 80
  },
  {
    id: "ok",
    name: "OK",
    enabled: true,
    matchType: "keyword",
    pattern: "ok\nsuccess\ndone\ncompleted",
    caseSensitive: false,
    foregroundColor: "#166534",
    backgroundColor: transparentTerminalHighlightBackground,
    priority: 60
  },
  {
    id: "info",
    name: "Info",
    enabled: true,
    matchType: "keyword",
    pattern: "info",
    caseSensitive: false,
    foregroundColor: "#0e7490",
    backgroundColor: transparentTerminalHighlightBackground,
    priority: 40
  },
  {
    id: "debug",
    name: "Debug",
    enabled: true,
    matchType: "keyword",
    pattern: "debug",
    caseSensitive: false,
    foregroundColor: "#4b5563",
    backgroundColor: transparentTerminalHighlightBackground,
    priority: 20
  },
  {
    id: "ip-address",
    name: "IP address",
    enabled: true,
    matchType: "regex",
    pattern: String.raw`\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b`,
    caseSensitive: false,
    foregroundColor: "#1d4ed8",
    backgroundColor: transparentTerminalHighlightBackground,
    priority: 30
  },
  {
    id: "mac-address",
    name: "MAC address",
    enabled: true,
    matchType: "regex",
    pattern: String.raw`\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b`,
    caseSensitive: false,
    foregroundColor: "#6d28d9",
    backgroundColor: transparentTerminalHighlightBackground,
    priority: 30
  }
];

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

function isSuspiciousRegex(pattern: string) {
  return /\([^)]*[*+][^)]*\)\s*[*+?{]/.test(pattern);
}

export function validateTerminalHighlightRule(rule: TerminalHighlightCustomRule): TerminalHighlightValidationIssue[] {
  const issues: TerminalHighlightValidationIssue[] = [];
  const pattern = rule.pattern.trim();
  if (!pattern) {
    issues.push({
      code: "EMPTY_PATTERN",
      ruleId: rule.id,
      message: "Pattern cannot be empty."
    });
    return issues;
  }
  if (pattern.length > maxTerminalHighlightPatternLength) {
    issues.push({
      code: "PATTERN_TOO_LONG",
      ruleId: rule.id,
      message: `Pattern cannot exceed ${maxTerminalHighlightPatternLength} characters.`
    });
  }
  if (rule.matchType === "regex") {
    if (isSuspiciousRegex(pattern)) {
      issues.push({
        code: "COMPLEX_REGEX",
        ruleId: rule.id,
        message: "This regex may cause slow matching in the browser."
      });
    }
    try {
      void new RegExp(pattern, rule.caseSensitive ? "g" : "gi");
    } catch {
      issues.push({
        code: "INVALID_REGEX",
        ruleId: rule.id,
        message: "Regex pattern is invalid."
      });
    }
  }
  return issues;
}

function splitKeywordPattern(pattern: string) {
  return pattern
    .split(/[\n,]+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function compileRule(rule: TerminalHighlightCustomRule, order: number): CompiledTerminalHighlightRule | null {
  const pattern = rule.pattern.trim();
  if (rule.matchType === "regex") {
    return {
      ...rule,
      pattern,
      order,
      regex: new RegExp(pattern, rule.caseSensitive ? "g" : "gi")
    };
  }
  return {
    ...rule,
    pattern,
    order,
    keywords: splitKeywordPattern(pattern)
  };
}

function hasBlockingIssue(issues: TerminalHighlightValidationIssue[]) {
  return issues.some((issue) =>
    issue.code === "EMPTY_PATTERN" ||
    issue.code === "PATTERN_TOO_LONG" ||
    issue.code === "INVALID_REGEX" ||
    issue.code === "COMPLEX_REGEX"
  );
}

export function buildTerminalHighlightRules(preferences: TerminalHighlightPreferences): {
  issues: TerminalHighlightValidationIssue[];
  rules: CompiledTerminalHighlightRule[];
} {
  const normalized = normalizeTerminalHighlightPreferences(preferences);
  const issues: TerminalHighlightValidationIssue[] = [];
  const rules: CompiledTerminalHighlightRule[] = [];
  let order = 0;

  if (!normalized.enabled) {
    return { issues, rules };
  }

  const candidates = [
    ...builtinTerminalHighlightRules.map((rule) => {
      const override = normalized.builtinRules[rule.id] || {};
      return {
        ...rule,
        enabled: override.enabled ?? rule.enabled,
        foregroundColor: override.foregroundColor || rule.foregroundColor,
        backgroundColor: override.backgroundColor || rule.backgroundColor,
        priority: override.priority ?? rule.priority
      };
    }),
    ...normalized.customRules
  ];

  for (const candidate of candidates) {
    if (!candidate.enabled) {
      continue;
    }
    if (rules.length >= maxTerminalHighlightEnabledRules) {
      issues.push({
        code: "ENABLED_RULE_LIMIT",
        ruleId: candidate.id,
        message: `Only ${maxTerminalHighlightEnabledRules} enabled highlight rules are scanned.`
      });
      continue;
    }

    const candidateIssues = validateTerminalHighlightRule(candidate);
    issues.push(...candidateIssues);
    if (hasBlockingIssue(candidateIssues)) {
      continue;
    }

    const compiled = compileRule(candidate, order++);
    if (compiled) {
      rules.push(compiled);
    }
  }

  return { issues, rules };
}

function collectKeywordMatches(line: string, rule: CompiledTerminalHighlightRule): TerminalHighlightMatch[] {
  const source = rule.caseSensitive ? line : line.toLocaleLowerCase();
  return (rule.keywords || []).flatMap((keyword) => {
    const needle = rule.caseSensitive ? keyword : keyword.toLocaleLowerCase();
    const matches: TerminalHighlightMatch[] = [];
    let index = source.indexOf(needle);
    while (index >= 0) {
      const end = index + needle.length;
      if (isIndependentKeywordToken(line, keyword, index, end)) {
        matches.push({
          ruleId: rule.id,
          name: rule.name,
          start: index,
          end,
          foregroundColor: rule.foregroundColor,
          backgroundColor: rule.backgroundColor,
          priority: rule.priority
        });
      }
      index = source.indexOf(needle, index + Math.max(needle.length, 1));
    }
    return matches;
  });
}

function isAsciiTokenCharacter(value: string) {
  return /^[A-Za-z0-9_-]$/.test(value);
}

function isIndependentKeywordToken(line: string, keyword: string, start: number, end: number) {
  const first = keyword[0] || "";
  const last = keyword[keyword.length - 1] || "";
  const hasLeftBoundary = start <= 0 || !isAsciiTokenCharacter(first) || !isAsciiTokenCharacter(line[start - 1] || "");
  const hasRightBoundary = end >= line.length || !isAsciiTokenCharacter(last) || !isAsciiTokenCharacter(line[end] || "");
  return hasLeftBoundary && hasRightBoundary;
}

function collectRegexMatches(line: string, rule: CompiledTerminalHighlightRule): TerminalHighlightMatch[] {
  if (!rule.regex) {
    return [];
  }

  const matches: TerminalHighlightMatch[] = [];
  rule.regex.lastIndex = 0;
  let match: RegExpExecArray | null = rule.regex.exec(line);
  while (match) {
    const text = match[0];
    if (text.length === 0) {
      rule.regex.lastIndex += 1;
    } else {
      matches.push({
        ruleId: rule.id,
        name: rule.name,
        start: match.index,
        end: match.index + text.length,
        foregroundColor: rule.foregroundColor,
        backgroundColor: rule.backgroundColor,
        priority: rule.priority
      });
    }
    match = rule.regex.exec(line);
  }
  return matches;
}

function rangesOverlap(occupied: boolean[], start: number, end: number) {
  for (let index = start; index < end; index += 1) {
    if (occupied[index]) {
      return true;
    }
  }
  return false;
}

function occupyRange(occupied: boolean[], start: number, end: number) {
  for (let index = start; index < end; index += 1) {
    occupied[index] = true;
  }
}

export function scanTerminalLine(
  lineText: string,
  rules: CompiledTerminalHighlightRule[],
  options: { maxLineLength?: number } = {}
): TerminalHighlightMatch[] {
  const maxLineLength = options.maxLineLength ?? maxTerminalHighlightLineLength;
  const line = lineText.slice(0, maxLineLength);
  const candidates = rules.flatMap((rule) =>
    rule.matchType === "regex" ? collectRegexMatches(line, rule) : collectKeywordMatches(line, rule)
  );
  const orderByRuleId = new Map(rules.map((rule) => [rule.id, rule.order]));

  const occupied: boolean[] = [];
  const selected: TerminalHighlightMatch[] = [];
  for (const candidate of candidates.sort((left, right) => {
    const priorityDelta = right.priority - left.priority;
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    const lengthDelta = (right.end - right.start) - (left.end - left.start);
    if (lengthDelta !== 0) {
      return lengthDelta;
    }
    return (orderByRuleId.get(left.ruleId) || 0) - (orderByRuleId.get(right.ruleId) || 0);
  })) {
    if (candidate.start < 0 || candidate.end <= candidate.start || candidate.end > line.length) {
      continue;
    }
    if (rangesOverlap(occupied, candidate.start, candidate.end)) {
      continue;
    }
    occupyRange(occupied, candidate.start, candidate.end);
    selected.push(candidate);
  }

  return selected.sort((left, right) => left.start - right.start || right.priority - left.priority);
}
