import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TerminalShareSummary } from "./TerminalShareSummary";

describe("TerminalShareSummary", () => {
  it("renders nothing when no share is active", () => {
    render(
      <TerminalShareSummary
        active={false}
        finalMinute={false}
        label="Manage share for Prod SSH"
        onOpen={vi.fn()}
        remainingText="10m"
      />
    );

    expect(screen.queryByRole("button", { name: "Manage share for Prod SSH" })).not.toBeInTheDocument();
  });

  it("renders a stable share indicator and delegates opening the share dialog", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();

    render(
      <TerminalShareSummary
        active
        finalMinute={false}
        label="Manage share for Prod SSH, 10m left"
        onOpen={onOpen}
        remainingText="10m"
      />
    );

    const button = screen.getByRole("button", { name: "Manage share for Prod SSH, 10m left" });
    expect(button).toHaveClass("terminal-pane-share-indicator");
    expect(button).not.toHaveClass("terminal-pane-share-indicator-countdown");
    expect(button).not.toHaveTextContent("10m");

    await user.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("shows the remaining countdown only during the final minute", () => {
    render(
      <TerminalShareSummary
        active
        finalMinute
        label="Manage share for Prod SSH, 42s left"
        onOpen={vi.fn()}
        remainingText="42s"
      />
    );

    const button = screen.getByRole("button", { name: "Manage share for Prod SSH, 42s left" });
    expect(button).toHaveClass("terminal-pane-share-indicator-countdown");
    expect(button).toHaveTextContent("42s");
    expect(button.querySelector(".terminal-pane-share-countdown")).toHaveTextContent("42s");
  });
});
