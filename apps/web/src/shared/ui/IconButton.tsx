import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cx } from "./classNames";

type IconButtonSize = "sm" | "md" | "lg";
type IconButtonVariant = "neutral" | "ghost" | "danger" | "primary";

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  label: string;
  loading?: boolean;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { children, className, disabled, label, loading = false, size = "md", title, type = "button", variant = "neutral", ...props },
  ref
) {
  return (
    <button
      aria-label={label}
      aria-busy={loading || undefined}
      className={cx(
        "ui-icon-button",
        `ui-icon-button-${variant}`,
        `ui-icon-button-${size}`,
        loading && "ui-icon-button-loading",
        className
      )}
      disabled={disabled || loading}
      ref={ref}
      title={title || label}
      type={type}
      {...props}
    >
      {loading ? <span className="ui-icon-button-spinner" aria-hidden="true" /> : children}
    </button>
  );
});
