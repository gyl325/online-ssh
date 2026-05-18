import { type ReactNode } from "react";

import { cx } from "./classNames";

type SegmentedControlSize = "sm" | "md";

type SegmentedControlItem<Value extends string> = {
  disabled?: boolean;
  label: ReactNode;
  value: Value;
};

type SegmentedControlProps<Value extends string> = {
  ariaLabel: string;
  className?: string;
  items: Array<SegmentedControlItem<Value>>;
  onChange: (value: Value) => void;
  size?: SegmentedControlSize;
  value: Value;
};

export function SegmentedControl<Value extends string>({
  ariaLabel,
  className,
  items,
  onChange,
  size = "sm",
  value
}: SegmentedControlProps<Value>) {
  return (
    <div className={cx("ui-segmented-control", `ui-segmented-control-${size}`, className)} role="group" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            aria-pressed={active}
            className={cx("ui-segmented-option", `ui-segmented-option-${size}`, active && "ui-segmented-option-active")}
            disabled={item.disabled}
            key={item.value}
            onClick={() => onChange(item.value)}
            type="button"
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
