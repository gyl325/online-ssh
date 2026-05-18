import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cx } from "./classNames";

type FilterChipSize = "sm" | "md";

type FilterChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  children: ReactNode;
  size?: FilterChipSize;
};

export const FilterChip = forwardRef<HTMLButtonElement, FilterChipProps>(function FilterChip(
  { active = false, children, className, size = "md", type = "button", ...props },
  ref
) {
  return (
    <button
      aria-pressed={active}
      className={cx("ui-filter-chip", `ui-filter-chip-${size}`, active && "ui-filter-chip-active", className)}
      ref={ref}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
});
