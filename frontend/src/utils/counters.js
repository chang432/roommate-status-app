const CALENDAR_DAY_MS = 24 * 60 * 60 * 1000;

function dateParts(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).reduce((parts, part) => {
    if (part.type !== "literal") parts[part.type] = part.value;
    return parts;
  }, {});
}

export function dateInTimeZone(timestamp = Date.now(), timeZone = "UTC") {
  const parts = dateParts(new Date(timestamp), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function completedDaysSince(startDate, currentDate) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const current = Date.parse(`${currentDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(current)) return 0;
  return Math.max(0, Math.floor((current - start) / CALENDAR_DAY_MS));
}

export function formatCounterDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], {
    timeZone: "UTC",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

export function counterValueLabel(mode, value) {
  if (mode === "automatic") return `${value} day${value === 1 ? "" : "s"}`;
  return String(value);
}
