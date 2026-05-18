import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TerminalHostPicker } from "./TerminalHostPicker";
import type { Host } from "../hosts/types";

const labels: Record<string, string> = {
  "files.availableHosts": "Available hosts",
  "dashboard.hostsCount": "{{count}} hosts",
  "files.hostSearch": "Search hosts",
  "files.hostSearchPlaceholder": "Filter hosts",
  "host.empty1": "No hosts found"
};

function t(key: string, values?: Record<string, string | number>) {
  let template = labels[key] || key;
  Object.entries(values || {}).forEach(([name, value]) => {
    template = template.replaceAll(`{{${name}}}`, String(value));
  });
  return template;
}

const hosts: Host[] = [
  {
    id: "host-1",
    name: "Prod SSH",
    host: "prod.example.com",
    port: 22,
    username: "root",
    auth_type: "private_key",
    is_favorite: true,
    status: "online",
    created_at: "2026-05-14T00:00:00.000Z",
    updated_at: "2026-05-14T00:00:00.000Z"
  },
  {
    id: "host-2",
    name: "Worker SSH",
    host: "worker.example.com",
    port: 2222,
    username: "deploy",
    auth_type: "password",
    is_favorite: false,
    status: "online",
    created_at: "2026-05-14T00:00:00.000Z",
    updated_at: "2026-05-14T00:00:00.000Z"
  }
];

describe("TerminalHostPicker", () => {
  it("renders filtered hosts and delegates filter and selection events", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    const onSelectHost = vi.fn();

    render(
      <TerminalHostPicker
        filter="prod"
        hosts={hosts}
        onFilterChange={onFilterChange}
        onSelectHost={onSelectHost}
        t={t}
      />
    );

    const picker = screen.getByText("Available hosts").closest(".files-host-picker") as HTMLElement;
    expect(within(picker).getByText("2 hosts")).toBeInTheDocument();
    expect(within(picker).getByDisplayValue("prod")).toBeInTheDocument();
    expect(within(picker).getByText("root@prod.example.com:22")).toBeInTheDocument();
    expect(within(picker).getByText("deploy@worker.example.com:2222")).toBeInTheDocument();

    await user.type(within(picker).getByLabelText("Search hosts"), "1");
    await user.click(within(picker).getByRole("button", { name: /Prod SSH/ }));

    expect(onFilterChange).toHaveBeenLastCalledWith("prod1");
    expect(onSelectHost).toHaveBeenCalledWith(hosts[0]);
  });

  it("shows an empty note when no hosts are available", () => {
    render(
      <TerminalHostPicker
        filter=""
        hosts={[]}
        onFilterChange={vi.fn()}
        onSelectHost={vi.fn()}
        t={t}
      />
    );

    const picker = screen.getByText("Available hosts").closest(".files-host-picker") as HTMLElement;
    expect(within(picker).getByText("0 hosts")).toBeInTheDocument();
    expect(within(picker).getByText("No hosts found")).toBeInTheDocument();
  });
});
