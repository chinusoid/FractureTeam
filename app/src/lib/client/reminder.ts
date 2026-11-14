// A calendar reminder (.ics) for the day the plan period ends, so the plan gets updated on payday.
// The file is built in the browser and opened by the user's own calendar; nothing is sent anywhere.
import { addDays } from "./model";

export type PayCadence = "weekly" | "biweekly" | "semimonthly" | "monthly";

export interface ReminderInput {
  /** The day to be reminded on, YYYY-MM-DD (the end of the plan period). */
  date: string;
  /** Where the reminder sends the user back to. */
  url: string;
  /** Repeat on this rhythm. Leave out for a one-time reminder. */
  cadence?: PayCadence | null;
  now?: Date;
}

/** Twice-a-month paydays have no single calendar rule that fits every employer, so they do not repeat. */
const REPEAT: Record<PayCadence, string | null> = {
  weekly: "FREQ=WEEKLY",
  biweekly: "FREQ=WEEKLY;INTERVAL=2",
  semimonthly: null,
  monthly: "FREQ=MONTHLY",
};

export const REPEAT_LABEL: Record<PayCadence, string | null> = {
  weekly: "every week",
  biweekly: "every two weeks",
  semimonthly: null,
  monthly: "every month",
};

const compact = (date: string) => date.replace(/-/g, "");
const escapeText = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Calendar files limit a line to 75 bytes; longer lines continue on the next one after a space. */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 74;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut--;
    parts.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
}

export function buildReminderIcs({ date, url, cadence, now = new Date() }: ReminderInput): string {
  const stamp = `${now.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
  let host = "covered";
  try {
    host = new URL(url).host || host;
  } catch {
    /* keep the fallback */
  }
  const repeat = cadence ? REPEAT[cadence] : null;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Covered//Plan reminder//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:covered-plan-${date}@${host}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(date)}`,
    `DTEND;VALUE=DATE:${compact(addDays(date, 1))}`,
    ...(repeat ? [`RRULE:${repeat}`] : []),
    `SUMMARY:${escapeText("Update your Covered plan")}`,
    `DESCRIPTION:${escapeText(`Enter your new balance and tick the bills you paid. It takes about two minutes.\n${url}`)}`,
    `URL:${url}`,
    "TRANSP:TRANSPARENT",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText("Update your Covered plan")}`,
    "TRIGGER:PT9H", // 9:00 on the day (all-day events start at midnight)
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
