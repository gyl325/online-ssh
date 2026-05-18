export function formatDateTimeWithOptions(
  value: string | null | undefined,
  locale: string,
  fallback: string,
  options: Intl.DateTimeFormatOptions
) {
  if (!value) {
    return fallback;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatDateTime(value: string | null | undefined, locale: string, fallback: string) {
  return formatDateTimeWithOptions(value, locale, fallback, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

export function datetimeLocalToIso(value: string) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value.trim().replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}
