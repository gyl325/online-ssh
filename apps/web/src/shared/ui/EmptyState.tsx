import { type ReactNode } from "react";

import { cx } from "./classNames";

type EmptyStateProps = {
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
};

export function EmptyState({ actions, children, className, description, icon, title }: EmptyStateProps) {
  return (
    <div className={cx("ui-empty-state", className)}>
      {icon ? <span className="ui-empty-state-icon">{icon}</span> : null}
      <p>{title}</p>
      {description ? <p>{description}</p> : null}
      {children}
      {actions ? <div className="ui-empty-state-actions">{actions}</div> : null}
    </div>
  );
}
