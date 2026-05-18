import { cx } from "./classNames";

export type StepProgressItem = {
  description?: string;
  title: string;
};

type StepProgressProps = {
  activeIndex: number;
  ariaLabel: string;
  className?: string;
  items: StepProgressItem[];
};

export function StepProgress({ activeIndex, ariaLabel, className, items }: StepProgressProps) {
  return (
    <ol aria-label={ariaLabel} className={cx("ui-step-progress", className)}>
      {items.map((item, index) => {
        const state = index < activeIndex ? "complete" : index === activeIndex ? "active" : "pending";
        return (
          <li className={cx("ui-step-progress-item", `ui-step-progress-item-${state}`)} key={`${item.title}-${index}`}>
            <span className="ui-step-progress-marker">
              <span className="ui-step-progress-node">{index + 1}</span>
            </span>
            <div className="ui-step-progress-copy">
              <strong>{item.title}</strong>
              {item.description ? <span>{item.description}</span> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
