/**
 * Financial dates are calendar dates "YYYY-MM-DD" without a time zone.
 * All arithmetic goes through a "day number" (days since 1970-01-01 in UTC),
 * so the user's time zone can never shift a due date.
 */
export type ISODate = string;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string" || !ISO_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function makeISODate(year: number, month: number, day: number): ISODate | null {
  const s = `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
  return isISODate(s) ? s : null;
}

export function toDayNumber(date: ISODate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayNumber(day: number): ISODate {
  const dt = new Date(day * DAY_MS);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** a - b in days */
export function diffDays(a: ISODate, b: ISODate): number {
  return toDayNumber(a) - toDayNumber(b);
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isWithin(date: ISODate, start: ISODate, end: ISODate): boolean {
  return date >= start && date <= end;
}

/** Number of calendar days in [start, end], inclusive. */
export function daysInclusive(start: ISODate, end: ISODate): number {
  return Math.max(0, diffDays(end, start) + 1);
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Adds months keeping the anchor day-of-month where possible (Jan 31 -> Feb 28 -> Mar 31). */
export function addMonths(date: ISODate, months: number, anchorDay?: number): ISODate {
  const [y, m, d] = date.split("-").map(Number);
  const anchor = anchorDay ?? d;
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(anchor, daysInMonth(ny, nm));
  return `${ny}-${pad(nm)}-${pad(day)}`;
}

export function dayOfMonth(date: ISODate): number {
  return Number(date.slice(8, 10));
}

/** Today's calendar date in the device's local time zone. */
export function localToday(now: Date = new Date()): ISODate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const WITH_WEEKDAY = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "Nov 18" or "Wed, Nov 18" — formatted in UTC so the calendar date never shifts. */
export function formatDate(date: ISODate, withWeekday = false): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (withWeekday ? WITH_WEEKDAY : SHORT).format(dt);
}

export function relativeDay(date: ISODate, today: ISODate): string {
  const diff = diffDays(date, today);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 1) return `in ${diff} days`;
  return `${-diff} days ago`;
}
