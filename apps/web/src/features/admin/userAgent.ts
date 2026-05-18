export type ParsedUserAgent = {
  browser: string;
  os: string;
  label: string;
};

export function parseUserAgent(userAgent?: string | null): ParsedUserAgent {
  const value = userAgent || "";
  const browser = parseBrowser(value);
  const os = parseOperatingSystem(value);
  return {
    browser,
    os,
    label: `${browser} on ${os}`
  };
}

function parseBrowser(userAgent: string) {
  if (userAgent.includes("Edg/")) {
    return "Edge";
  }
  if (userAgent.includes("Firefox/")) {
    return "Firefox";
  }
  if (userAgent.includes("Chrome/") && !userAgent.includes("Edg/")) {
    return "Chrome";
  }
  if (
    userAgent.includes("Safari/") &&
    !userAgent.includes("Chrome/") &&
    !userAgent.includes("Chromium/") &&
    !userAgent.includes("Edg/")
  ) {
    return "Safari";
  }
  return "Unknown browser";
}

function parseOperatingSystem(userAgent: string) {
  if (userAgent.includes("iPad")) {
    return "iPadOS";
  }
  if (userAgent.includes("iPhone")) {
    return "iOS";
  }
  if (userAgent.includes("Windows NT")) {
    return "Windows";
  }
  if (userAgent.includes("Mac OS X") || userAgent.includes("Macintosh")) {
    return "macOS";
  }
  if (userAgent.includes("Android")) {
    return "Android";
  }
  if (userAgent.includes("Linux")) {
    return "Linux";
  }
  return "Unknown OS";
}
