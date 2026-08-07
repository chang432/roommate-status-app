export const DAY_MS = 24 * 60 * 60 * 1000;

export function completedDaysSince(timestamp, now = Date.now()) {
  return Math.max(0, Math.floor((now - Number(timestamp)) / DAY_MS));
}

export function counterValueLabel(mode, value) {
  if (mode === "automatic") return `${value} day${value === 1 ? "" : "s"}`;
  return String(value);
}
