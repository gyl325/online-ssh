import { type HTMLAttributes, type ReactNode } from "react";

import { cx } from "./classNames";

type InlineNoteTone = "neutral" | "info" | "warning" | "danger";

type InlineNoteProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
  title?: ReactNode;
  tone?: InlineNoteTone;
};

export function InlineNote({ children, className, title, tone = "neutral", ...props }: InlineNoteProps) {
  return (
    <div
      className={cx("ui-inline-note", `ui-inline-note-${tone}`, className)}
      role={tone === "danger" ? "alert" : props.role}
      {...props}
    >
      {title ? <p className="ui-inline-note-title">{title}</p> : null}
      {children ? <p>{children}</p> : null}
    </div>
  );
}
