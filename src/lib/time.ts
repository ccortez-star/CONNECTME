import { formatInTimeZone } from "date-fns-tz";

export function formatInClassZone(
  date: Date,
  timezone: string,
  pattern = "EEEE, MMMM d, yyyy 'at' h:mm a",
) {
  return formatInTimeZone(date, timezone, pattern);
}

export function formatDateInClassZone(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "EEEE, MMMM d, yyyy");
}

export function formatTimeInClassZone(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "h:mm a");
}
