import { type ButtonHTMLAttributes, type ReactNode } from "react";

import { cx } from "./classNames";

type InlineIconButtonVariant = "neutral" | "danger" | "send" | "success";

type InlineIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  label: string;
  variant?: InlineIconButtonVariant;
};

export function InlineIconButton({
  children,
  className,
  label,
  title,
  type = "button",
  variant = "neutral",
  ...props
}: InlineIconButtonProps) {
  const variantClass = variant === "neutral" ? undefined : `ui-inline-icon-button-${variant}`;

  return (
    <button
      aria-label={label}
      className={cx("ui-inline-icon-button", variantClass, className)}
      title={title || label}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
