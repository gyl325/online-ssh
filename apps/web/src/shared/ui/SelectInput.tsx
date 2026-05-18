import {
  Children,
  isValidElement,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  useState
} from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

import { cx } from "./classNames";

type SelectInputProps = SelectHTMLAttributes<HTMLSelectElement>;

type OptionElement = ReactElement<{
  children?: ReactNode;
  disabled?: boolean;
  value?: string | number;
}>;

const emptySelectValue = "__online_ssh_empty_value__";

function toSelectItemValue(value: string) {
  return value === "" ? emptySelectValue : value;
}

function fromSelectItemValue(value: string) {
  return value === emptySelectValue ? "" : value;
}

function getSelectValue(value: SelectInputProps["value"] | SelectInputProps["defaultValue"]) {
  if (Array.isArray(value)) {
    return String(value[0] ?? "");
  }
  return value === undefined ? undefined : String(value);
}

function getSelectOptions(children: ReactNode) {
  return Children.toArray(children).flatMap((child, index) => {
    if (!isValidElement(child) || child.type !== "option") {
      return [];
    }

    const option = child as OptionElement;
    const rawValue = option.props.value ?? (typeof option.props.children === "string" ? option.props.children : "");
    const value = String(rawValue);
    return [{
      disabled: option.props.disabled,
      key: option.key ?? `${value}-${index}`,
      label: option.props.children,
      value
    }];
  });
}

function createSelectChangeEvent(value: string, id?: string, name?: string) {
  return {
    currentTarget: { id, name, value },
    target: { id, name, value }
  } as unknown as ChangeEvent<HTMLSelectElement>;
}

export function SelectInput({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  className,
  children,
  defaultValue,
  disabled,
  id,
  name,
  onChange,
  required,
  title,
  value
}: SelectInputProps) {
  const options = getSelectOptions(children);
  const controlledValue = getSelectValue(value);
  const [internalValue, setInternalValue] = useState(getSelectValue(defaultValue) ?? options[0]?.value ?? "");
  const currentValue = controlledValue ?? internalValue;

  const handleValueChange = (nextItemValue: string) => {
    const nextValue = fromSelectItemValue(nextItemValue);
    if (controlledValue === undefined) {
      setInternalValue(nextValue);
    }
    onChange?.(createSelectChangeEvent(nextValue, id, name));
  };

  return (
    <Select.Root
      disabled={disabled}
      name={name}
      onValueChange={handleValueChange}
      required={required}
      value={toSelectItemValue(currentValue)}
    >
      <Select.Trigger
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        className={cx("ui-select", className)}
        id={id}
        title={title}
      >
        <Select.Value />
        <Select.Icon className="ui-select-icon">
          <ChevronDown aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="ui-select-content" position="popper" sideOffset={6}>
          <Select.Viewport className="ui-select-viewport">
            {options.map((option) => (
              <Select.Item
                className="ui-select-item"
                data-value={option.value}
                disabled={option.disabled}
                key={option.key}
                value={toSelectItemValue(option.value)}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="ui-select-item-indicator">
                  <Check aria-hidden="true" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
