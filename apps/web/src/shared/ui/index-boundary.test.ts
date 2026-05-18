import sharedUiIndex from "./index.ts?raw";
import formFieldSource from "./FormField.tsx?raw";
import { describe, expect, it } from "vitest";

describe("shared ui barrel boundary", () => {
  it("does not re-export heavyweight route-specific date range picker modules", () => {
    expect(sharedUiIndex).not.toContain("./DateRangePicker");
    expect(sharedUiIndex).not.toContain("DateRangePicker");
    expect(sharedUiIndex).not.toContain("createDateRangePickerLabels");
  });

  it("keeps heavyweight select dependencies out of the lightweight form field module", () => {
    expect(formFieldSource).not.toContain("@radix-ui/react-select");
    expect(formFieldSource).not.toContain("SelectInput");
  });
});
