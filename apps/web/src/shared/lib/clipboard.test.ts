import { afterEach, describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "./clipboard";

describe("clipboard helpers", () => {
  const originalClipboard = window.navigator.clipboard;
  const originalExecCommand = document.execCommand;
  const originalIsSecureContext = window.isSecureContext;

  afterEach(() => {
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: originalClipboard
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: originalExecCommand
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: originalIsSecureContext
    });
    vi.restoreAllMocks();
  });

  it("writes text through the copy event fallback when clipboard data is available", async () => {
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: undefined
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false
    });
    const setClipboardData = vi.fn();
    const execCommand = vi.fn((command: string) => {
      if (command !== "copy") {
        return false;
      }
      const event = new Event("copy") as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", {
        configurable: true,
        value: {
          setData: setClipboardData
        }
      });
      document.dispatchEvent(event);
      return true;
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand
    });

    await expect(copyTextToClipboard("deploy command")).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(setClipboardData).toHaveBeenCalledWith("text/plain", "deploy command");
  });

  it("does not report success when execCommand returns true without setting clipboard data", async () => {
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: undefined
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn().mockReturnValue(true)
    });

    await expect(copyTextToClipboard("deploy command")).resolves.toBe(false);
  });

  it("falls back to async Clipboard API in secure contexts", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn().mockReturnValue(false)
    });

    await expect(copyTextToClipboard("deploy command")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("deploy command");
  });
});
