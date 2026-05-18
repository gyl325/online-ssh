import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StepProgress } from "./StepProgress";

describe("StepProgress", () => {
  it("keeps the connector in a marker row separate from the title copy", () => {
    render(
      <StepProgress
        activeIndex={0}
        ariaLabel="Account security steps"
        items={[
          { title: "Verify current password", description: "Confirm this operation is yours." },
          { title: "Set new password", description: "Enter and confirm the new password." }
        ]}
      />
    );

    const items = within(screen.getByRole("list", { name: "Account security steps" })).getAllByRole("listitem");
    expect(items[0].firstElementChild).toHaveClass("ui-step-progress-marker");
    expect(items[0].querySelector(".ui-step-progress-copy")).toHaveTextContent("Verify current password");
  });
});
