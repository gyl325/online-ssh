import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cx } from "./classNames";

type ProgressBarProps = {
  className?: string;
  label?: string;
  value: number;
};

export function ProgressBar({ className, label, value }: ProgressBarProps) {
  const normalized = Math.max(0, Math.min(100, value));

  return (
    <ProgressPrimitive.Root
      aria-label={label}
      className={cx("ui-progress", className)}
      value={normalized}
    >
      <ProgressPrimitive.Indicator
        className="ui-progress-indicator"
        style={{ transform: `translateX(-${100 - normalized}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
