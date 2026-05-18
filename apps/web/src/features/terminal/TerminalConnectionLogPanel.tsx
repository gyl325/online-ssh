import { formatDateTimeWithOptions } from "../../shared/lib/date";
import { Button } from "../../shared/ui";

export type TerminalConnectionLogLevel = "info" | "success" | "warning" | "error";

export type TerminalConnectionLogEntry = {
  id: string;
  level: TerminalConnectionLogLevel;
  message: string;
  occurredAt: string;
};

type Translate = (key: string, values?: Record<string, string | number>) => string;

type TerminalConnectionLogPanelProps = {
  logs: TerminalConnectionLogEntry[];
  onCopy: () => void;
  t: Translate;
  language: string;
};

export function formatTerminalConnectionLogTime(value: string, locale: string) {
  return formatDateTimeWithOptions(value, locale, value, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function connectionLogClipboardText(logs: TerminalConnectionLogEntry[], locale: string) {
  return logs.map((entry) => {
    const time = formatTerminalConnectionLogTime(entry.occurredAt, locale);
    return `${time} [${entry.level}] ${entry.message}`;
  }).join("\n");
}

export function TerminalConnectionLogPanel({
  logs,
  onCopy,
  t,
  language
}: TerminalConnectionLogPanelProps) {
  return (
    <section aria-label={t("terminal.connectionLog.title")} className="terminal-connection-log" role="region">
      <div className="terminal-connection-log-header">
        <div>
          <strong>{t("terminal.connectionLog.title")}</strong>
          <span>{t("terminal.connectionLog.copy")}</span>
        </div>
        <Button onClick={onCopy} size="sm" variant="secondary">{t("terminal.connectionLog.copyAction")}</Button>
      </div>
      <ol className="terminal-connection-log-list">
        {logs.map((entry) => (
          <li className={`terminal-connection-log-entry terminal-connection-log-entry-${entry.level}`} key={entry.id}>
            <time dateTime={entry.occurredAt}>
              {formatTerminalConnectionLogTime(entry.occurredAt, language)}
            </time>
            <span aria-hidden="true" className="terminal-connection-log-marker" />
            <span>{entry.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
