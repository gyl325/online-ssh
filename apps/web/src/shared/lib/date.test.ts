import { describe, expect, it } from "vitest";

import { datetimeLocalToIso, formatDateTime, formatDateTimeWithOptions } from "./date";

describe("shared date helpers", () => {
  it("formats medium date and short time with the requested locale", () => {
    expect(formatDateTime("2026-05-12T08:30:00", "en-US", "--")).toBe("May 12, 2026, 8:30 AM");
  });

  it("returns the fallback for missing or invalid date values", () => {
    expect(formatDateTime(null, "en-US", "--")).toBe("--");
    expect(formatDateTime("", "en-US", "--")).toBe("--");
    expect(formatDateTime("not-a-date", "en-US", "--")).toBe("--");
  });

  it("formats dates with caller supplied Intl options", () => {
    expect(formatDateTimeWithOptions("2026-05-12T08:30:00", "en-US", "--", {
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      month: "short"
    })).toBe("May 12, 08:30 AM");
    expect(formatDateTimeWithOptions("not-a-date", "en-US", "not-a-date", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })).toBe("not-a-date");
  });

  it("normalizes datetime-local values to ISO and rejects invalid values", () => {
    const expected = new Date("2026-05-12T08:30").toISOString();
    expect(datetimeLocalToIso("2026-05-12 08:30")).toBe(expected);
    expect(datetimeLocalToIso("2026-05-12T08:30")).toBe(expected);
    expect(datetimeLocalToIso("")).toBe("");
    expect(datetimeLocalToIso("not-a-date")).toBe("");
  });
});
