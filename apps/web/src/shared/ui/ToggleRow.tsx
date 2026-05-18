import { type InputHTMLAttributes, type ReactNode, useId } from "react";

import { cx } from "./classNames";

type ToggleRowProps = Omit<InputHTMLAttributes<HTMLInputElement>, "children" | "type"> & {
  description?: ReactNode;
  label: ReactNode;
};

export function ToggleRow({ className, description, label, readOnly, ...props }: ToggleRowProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = description ? `${id}-description` : undefined;
  const inferredReadOnly = props.checked !== undefined && props.onChange === undefined ? true : undefined;

  return (
    <label className={cx("ui-toggle-row", className)}>
      <input
        aria-describedby={descriptionId}
        aria-labelledby={labelId}
        readOnly={readOnly ?? inferredReadOnly}
        type="checkbox"
        {...props}
      />
      <span className="ui-toggle-row-copy">
        <span className="ui-toggle-row-label" id={labelId}>{label}</span>
        {description ? <span className="ui-toggle-row-description" id={descriptionId}>{description}</span> : null}
      </span>
    </label>
  );
}
