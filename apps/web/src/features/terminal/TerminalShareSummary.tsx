import { Share2 } from "lucide-react";

import { IconButton } from "../../shared/ui";

type TerminalShareSummaryProps = {
  active: boolean;
  finalMinute: boolean;
  label: string;
  onOpen: () => void;
  remainingText: string;
};

export function TerminalShareSummary({
  active,
  finalMinute,
  label,
  onOpen,
  remainingText
}: TerminalShareSummaryProps) {
  if (!active) {
    return null;
  }

  return (
    <IconButton
      className={[
        "ui-inline-icon-button terminal-pane-share-indicator",
        finalMinute ? "terminal-pane-share-indicator-countdown" : ""
      ].filter(Boolean).join(" ")}
      label={label}
      onClick={onOpen}
      variant="ghost"
    >
      {finalMinute ? (
        <>
          <Share2 aria-hidden="true" />
          <span className="terminal-pane-share-countdown">{remainingText}</span>
        </>
      ) : (
        <Share2 aria-hidden="true" />
      )}
    </IconButton>
  );
}
