import { getHostDisplayName, getHostEndpoint } from "../hosts/display";
import type { Host } from "../hosts/types";
import { TextInput } from "../../shared/ui";

type Translate = (key: string, values?: Record<string, string | number>) => string;

type TerminalHostPickerProps = {
  filter: string;
  hosts: Host[];
  onFilterChange: (value: string) => void;
  onSelectHost: (host: Host) => void;
  t: Translate;
};

export function TerminalHostPicker({
  filter,
  hosts,
  onFilterChange,
  onSelectHost,
  t
}: TerminalHostPickerProps) {
  return (
    <div className="files-host-picker">
      <div className="files-host-picker-header">
        <strong>{t("files.availableHosts")}</strong>
        <span>{t("dashboard.hostsCount", { count: hosts.length })}</span>
      </div>
      <TextInput
        aria-label={t("files.hostSearch")}
        className="files-host-picker-search"
        onChange={(event) => onFilterChange(event.target.value)}
        placeholder={t("files.hostSearchPlaceholder")}
        type="search"
        value={filter}
      />
      <div className="files-host-picker-list">
        {hosts.length > 0 ? (
          hosts.map((host) => (
            <button
              className="files-host-picker-item"
              key={host.id}
              onClick={() => onSelectHost(host)}
              type="button"
            >
              <strong>{getHostDisplayName(host)}</strong>
              <span>{getHostEndpoint(host)}</span>
            </button>
          ))
        ) : (
          <div className="inline-note">
            <p>{t("host.empty1")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
