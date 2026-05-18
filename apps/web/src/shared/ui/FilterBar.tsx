import { type HTMLAttributes } from "react";

import { cx } from "./classNames";

type FilterBarProps = HTMLAttributes<HTMLDivElement>;

export function FilterBar({ className, ...props }: FilterBarProps) {
  return <div className={cx("ui-filter-bar", className)} {...props} />;
}

export function FilterBarGroup({ className, role = "group", ...props }: FilterBarProps) {
  return <div className={cx("ui-filter-bar-group", className)} role={role} {...props} />;
}
