import { type HTMLAttributes, type ReactNode } from "react";

import { cx } from "./classNames";

type ToolbarProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Toolbar({ children, className, ...props }: ToolbarProps) {
  return (
    <div className={cx("ui-toolbar", className)} {...props}>
      {children}
    </div>
  );
}
