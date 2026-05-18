import { describe, expect, it } from "vitest";

import { createTranslator, interpolateTranslation } from "./translator";

describe("preferences i18n translator", () => {
  it("creates a translator for supported language dictionaries", () => {
    const t = createTranslator("en-US");

    expect(t("preferences.title")).toBe("Interface preferences");
  });

  it("falls back to the fallback dictionary before returning the key", () => {
    const t = createTranslator("en-US", {
      dictionaries: {
        "en-US": {}
      },
      fallbackDictionary: {
        "fallback.only": "Fallback for {{host}}"
      }
    });

    expect(t("fallback.only", { host: "db-1" })).toBe("Fallback for db-1");
    expect(t("missing.key")).toBe("missing.key");
  });

  it("interpolates every provided placeholder without removing missing placeholders", () => {
    expect(
      interpolateTranslation("{{host}} runs {{command}} on {{host}} with {{missing}}", {
        command: "uptime",
        host: "edge-1"
      })
    ).toBe("edge-1 runs uptime on edge-1 with {{missing}}");
  });
});
