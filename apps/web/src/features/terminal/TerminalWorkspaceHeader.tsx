import { History, Sparkles } from "lucide-react";

import { Button } from "../../shared/ui";

type TerminalWorkspaceHeaderProps = {
  aiCommandLabel: string;
  historyLabel: string;
  onOpenAiCommand: () => void;
  onOpenHistory: () => void;
  onOpenSavedCommands: () => void;
  savedCommandsCount: number;
  savedCommandsLabel: string;
  title: string;
};

export function TerminalWorkspaceHeader({
  aiCommandLabel,
  historyLabel,
  onOpenAiCommand,
  onOpenHistory,
  onOpenSavedCommands,
  savedCommandsCount,
  savedCommandsLabel,
  title
}: TerminalWorkspaceHeaderProps) {
  return (
    <div className="section-header">
      <div>
        <h4>{title}</h4>
      </div>
      <div aria-label="Terminal actions" className="header-actions" role="group">
        <Button
          leadingIcon={<Sparkles aria-hidden="true" />}
          onClick={onOpenAiCommand}
          size="sm"
          variant="secondary"
        >
          {aiCommandLabel}
        </Button>
        <Button
          onClick={onOpenSavedCommands}
          size="sm"
          variant="secondary"
        >
          {savedCommandsLabel}
          {savedCommandsCount > 0 ? (
            <span className="terminal-command-badge">{savedCommandsCount}</span>
          ) : null}
        </Button>
        <Button
          leadingIcon={<History aria-hidden="true" />}
          onClick={onOpenHistory}
          size="sm"
          variant="secondary"
        >
          {historyLabel}
        </Button>
      </div>
    </div>
  );
}
