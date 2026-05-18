import { describe, expect, it } from "vitest";

import { parseUserAgent } from "./userAgent";

describe("parseUserAgent", () => {
  it("prioritizes Edge before Chrome when the UA contains Edg", () => {
    const result = parseUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0"
    );

    expect(result).toEqual({
      browser: "Edge",
      os: "macOS",
      label: "Edge on macOS"
    });
  });

  it("recognizes Chrome on Windows without treating Edge as Chrome", () => {
    expect(
      parseUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
      ).label
    ).toBe("Chrome on Windows");
  });

  it("recognizes Safari on iOS and Firefox on Linux", () => {
    expect(
      parseUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
      ).label
    ).toBe("Safari on iOS");

    expect(parseUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0").label).toBe(
      "Firefox on Linux"
    );
  });

  it("falls back to unknown browser and OS for empty or unsupported UA", () => {
    expect(parseUserAgent(null).label).toBe("Unknown browser on Unknown OS");
    expect(parseUserAgent("CustomClient/1.0").label).toBe("Unknown browser on Unknown OS");
  });
});
