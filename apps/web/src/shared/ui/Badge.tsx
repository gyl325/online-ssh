import { type HTMLAttributes, type ReactNode } from "react";

import { cx } from "./classNames";

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";
type BadgeAppearance = "soft" | "outline";
type BadgeSize = "sm" | "md";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  appearance?: BadgeAppearance;
  children: ReactNode;
  size?: BadgeSize;
  tone?: BadgeTone;
};

export function Badge({ appearance = "soft", children, className, size = "sm", tone = "neutral", ...props }: BadgeProps) {
  return (
    <span className={cx("ui-badge", `ui-badge-${tone}`, `ui-badge-${appearance}`, `ui-badge-${size}`, className)} {...props}>
      {children}
    </span>
  );
}
