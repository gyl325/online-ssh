import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithPreferences } from "../../test/renderWithProviders";
import { PasswordInput } from "./PasswordInput";

describe("PasswordInput", () => {
  it("uses the compact eye-icon reveal control", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    renderWithPreferences(
      <PasswordInput
        aria-label="API key"
        onChange={handleChange}
        value=""
      />
    );

    const input = screen.getByLabelText("API key") as HTMLInputElement;
    const revealButton = screen.getByRole("button", { name: "Show password" });

    expect(input.type).toBe("password");
    expect(input).toHaveClass("auth-input-group-control");
    expect(revealButton).toHaveClass("auth-password-toggle");
    expect(revealButton).toHaveTextContent("");
    expect(revealButton.querySelector(".lucide-eye")).not.toBeNull();

    await user.click(revealButton);

    expect(input.type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" }).querySelector(".lucide-eye-off")).not.toBeNull();
  });
});
