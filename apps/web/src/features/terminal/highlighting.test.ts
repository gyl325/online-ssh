import { describe, expect, it } from "vitest";

import {
  buildTerminalHighlightRules,
  builtinTerminalHighlightRules,
  defaultTerminalHighlightPreferences,
  maxTerminalHighlightEnabledRules,
  maxTerminalHighlightLineLength,
  scanTerminalLine,
  validateTerminalHighlightRule,
  type TerminalHighlightCustomRule,
  type TerminalHighlightPreferences
} from "./highlighting";

function customRule(overrides: Partial<TerminalHighlightCustomRule>): TerminalHighlightCustomRule {
  return {
    id: overrides.id || "custom-1",
    name: overrides.name || "Custom",
    enabled: overrides.enabled ?? true,
    matchType: overrides.matchType || "keyword",
    pattern: overrides.pattern || "error",
    caseSensitive: overrides.caseSensitive ?? false,
    foregroundColor: overrides.foregroundColor || "#ffffff",
    backgroundColor: overrides.backgroundColor || "#7f1d1d",
    priority: overrides.priority ?? 10
  };
}

function preferences(customRules: TerminalHighlightCustomRule[]): TerminalHighlightPreferences {
  return {
    ...defaultTerminalHighlightPreferences,
    builtinRules: Object.fromEntries(builtinTerminalHighlightRules.map((rule) => [rule.id, { enabled: false }])),
    customRules,
    enabled: true
  };
}

function relativeLuminance(hexColor: string) {
  const channels = [1, 3, 5].map((offset) => parseInt(hexColor.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(left: string, right: string) {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("terminal keyword highlighting", () => {
  it("matches keyword rules without changing the source text", () => {
    const { rules, issues } = buildTerminalHighlightRules(preferences([
      customRule({ id: "kw-error", name: "Error keyword", pattern: "error" })
    ]));

    const matches = scanTerminalLine("fatal error: permission denied", rules);

    expect(issues).toEqual([]);
    expect(matches).toEqual([
      expect.objectContaining({
        ruleId: "kw-error",
        start: 6,
        end: 11,
        backgroundColor: "#7f1d1d"
      })
    ]);
  });

  it("matches regex rules including built-in IP address patterns", () => {
    const { rules, issues } = buildTerminalHighlightRules({
      ...defaultTerminalHighlightPreferences,
      enabled: true,
      builtinRules: {
        "ip-address": { enabled: true }
      },
      customRules: []
    });

    const matches = scanTerminalLine("connected from 192.168.1.20:22", rules);

    expect(issues).toEqual([]);
    expect(matches).toEqual([
      expect.objectContaining({
        ruleId: "ip-address",
        start: 15,
        end: 27
      })
    ]);
  });

  it("uses transparent backgrounds for built-in highlight rules by default", () => {
    const { rules } = buildTerminalHighlightRules(defaultTerminalHighlightPreferences);

    const matches = scanTerminalLine("error warning success info debug 192.168.1.20 00:1A:2B:3C:4D:5E", rules);

    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "error", backgroundColor: "transparent" }),
        expect.objectContaining({ ruleId: "warning", backgroundColor: "transparent" }),
        expect.objectContaining({ ruleId: "ok", backgroundColor: "transparent" }),
        expect.objectContaining({ ruleId: "info", backgroundColor: "transparent" }),
        expect.objectContaining({ ruleId: "debug", backgroundColor: "transparent" }),
        expect.objectContaining({ ruleId: "ip-address", backgroundColor: "transparent" }),
        expect.objectContaining({ ruleId: "mac-address", backgroundColor: "transparent" })
      ])
    );
  });

  it("keeps built-in foreground colors readable on the light terminal background", () => {
    const { rules } = buildTerminalHighlightRules(defaultTerminalHighlightPreferences);
    const lightTerminalBackground = "#f8fafc";

    for (const rule of rules) {
      expect(
        contrastRatio(rule.foregroundColor, lightTerminalBackground),
        `${rule.id} foreground ${rule.foregroundColor} should contrast with ${lightTerminalBackground}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("respects case-sensitive matching", () => {
    const { rules } = buildTerminalHighlightRules(preferences([
      customRule({
        id: "done-sensitive",
        name: "Done sensitive",
        pattern: "Done",
        caseSensitive: true
      })
    ]));

    expect(scanTerminalLine("done Done DONE", rules)).toEqual([
      expect.objectContaining({
        ruleId: "done-sensitive",
        start: 5,
        end: 9
      })
    ]);
  });

  it("uses higher priority rules for overlapping ranges", () => {
    const { rules } = buildTerminalHighlightRules(preferences([
      customRule({
        id: "low-error",
        name: "Low error",
        pattern: "error",
        backgroundColor: "#111111",
        priority: 1
      }),
      customRule({
        id: "high-error-code",
        name: "High error code",
        matchType: "regex",
        pattern: "error code",
        backgroundColor: "#222222",
        priority: 100
      })
    ]));

    const matches = scanTerminalLine("error code 255", rules);

    expect(matches).toEqual([
      expect.objectContaining({
        ruleId: "high-error-code",
        start: 0,
        end: 10,
        backgroundColor: "#222222"
      })
    ]);
  });

  it("drops lower priority partial overlaps but keeps later non-overlapping matches", () => {
    const { rules } = buildTerminalHighlightRules(preferences([
      customRule({ id: "warn", name: "Warn", pattern: "warn", priority: 1 }),
      customRule({ id: "warning", name: "Warning", pattern: "warning", priority: 20 })
    ]));

    const matches = scanTerminalLine("warning warn", rules);

    expect(matches.map((match) => [match.ruleId, match.start, match.end])).toEqual([
      ["warning", 0, 7],
      ["warn", 8, 12]
    ]);
  });

  it("captures invalid regex rules and excludes them from scanning", () => {
    const { rules, issues } = buildTerminalHighlightRules(preferences([
      customRule({
        id: "bad-regex",
        name: "Broken regex",
        matchType: "regex",
        pattern: "["
      })
    ]));

    expect(rules).toEqual([]);
    expect(issues).toEqual([
      expect.objectContaining({
        ruleId: "bad-regex",
        code: "INVALID_REGEX"
      })
    ]);
  });

  it("ignores disabled rules", () => {
    const { rules } = buildTerminalHighlightRules(preferences([
      customRule({ id: "disabled-error", enabled: false, pattern: "error" })
    ]));

    expect(scanTerminalLine("error", rules)).toEqual([]);
  });

  it("limits enabled rules and scan length to protect terminal rendering", () => {
    const manyRules = Array.from({ length: maxTerminalHighlightEnabledRules + 5 }, (_, index) =>
      customRule({
        id: `rule-${index}`,
        name: `Rule ${index}`,
        pattern: `needle-${index}`,
        priority: index
      })
    );

    const { rules, issues } = buildTerminalHighlightRules(preferences(manyRules));
    const longLine = `${"x".repeat(maxTerminalHighlightLineLength)} needle-${manyRules.length - 1}`;

    expect(rules).toHaveLength(maxTerminalHighlightEnabledRules);
    expect(issues).toContainEqual(expect.objectContaining({ code: "ENABLED_RULE_LIMIT" }));
    expect(scanTerminalLine(longLine, rules)).toEqual([]);
  });

  it("warns for empty, too long, and suspiciously complex regex patterns", () => {
    expect(validateTerminalHighlightRule(customRule({ id: "empty", pattern: "  " }))).toContainEqual(
      expect.objectContaining({ code: "EMPTY_PATTERN" })
    );
    expect(validateTerminalHighlightRule(customRule({ id: "long", pattern: "x".repeat(200) }))).toContainEqual(
      expect.objectContaining({ code: "PATTERN_TOO_LONG" })
    );
    expect(
      validateTerminalHighlightRule(customRule({
        id: "complex",
        matchType: "regex",
        pattern: "(a+)+$"
      }))
    ).toContainEqual(expect.objectContaining({ code: "COMPLEX_REGEX" }));
  });
});
