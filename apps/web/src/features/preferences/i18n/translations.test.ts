import { describe, expect, it } from "vitest";

import { fallbackTranslations, translations } from "./translations";

describe("preferences i18n translations", () => {
  it("exports the supported language dictionaries without changing the fallback text", () => {
    expect(translations["zh-CN"]["preferences.title"]).toBe("界面偏好");
    expect(translations["en-US"]["preferences.title"]).toBe("Interface preferences");
    expect(fallbackTranslations).toBe(translations["zh-CN"]);
  });
});
