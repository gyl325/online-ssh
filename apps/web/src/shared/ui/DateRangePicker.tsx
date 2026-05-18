import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronDown } from "lucide-react";
import { DayPicker, type DateRange } from "react-day-picker";
import "react-day-picker/style.css";

import { Button } from "./Button";
import { cx } from "./classNames";
import { SelectInput } from "./SelectInput";
import { formatDateTime } from "../lib/date";

export type DateRangePickerValue = {
  start: string;
  end: string;
};

export type DateRangePickerLabels = {
  all: string;
  calendar: string;
  done: string;
  empty: string;
  end: string;
  last30Days: string;
  last7Days: string;
  start: string;
  thisMonth: string;
  today: string;
  trigger: string;
  yesterday: string;
};

type DateRangePickerProps = {
  className?: string;
  labels: DateRangePickerLabels;
  locale: string;
  onChange: (value: DateRangePickerValue) => void;
  value: DateRangePickerValue;
};

type PresetKind = "all" | "today" | "yesterday" | "last7Days" | "last30Days" | "thisMonth";

const timeOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? "00" : "30";
  return `${pad(hour)}:${minute}`;
}).concat("23:59");

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toLocalDateTimeValue(date: Date, boundary: "start" | "end") {
  const normalized = new Date(date);
  if (boundary === "start") {
    normalized.setHours(0, 0, 0, 0);
  } else {
    normalized.setHours(23, 59, 59, 999);
  }

  return [
    normalized.getFullYear(),
    pad(normalized.getMonth() + 1),
    pad(normalized.getDate())
  ].join("-") + `T${pad(normalized.getHours())}:${pad(normalized.getMinutes())}`;
}

function parseDateTimeValue(value: string) {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value.trim().replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getPresetValue(kind: PresetKind): DateRangePickerValue {
  if (kind === "all") {
    return { start: "", end: "" };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (kind === "today") {
    return {
      start: toLocalDateTimeValue(today, "start"),
      end: toLocalDateTimeValue(today, "end")
    };
  }

  if (kind === "yesterday") {
    const yesterday = addDays(today, -1);
    return {
      start: toLocalDateTimeValue(yesterday, "start"),
      end: toLocalDateTimeValue(yesterday, "end")
    };
  }

  if (kind === "last7Days") {
    return {
      start: toLocalDateTimeValue(addDays(today, -6), "start"),
      end: toLocalDateTimeValue(today, "end")
    };
  }

  if (kind === "last30Days") {
    return {
      start: toLocalDateTimeValue(addDays(today, -29), "start"),
      end: toLocalDateTimeValue(today, "end")
    };
  }

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    start: toLocalDateTimeValue(monthStart, "start"),
    end: toLocalDateTimeValue(today, "end")
  };
}

function getTimeValue(value: string, fallback: string) {
  const parsed = parseDateTimeValue(value);
  if (!parsed) {
    return fallback;
  }
  return `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function withTime(value: string, time: string) {
  const parsed = parseDateTimeValue(value);
  const [hour, minute] = time.split(":").map(Number);
  if (!parsed || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return value;
  }
  parsed.setHours(hour, minute, 0, 0);
  return [
    parsed.getFullYear(),
    pad(parsed.getMonth() + 1),
    pad(parsed.getDate())
  ].join("-") + `T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

export function createDateRangePickerLabels(t: (key: string) => string): DateRangePickerLabels {
  return {
    all: t("common.timeRangeAll"),
    calendar: t("common.timeRangeCalendar"),
    done: t("common.done"),
    empty: t("common.timeRangeAll"),
    end: t("common.timeRangeEnd"),
    last30Days: t("common.timeRangeLast30Days"),
    last7Days: t("common.timeRangeLast7Days"),
    start: t("common.timeRangeStart"),
    thisMonth: t("common.timeRangeThisMonth"),
    today: t("common.timeRangeToday"),
    trigger: t("common.timeRange"),
    yesterday: t("common.timeRangeYesterday")
  };
}

export function DateRangePicker({ className, labels, locale, onChange, value }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const selectedRange = useMemo<DateRange | undefined>(() => {
    const from = parseDateTimeValue(value.start);
    const to = parseDateTimeValue(value.end);
    return from || to ? { from, to } : undefined;
  }, [value.end, value.start]);

  const startText = formatDateTime(value.start, locale, "");
  const endText = formatDateTime(value.end, locale, "");
  const summary = startText || endText
    ? `${startText || labels.start} - ${endText || labels.end}`
    : labels.empty;

  const presets: Array<{ kind: PresetKind; label: string }> = [
    { kind: "all", label: labels.all },
    { kind: "today", label: labels.today },
    { kind: "yesterday", label: labels.yesterday },
    { kind: "last7Days", label: labels.last7Days },
    { kind: "last30Days", label: labels.last30Days },
    { kind: "thisMonth", label: labels.thisMonth }
  ];

  const handleSelect = (range: DateRange | undefined) => {
    onChange({
      start: range?.from ? toLocalDateTimeValue(range.from, "start") : "",
      end: range?.to ? toLocalDateTimeValue(range.to, "end") : ""
    });
  };

  return (
    <div className={cx("ui-field ui-date-range-field", className)}>
      <span className="ui-field-label">{labels.trigger}</span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            aria-label={`${labels.trigger}: ${summary}`}
            className="ui-date-range-trigger"
            type="button"
          >
            <span className="ui-date-range-trigger-main">
              <CalendarDays aria-hidden="true" />
              <span>{summary}</span>
            </span>
            <ChevronDown aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" className="ui-date-range-popover" sideOffset={8}>
            <div className="ui-date-range-presets" aria-label={labels.trigger}>
              {presets.map((preset) => (
                <button
                  className="ui-date-range-preset"
                  key={preset.kind}
                  onClick={() => {
                    onChange(getPresetValue(preset.kind));
                    setOpen(false);
                  }}
                  type="button"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <DayPicker
              aria-label={labels.calendar}
              className="ui-date-range-calendar"
              mode="range"
              onSelect={handleSelect}
              selected={selectedRange}
              weekStartsOn={1}
            />
            <div className="ui-date-range-time-grid">
              <div className="ui-date-range-time-field">
                <span>{labels.start}</span>
                <SelectInput
                  aria-label={labels.start}
                  className="ui-date-range-time-select"
                  disabled={!value.start}
                  onChange={(event) => onChange({ ...value, start: withTime(value.start, event.target.value) })}
                  value={getTimeValue(value.start, "00:00")}
                >
                  {timeOptions.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </SelectInput>
              </div>
              <div className="ui-date-range-time-field">
                <span>{labels.end}</span>
                <SelectInput
                  aria-label={labels.end}
                  className="ui-date-range-time-select"
                  disabled={!value.end}
                  onChange={(event) => onChange({ ...value, end: withTime(value.end, event.target.value) })}
                  value={getTimeValue(value.end, "23:59")}
                >
                  {timeOptions.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </SelectInput>
              </div>
            </div>
            <div className="ui-date-range-summary" aria-live="polite">
              <span>
                {labels.start}: {startText || labels.empty}
              </span>
              <span>
                {labels.end}: {endText || labels.empty}
              </span>
            </div>
            <div className="ui-date-range-actions">
              <Button onClick={() => setOpen(false)} size="sm" variant="primary">
                {labels.done}
              </Button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
