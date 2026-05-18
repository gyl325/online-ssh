import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type ComponentType } from "react";

import { Badge } from "./Badge";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { IconButton } from "./IconButton";

describe("shared ui components", () => {
  it("Button exposes loading, full-width and trailing-icon states", () => {
    render(
      <Button fullWidth loading trailingIcon={<span data-testid="button-trailing" />}>
        Save
      </Button>
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveClass("ui-button-loading", "ui-button-full-width");
    expect(button.querySelector(".ui-button-spinner")).toBeInTheDocument();
    expect(screen.getByTestId("button-trailing")).toBeInTheDocument();
  });

  it("IconButton exposes loading and size variants", () => {
    render(
      <IconButton label="Refresh" loading size="lg" variant="primary">
        <span data-testid="refresh-icon" />
      </IconButton>
    );

    const button = screen.getByRole("button", { name: "Refresh" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveClass("ui-icon-button-primary", "ui-icon-button-lg", "ui-icon-button-loading");
    expect(button.querySelector(".ui-icon-button-spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("refresh-icon")).not.toBeInTheDocument();
  });

  it("Badge exposes size and appearance variants", () => {
    render(
      <Badge appearance="outline" size="md" tone="warning">
        High risk
      </Badge>
    );

    expect(screen.getByText("High risk")).toHaveClass("ui-badge-warning", "ui-badge-outline", "ui-badge-md");
  });

  it("EmptyState exposes icon and action regions", () => {
    render(
      <EmptyState
        actions={<button type="button">Retry</button>}
        icon={<span data-testid="empty-icon" />}
        title="No results"
        description="Try a different filter."
      />
    );

    const region = screen.getByText("No results").closest(".ui-empty-state");
    expect(region?.querySelector(".ui-empty-state-icon")).toContainElement(screen.getByTestId("empty-icon"));
    expect(region?.querySelector(".ui-empty-state-actions")).toContainElement(screen.getByRole("button", { name: "Retry" }));
  });

  it("exports loading state primitives", async () => {
    const ui = await import("./index") as unknown as Record<string, unknown>;

    expect(ui.Spinner).toBeTypeOf("function");
    expect(ui.LoadingState).toBeTypeOf("function");

    const LoadingState = ui.LoadingState as ComponentType<{ description?: string; label: string }>;
    render(<LoadingState description="Preparing the list." label="Loading hosts" />);

    const status = screen.getByRole("status", { name: "Loading hosts" });
    expect(status).toHaveClass("ui-loading-state");
    expect(status.querySelector(".ui-spinner")).toBeInTheDocument();
    expect(status).toHaveTextContent("Preparing the list.");
  });

  it("exports card and panel containers with labelled headings", async () => {
    const ui = await import("./index") as unknown as Record<string, unknown>;
    const Card = ui.Card as ComponentType<{
      actions?: React.ReactNode;
      children?: React.ReactNode;
      description?: React.ReactNode;
      title: React.ReactNode;
    }>;
    const Panel = ui.Panel as ComponentType<{
      children?: React.ReactNode;
      title: React.ReactNode;
    }>;

    expect(ui.Card).toBeTypeOf("function");
    expect(ui.Panel).toBeTypeOf("function");

    render(
      <>
        <Card actions={<button type="button">Edit</button>} description="Reusable resource card." title="Host card">
          <span>Card body</span>
        </Card>
        <Panel title="Filter panel">
          <span>Panel body</span>
        </Panel>
      </>
    );

    expect(screen.getByRole("article", { name: "Host card" })).toHaveClass("ui-card");
    expect(screen.getByRole("region", { name: "Filter panel" })).toHaveClass("ui-panel");
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("exports inline notes and toggle rows", async () => {
    const ui = await import("./index") as unknown as Record<string, unknown>;
    const InlineNote = ui.InlineNote as ComponentType<{
      children?: React.ReactNode;
      title?: React.ReactNode;
      tone?: "neutral" | "danger";
    }>;
    const ToggleRow = ui.ToggleRow as ComponentType<{
      checked?: boolean;
      description?: React.ReactNode;
      label: React.ReactNode;
      onChange?: React.ChangeEventHandler<HTMLInputElement>;
    }>;

    expect(ui.InlineNote).toBeTypeOf("function");
    expect(ui.ToggleRow).toBeTypeOf("function");

    render(
      <>
        <InlineNote tone="danger" title="Key required">Add a private key before connecting.</InlineNote>
        <ToggleRow checked label="Remember host" description="Keep this host in quick access." />
      </>
    );

    expect(screen.getByRole("alert")).toHaveClass("ui-inline-note", "ui-inline-note-danger");
    expect(screen.getByRole("checkbox", { name: "Remember host" })).toBeChecked();
    expect(screen.getByText("Keep this host in quick access.")).toHaveClass("ui-toggle-row-description");
  });

  it("exports inline icon buttons for dense row actions", async () => {
    const ui = await import("./index") as unknown as Record<string, unknown>;
    const InlineIconButton = ui.InlineIconButton as ComponentType<{
      children: React.ReactNode;
      label: string;
      variant?: "send";
    }>;

    expect(ui.InlineIconButton).toBeTypeOf("function");

    render(
      <InlineIconButton label="Send command" variant="send">
        <span data-testid="send-command-icon" />
      </InlineIconButton>
    );

    const button = screen.getByRole("button", { name: "Send command" });
    expect(button).toHaveClass("ui-inline-icon-button", "ui-inline-icon-button-send");
    expect(screen.getByTestId("send-command-icon")).toBeInTheDocument();
  });
});
