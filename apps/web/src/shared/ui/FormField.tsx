import {
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  useId
} from "react";

import { cx } from "./classNames";

type FormFieldProps = {
  children: (id: string) => ReactNode;
  className?: string;
  description?: ReactNode;
  error?: ReactNode;
  label: ReactNode;
};

export function FormField({ children, className, description, error, label }: FormFieldProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={["ui-field", className].filter(Boolean).join(" ")}>
      <label className="ui-field-label" htmlFor={id}>{label}</label>
      {children(id)}
      {description ? <p className="ui-field-description" id={descriptionId}>{description}</p> : null}
      {error ? <p className="ui-field-error" id={errorId}>{error}</p> : null}
    </div>
  );
}

export function AuthCodeField({ children, className, description, error, label }: FormFieldProps) {
  return (
    <FormField
      className={cx("auth-code-field", className)}
      description={description}
      error={error}
      label={label}
    >
      {children}
    </FormField>
  );
}

type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ className, ...props }: TextInputProps) {
  return <input className={["ui-input", className].filter(Boolean).join(" ")} {...props} />;
}

type TextareaInputProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextareaInput({ className, ...props }: TextareaInputProps) {
  return <textarea className={["ui-textarea", className].filter(Boolean).join(" ")} {...props} />;
}
