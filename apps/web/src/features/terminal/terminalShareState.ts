import type { TerminalShare } from "./types";

export function terminalShareRemainingMs(share: TerminalShare | null | undefined, now = Date.now()) {
  if (!share || share.revoked_at) {
    return 0;
  }
  return Math.max(0, new Date(share.expires_at).getTime() - now);
}

export function isTerminalShareVisibleAt(share: TerminalShare | null | undefined, now = Date.now()): share is TerminalShare {
  return terminalShareRemainingMs(share, now) > 0;
}

export function isTerminalShareVisible(share: TerminalShare | null | undefined): share is TerminalShare {
  return isTerminalShareVisibleAt(share, Date.now());
}

export function formatTerminalShareRemaining(ms: number, language: string) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return language === "zh-CN" ? `${totalSeconds}秒` : `${totalSeconds}s`;
  }
  if (language === "zh-CN") {
    return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分`;
  }
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function isTerminalShareFinalMinute(share: TerminalShare | null | undefined, now = Date.now()) {
  const remainingMs = terminalShareRemainingMs(share, now);
  return remainingMs > 0 && remainingMs <= 60_000;
}
