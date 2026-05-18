import { type HTMLAttributes, type ReactNode } from "react";

import { cx } from "./classNames";

type SpinnerSize = "sm" | "md";

type SpinnerProps = HTMLAttributes<HTMLSpanElement> & {
  size?: SpinnerSize;
};

export function Spinner({ className, size = "md", ...props }: SpinnerProps) {
  return (
    <span className={cx("ui-spinner", `ui-spinner-${size}`, className)} {...props} />
  );
}

type LoadingStateProps = HTMLAttributes<HTMLDivElement> & {
  description?: ReactNode;
  label: ReactNode;
};

export function LoadingState({ className, description, label, ...props }: LoadingStateProps) {
  return (
    <div
      aria-label={typeof label === "string" ? label : undefined}
      className={cx("ui-loading-state", className)}
      role="status"
      {...props}
    >
      <Spinner aria-hidden="true" />
      <p>{label}</p>
      {description ? <p>{description}</p> : null}
    </div>
  );
}
