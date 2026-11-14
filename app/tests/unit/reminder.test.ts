import { test } from "vitest";
import assert from "node:assert/strict";
import { buildReminderIcs } from "../../src/lib/client/reminder";
import { buildSetupSuggestion, detectDateFormats, generateSampleCsv, normalizeRows, parseCsv } from "../../src/lib/client/model";

const NOW = new Date("2026-11-14T10:20:30Z");
const base = { date: "2026-11-24", url: "https://covered.example/app/update", now: NOW };
const lines = (ics: string) => ics.split("\r\n");

test("reminder: an all-day event on the given day with a 9:00 alert", () => {
  const ics = buildReminderIcs(base);
  const l = lines(ics);
  assert.equal(l[0], "BEGIN:VCALENDAR");
  assert.equal(l.at(-2), "END:VCALENDAR");
  assert.equal(l.at(-1), "", "the file ends with a line break");
  assert.ok(l.includes("DTSTART;VALUE=DATE:20261124"));
  assert.ok(l.includes("DTEND;VALUE=DATE:20261125"));
  assert.ok(l.includes("DTSTAMP:20261114T102030Z"));
  assert.ok(l.includes("UID:covered-plan-2026-11-24@covered.example"));
  assert.ok(l.includes("SUMMARY:Update your Covered plan"));
  assert.ok(l.includes("URL:https://covered.example/app/update"));
  assert.ok(l.includes("TRIGGER:PT9H"));
  assert.equal(ics.includes("RRULE"), false, "one-time by default");
  assert.equal(/[^\r]\n/.test(ics), false, "every line break is CRLF");
});

test("reminder: the end date rolls over months and years", () => {
  assert.ok(lines(buildReminderIcs({ ...base, date: "2026-11-30" })).includes("DTEND;VALUE=DATE:20261201"));
  assert.ok(lines(buildReminderIcs({ ...base, date: "2026-12-31" })).includes("DTEND;VALUE=DATE:20270101"));
  assert.ok(lines(buildReminderIcs({ ...base, date: "2028-02-28" })).includes("DTEND;VALUE=DATE:20280229"));
});

test("reminder: repeats on the pay rhythm; twice-a-month pay stays one-time", () => {
  const rule = (cadence: "weekly" | "biweekly" | "semimonthly" | "monthly") => lines(buildReminderIcs({ ...base, cadence })).find((x) => x.startsWith("RRULE:"));
  assert.equal(rule("weekly"), "RRULE:FREQ=WEEKLY");
  assert.equal(rule("biweekly"), "RRULE:FREQ=WEEKLY;INTERVAL=2");
  assert.equal(rule("monthly"), "RRULE:FREQ=MONTHLY");
  assert.equal(rule("semimonthly"), undefined);
  assert.equal(buildReminderIcs({ ...base, cadence: null }).includes("RRULE"), false);
});

test("reminder: text is escaped and long lines are folded to 75 bytes", () => {
  const ics = buildReminderIcs({ ...base, url: "https://covered.example/app/update?from=calendar&note=a-very-long-address-that-needs-more-than-one-line" });
  for (const line of lines(ics)) assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line}`);
  const unfolded = ics.replace(/\r\n /g, "");
  assert.match(unfolded, /DESCRIPTION:Enter your new balance and tick the bills you paid\. It takes about two minutes\.\\n/, "the line break inside the text is escaped");
  assert.ok(unfolded.includes("URL:https://covered.example/app/update?from=calendar&note=a-very-long-address-that-needs-more-than-one-line"));
  assert.ok(unfolded.includes("\\nhttps://covered.example/app/update?from=calendar"));
});

test("sample A: the suggested period ends on a payday and knows the pay rhythm", () => {
  const today = "2026-11-14";
  const csv = parseCsv(generateSampleCsv("A", today));
  const format = detectDateFormats(csv.rows.map((r) => r[csv.mapping.date]));
  const { transactions } = normalizeRows(csv.rows, csv.mapping, format, false);
  const suggestion = buildSetupSuggestion(transactions, today);
  assert.equal(suggestion.payCadence, "biweekly");
  assert.equal(suggestion.endsOnPayday, true);
  assert.ok(suggestion.horizon > today);
});
