import { describe, expect, it } from "vitest";

import stylesCss from "./styles.css?raw";

function getDefinedUiTokens(css: string) {
  return new Set(Array.from(css.matchAll(/(--ui-[a-z0-9-]+)\s*:/g), (match) => match[1]));
}

function getReferencedUiTokens(css: string) {
  return new Set(Array.from(css.matchAll(/var\(\s*(--ui-[a-z0-9-]+)/g), (match) => match[1]));
}

function getCssRule(css: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "s"))?.groups?.body || "";
}

describe("styles.css design tokens", () => {
  it("defines every referenced ui token", () => {
    const definedTokens = getDefinedUiTokens(stylesCss);
    const missingTokens = Array.from(getReferencedUiTokens(stylesCss))
      .filter((token) => !definedTokens.has(token))
      .sort();

    expect(missingTokens).toEqual([]);
  });

  it("exposes the P1-1a baseline token families", () => {
    const definedTokens = getDefinedUiTokens(stylesCss);
    const requiredTokens = [
      "--ui-space-1",
      "--ui-space-2",
      "--ui-space-3",
      "--ui-space-4",
      "--ui-space-5",
      "--ui-control-height-sm",
      "--ui-control-height-md",
      "--ui-control-height-lg",
      "--ui-control-icon-sm",
      "--ui-control-icon-md",
      "--ui-control-icon-lg",
      "--ui-card-bg",
      "--ui-card-border",
      "--ui-card-radius",
      "--ui-card-shadow",
      "--ui-overlay-bg",
      "--ui-duration-fast",
      "--ui-duration-base",
      "--ui-ease-standard",
      "--ui-z-dialog",
      "--ui-z-popover",
      "--ui-z-tooltip"
    ];

    expect(requiredTokens.filter((token) => !definedTokens.has(token))).toEqual([]);
  });
});

describe("styles.css legacy selector cleanup", () => {
  it("does not keep unused page layout selectors in the global stylesheet", () => {
    const unusedSelectors = [
      "admin-check-row",
      "admin-general-account-number-grid",
      "admin-general-actions",
      "admin-general-edit-note",
      "admin-role-active-row",
      "admin-row-main",
      "admin-row-meta",
      "admin-row-title",
      "auth-code-row",
      "audit-detail",
      "audit-layout",
      "audit-sidebar",
      "breadcrumb-chip",
      "breadcrumb-row",
      "credential-editor-panel",
      "credential-item",
      "credential-item-active",
      "credential-layout",
      "credential-list",
      "credential-list-panel",
      "files-breadcrumb-chip",
      "files-breadcrumb-label",
      "files-breadcrumb-row",
      "files-close-button",
      "files-detail",
      "files-nav-panel",
      "files-preview-kind-badge",
      "files-remote-empty",
      "files-remote-search-note",
      "files-upload-queue-track",
      "fingerprint-chip",
      "header-meta",
      "loading-spinner",
      "resource-filter-row",
      "resource-search-field",
      "result-card-compact",
      "result-card-success",
      "session-card",
      "session-label",
      "sidebar-footer",
      "status-pill",
      "terminal-host-panel",
      "terminal-ai-notes",
      "terminal-ai-prompt-card",
      "terminal-ai-raw-card",
      "terminal-ai-refusal-card",
      "terminal-ai-result-card",
      "terminal-ai-risk",
      "terminal-ai-risk-high",
      "terminal-ai-risk-low",
      "terminal-ai-risk-medium",
      "terminal-history-warning",
      "terminal-share-create-warning",
      "terminal-share-dialog-status",
      "terminal-share-dialog-status-countdown",
      "terminal-share-dialog-status-danger",
      "terminal-share-metric",
      "terminal-pane-actions-menu-danger",
      "terminal-tab-meta",
      "terminal-tab-split-member",
      "toggle-pill",
      "transfer-detail",
      "transfer-error-note",
      "transfer-filter-header",
      "transfer-layout",
      "transfer-sidebar",
      "user-center-highlight-card",
      "user-center-mfa-manual-secret",
      "user-center-mfa-status-row",
      "workspace-header"
    ];

    for (const selector of unusedSelectors) {
      expect(stylesCss).not.toMatch(new RegExp(`\\.${selector}(?![a-zA-Z0-9_-])`));
    }
  });
});

describe("files remote search styles", () => {
  it("does not keep remote result type label overrides after shared badge migration", () => {
    expect(stylesCss).not.toMatch(/\.files-remote-result\s+\.file-kind\s*\{/);
  });

  it("keeps result names aligned with the path text size", () => {
    expect(stylesCss).toMatch(/\.files-remote-result-name\s*\{[^}]*font-size:\s*0\.84rem;/s);
    expect(stylesCss).toMatch(/\.files-remote-result-path\s*\{[^}]*font-size:\s*0\.84rem;/s);
  });
});

describe("P2 page visual consistency", () => {
  it("keeps low-risk page card surfaces on the shared card tokens", () => {
    for (const selector of [
      ".user-center-card",
      ".terminal-share-password-form",
      ".terminal-share-viewer-placeholder"
    ]) {
      const rule = getCssRule(stylesCss, selector);
      expect(rule).toContain("border: 1px solid var(--ui-card-border);");
      expect(rule).toContain("border-radius: var(--ui-card-radius);");
      expect(rule).toContain("background: var(--ui-card-bg);");
    }
  });

  it("keeps terminal share password controls on the shared control height scale", () => {
    const rule = getCssRule(stylesCss, ".terminal-share-password-form .auth-input-group,\n.terminal-share-password-submit.ui-button");
    expect(rule).toContain("height: var(--ui-control-height-lg);");
    expect(rule).toContain("min-height: var(--ui-control-height-lg);");
  });
});
