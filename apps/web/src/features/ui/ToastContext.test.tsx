import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PreferencesProvider } from "../preferences/PreferencesContext";
import { ToastProvider, useToast } from "./ToastContext";

function ToastHarness() {
  const toast = useToast();

  return (
    <div>
      <button type="button" onClick={() => toast.info("Session updated")}>
        Show toast
      </button>
      <button type="button" onClick={() => toast.error("")}>
        Show blank toast
      </button>
    </div>
  );
}

function renderToastHarness() {
  return render(
    <PreferencesProvider>
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>
    </PreferencesProvider>
  );
}

describe("ToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("dismisses toast after its duration and exit animation", () => {
    renderToastHarness();

    fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
    expect(screen.getByText("Session updated")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4200);
    });
    expect(screen.getByText("Session updated")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(screen.queryByText("Session updated")).not.toBeInTheDocument();
  });

  it("pauses dismissal while hovered and resumes after mouse leaves", () => {
    renderToastHarness();

    fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
    const toastCard = screen.getByText("Session updated").closest(".toast-card");
    expect(toastCard).toBeInstanceOf(HTMLElement);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    fireEvent.mouseEnter(toastCard as HTMLElement);

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText("Session updated")).toBeInTheDocument();

    fireEvent.mouseLeave(toastCard as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.getByText("Session updated")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(screen.queryByText("Session updated")).not.toBeInTheDocument();
  });

  it("allows direct dismissal with the close button", () => {
    renderToastHarness();

    fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
    fireEvent.click(screen.getByRole("button", { name: /close|关闭/i }));

    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(screen.queryByText("Session updated")).not.toBeInTheDocument();
  });

  it("ignores blank toast messages", () => {
    renderToastHarness();

    fireEvent.click(screen.getByRole("button", { name: "Show blank toast" }));

    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });
});
