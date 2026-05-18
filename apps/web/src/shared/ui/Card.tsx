import { type HTMLAttributes, type ReactNode, useId } from "react";

import { cx } from "./classNames";

type CardDensity = "sm" | "md";

type SharedCardProps = HTMLAttributes<HTMLElement> & {
  actions?: ReactNode;
  children?: ReactNode;
  density?: CardDensity;
  description?: ReactNode;
  footer?: ReactNode;
  title?: ReactNode;
};

export function Card({
  actions,
  children,
  className,
  density = "md",
  description,
  footer,
  title,
  ...props
}: SharedCardProps) {
  const headingId = useId();

  return (
    <article
      aria-labelledby={title ? headingId : undefined}
      className={cx("ui-card", `ui-card-${density}`, className)}
      {...props}
    >
      {title || description || actions ? (
        <header className="ui-card-header">
          <div className="ui-card-heading">
            {title ? <h3 id={headingId}>{title}</h3> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="ui-card-actions">{actions}</div> : null}
        </header>
      ) : null}
      {children ? <div className="ui-card-body">{children}</div> : null}
      {footer ? <footer className="ui-card-footer">{footer}</footer> : null}
    </article>
  );
}

export function Panel({
  actions,
  children,
  className,
  density = "md",
  description,
  footer,
  title,
  ...props
}: SharedCardProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={cx("ui-panel", `ui-panel-${density}`, className)}
      {...props}
    >
      {title || description || actions ? (
        <header className="ui-panel-header">
          <div className="ui-panel-heading">
            {title ? <h2 id={headingId}>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="ui-panel-actions">{actions}</div> : null}
        </header>
      ) : null}
      {children ? <div className="ui-panel-body">{children}</div> : null}
      {footer ? <footer className="ui-panel-footer">{footer}</footer> : null}
    </section>
  );
}
