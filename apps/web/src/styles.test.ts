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

function getCustomProperty(css: string, selector: string, property: string) {
  const rule = getCssRule(css, selector);
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return rule.match(new RegExp(`${escapedProperty}\\s*:\\s*(?<value>[^;]+);`))?.groups?.value.trim() || "";
}

function getHexHue(hex: string) {
  const normalized = hex.replace("#", "");
  const red = parseInt(normalized.slice(0, 2), 16) / 255;
  const green = parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  if (delta === 0) {
    return 0;
  }

  const hue = max === red
    ? ((green - blue) / delta) % 6
    : max === green
      ? (blue - red) / delta + 2
      : (red - green) / delta + 4;
  return (Math.round(hue * 60) + 360) % 360;
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
      "--ui-control-height-compact",
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

describe("styles.css calm workstation theme", () => {
  it("does not use orange as the primary accent in either app theme", () => {
    const darkAccent = getCustomProperty(stylesCss, ":root", "--ui-accent");
    const darkAccentStrong = getCustomProperty(stylesCss, ":root", "--ui-accent-strong");
    const lightAccent = getCustomProperty(stylesCss, ":root[data-theme=\"light\"]", "--ui-accent");
    const lightAccentStrong = getCustomProperty(stylesCss, ":root[data-theme=\"light\"]", "--ui-accent-strong");

    expect([darkAccent, darkAccentStrong, lightAccent, lightAccentStrong]).toEqual([
      expect.stringMatching(/^#[0-9a-f]{6}$/i),
      expect.stringMatching(/^#[0-9a-f]{6}$/i),
      expect.stringMatching(/^#[0-9a-f]{6}$/i),
      expect.stringMatching(/^#[0-9a-f]{6}$/i)
    ]);

    for (const value of [darkAccent, darkAccentStrong, lightAccent, lightAccentStrong]) {
      const hue = getHexHue(value);
      expect(hue < 20 || hue > 55).toBe(true);
    }
  });

  it("keeps toolbar filter controls on the compact density scale", () => {
    expect(getCustomProperty(stylesCss, ":root", "--ui-control-height-compact")).toBe("34px");
    expect(getCssRule(stylesCss, ".ui-filter-chip-md")).toContain("min-height: var(--ui-control-height-sm);");
    expect(getCssRule(stylesCss, ".ui-filter-chip-md")).toContain("font-size: 0.84rem;");

    const toolbarControlRule = getCssRule(
      stylesCss,
      ".host-filter-bar .ui-input,\n.host-filter-bar .ui-select,\n.ui-filter-bar .ui-input,\n.ui-filter-bar .ui-select"
    );
    expect(toolbarControlRule).toContain("min-height: var(--ui-control-height-compact);");
    expect(toolbarControlRule).toContain("font-size: 0.88rem;");
    expect(toolbarControlRule).toContain("padding-block: 0.38rem;");

    const dateRangeRule = getCssRule(stylesCss, ".ui-date-range-trigger");
    expect(dateRangeRule).toContain("min-height: var(--ui-control-height-compact);");
    expect(dateRangeRule).toContain("font-size: 0.88rem;");

    const toolbarButtonRule = getCssRule(stylesCss, ".ui-toolbar .ui-button-md,\n.resource-toolbar .ui-button-md");
    expect(toolbarButtonRule).toContain("min-height: var(--ui-control-height-compact);");
    expect(toolbarButtonRule).toContain("font-size: 0.88rem;");
  });

  it("keeps default dashboard and file upload affordances on the neutral accent scale", () => {
    const dashboardActionIconRule = getCssRule(stylesCss, ".dashboard-action-icon");
    expect(dashboardActionIconRule).toContain("border: 1px solid var(--ui-accent-border);");
    expect(dashboardActionIconRule).toContain("background: var(--ui-accent-soft);");
    expect(dashboardActionIconRule).toContain("color: var(--ui-accent-contrast);");
    expect(dashboardActionIconRule).not.toContain("var(--ui-warning");

    const dashboardRecentIconRule = getCssRule(stylesCss, ".dashboard-recent-icon");
    expect(dashboardRecentIconRule).toContain("border: 1px solid var(--ui-accent-border);");
    expect(dashboardRecentIconRule).toContain("background: var(--ui-accent-soft);");
    expect(dashboardRecentIconRule).toContain("color: var(--ui-accent-contrast);");
    expect(dashboardRecentIconRule).not.toContain("var(--ui-warning");

    const uploadDropzoneRule = getCssRule(stylesCss, ".files-upload-dropzone");
    expect(uploadDropzoneRule).toContain("border: 1px dashed var(--ui-accent-border);");
    expect(uploadDropzoneRule).toContain("background: color-mix(in srgb, var(--ui-accent) 6%, var(--ui-control-bg));");
    expect(uploadDropzoneRule).not.toContain("var(--ui-warning");
  });

  it("keeps file browser default directory icons on the neutral accent scale", () => {
    const listDirectoryIconRule = getCssRule(stylesCss, ".file-kind-directory");
    expect(listDirectoryIconRule).toContain("background: var(--ui-accent-soft);");
    expect(listDirectoryIconRule).toContain("color: var(--ui-accent-contrast);");
    expect(listDirectoryIconRule).not.toContain("var(--ui-warning");

    const gridDirectoryIconRule = getCssRule(stylesCss, ".files-grid-item-icon-directory");
    expect(gridDirectoryIconRule).toContain("background: var(--ui-accent-soft);");
    expect(gridDirectoryIconRule).toContain("color: var(--ui-accent-contrast);");
    expect(gridDirectoryIconRule).not.toContain("var(--ui-warning");
  });

  it("gives host login records separate room for user and source IP columns", () => {
    const loginRecordRule = getCssRule(stylesCss, ".host-login-record");
    expect(loginRecordRule).toContain(
      "grid-template-columns: minmax(160px, 0.75fr) minmax(220px, 1.35fr) minmax(64px, 0.34fr) minmax(150px, 0.7fr) max-content;"
    );

    const loginRecordMainRule = getCssRule(stylesCss, ".host-login-record-main");
    expect(loginRecordMainRule).toContain("display: contents;");
    expect(loginRecordMainRule).not.toContain("grid-template-columns: max-content minmax(0, 1fr);");
  });

  it("keeps pagination controls compact for table-heavy pages", () => {
    const paginationControlRule = getCssRule(stylesCss, ".pagination-input,\n.pagination-control");
    expect(paginationControlRule).toContain("min-height: var(--ui-control-height-sm);");
    expect(paginationControlRule).toContain("border-radius: var(--ui-radius-sm);");
    expect(paginationControlRule).toContain("font-size: 0.82rem;");

    const paginationSelectRule = getCssRule(stylesCss, ".pagination-size .ui-select");
    expect(paginationSelectRule).toContain("min-height: var(--ui-control-height-sm);");
    expect(paginationSelectRule).toContain("border-radius: var(--ui-radius-sm);");
    expect(paginationSelectRule).toContain("font-size: 0.82rem;");
  });

  it("keeps the main workspace shell restrained instead of glassy and oversized", () => {
    const shellRule = getCssRule(
      stylesCss,
      ".workspace-panel,\n.hero-card,\n.content-card,\n.login-card,\n.status-card"
    );
    expect(shellRule).toContain("border-radius: var(--ui-radius-lg);");
    expect(shellRule).toContain("box-shadow: var(--ui-shadow-soft);");
    expect(shellRule).not.toContain("border-radius: 28px;");
    expect(shellRule).not.toContain("blur(14px)");
    expect(stylesCss).not.toMatch(/\.login-card\s*\{[^}]*border-radius:\s*2[04]px/s);
    expect(stylesCss).not.toMatch(/\.login-card\s*\{[^}]*box-shadow:\s*var\(--ui-shadow-panel\)/s);

    const sidebarRule = getCssRule(stylesCss, ".sidebar");
    expect(sidebarRule).toContain("backdrop-filter: none;");
    expect(sidebarRule).not.toContain("blur(18px)");
  });

  it("keeps shell headings utilitarian instead of viewport-scaled marketing type", () => {
    const headingRule = getCssRule(stylesCss, ".brand h1,\n.hero-card h3,\n.login-card h1");
    expect(headingRule).toContain("font-family: var(--ui-font-sans);");
    expect(headingRule).toContain("letter-spacing: 0;");
    expect(headingRule).not.toContain("Space Grotesk");
    expect(stylesCss).not.toMatch(/font-size:\s*clamp\([^;]+vw/i);
  });

  it("does not rewrite xterm theme variables while adjusting the surrounding shell", () => {
    expect(getCustomProperty(stylesCss, ":root", "--xterm-background")).toBe("#0e1425");
    expect(getCustomProperty(stylesCss, ":root", "--xterm-foreground")).toBe("#f4efe7");
    expect(getCustomProperty(stylesCss, ":root[data-theme=\"light\"]", "--xterm-background")).toBe("#f8fafc");
    expect(getCustomProperty(stylesCss, ":root[data-theme=\"light\"]", "--xterm-foreground")).toBe("#1f2937");
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
