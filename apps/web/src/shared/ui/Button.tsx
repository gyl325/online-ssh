import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cx } from "./classNames";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  loading?: boolean;
  size?: ButtonSize;
  trailingIcon?: ReactNode;
  variant?: ButtonVariant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className,
    disabled,
    fullWidth = false,
    leadingIcon,
    loading = false,
    size = "md",
    trailingIcon,
    type = "button",
    variant = "secondary",
    ...props
  },
  ref
) {
  return (
    <button
      aria-busy={loading || undefined}
      className={cx(
        "ui-button",
        `ui-button-${variant}`,
        `ui-button-${size}`,
        loading && "ui-button-loading",
        fullWidth && "ui-button-full-width",
        className
      )}
      disabled={disabled || loading}
      ref={ref}
      type={type}
      {...props}
    >
      {loading ? <span className="ui-button-spinner" aria-hidden="true" /> : null}
      {!loading && leadingIcon ? <span className="ui-button-icon">{leadingIcon}</span> : null}
      <span className="ui-button-label">{children}</span>
      {trailingIcon ? <span className="ui-button-icon ui-button-icon-trailing">{trailingIcon}</span> : null}
    </button>
  );
});
