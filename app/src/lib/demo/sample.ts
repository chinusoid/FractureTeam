/**
 * Synthetic demo data. All names are fictional. Dates are generated relative to "today",
 * so the demo works on any day and reproduces the numbers from the plan:
 * balance $2,200, bills in period $1,300, everyday spending $350, reserve $250 -> $300 left.
 */
import { type ISODate, addDays, addMonths, dayOfMonth, makeISODate } from "../finance/dates";

export const SAMPLE_BALANCE_CENTS = 220000;
export const SAMPLE_RESERVE_CENTS = 25000;

interface Row {
  date: ISODate;
  description: string;
  cents: number;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mdy(date: ISODate): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}`;
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

const MONTHLY_BILLS: { description: string; cents: number; offset: number }[] = [
  { description: "SAFEROAD AUTO INSURANCE", cents: 15000, offset: 3 },
  { description: "OAKWOOD APARTMENTS ONLINE PMT", cents: 110000, offset: 6 },
  { description: "BRIGHTWAVE INTERNET AUTOPAY", cents: 5000, offset: 8 },
  { description: "TRANSFER TO SAVINGS 4521", cents: 20000, offset: 12 },
  { description: "IRONWORKS GYM MEMBERSHIP", cents: 4000, offset: 13 },
  { description: "SKYTALK WIRELESS", cents: 6500, offset: 15 },
  { description: "STREAMFLIX.COM", cents: 1549, offset: 19 },
  { description: "TUNEBOX PREMIUM", cents: 1199, offset: 24 },
];

/** Bank A style: Date,Description,Amount (negative = money out), MM/DD/YYYY, newest first. */
export function generateSampleCsvA(today: ISODate): string {
  const rand = mulberry32(20261114);
  const start = addDays(today, -90);
  const last = addDays(today, -1);
  const rows: Row[] = [];
  const push = (date: ISODate, description: string, cents: number) => {
    if (date >= start && date <= last) rows.push({ date, description, cents });
  };

  // Paycheck every two weeks; the next one is 10 days from today (end of the demo period).
  for (let k = 1; k <= 7; k++) push(addDays(today, 10 - 14 * k), "ACME LOGISTICS PAYROLL PPD", 210000);

  for (const bill of MONTHLY_BILLS) {
    const due = addDays(today, bill.offset);
    const anchor = dayOfMonth(due);
    for (let k = 1; k <= 3; k++) push(addMonths(due, -k, anchor), bill.description, -bill.cents);
  }

  const groceries = [6218, 8840, 7105, 9530, 5877, 10212, 6640, 8125, 7390, 9902, 6015, 8467, 7733];
  const tacos = [1845, 2690, 3120, 2275, 1990, 3405, 2560, 2105, 2980, 2340, 1875, 3260, 2450];
  let g = 0;
  let t = 0;
  for (let d = -90; d <= -1; d++) {
    const date = addDays(today, d);
    if ((d + 90) % 7 === 2) push(date, "GREENLEAF MARKET #0412", -groceries[g++ % groceries.length]);
    if ((d + 90) % 9 === 4) push(date, "QUICKFUEL 0231", -(3000 + Math.round(rand() * 1500)));
    if ((d + 90) % 7 === 5) push(date, "TACO TOWN 118", -tacos[t++ % tacos.length]);
    if (rand() < 0.35) push(date, "BEAN THERE CAFE", -(425 + Math.round(rand() * 325)));
    if (rand() < 0.12) push(date, "CORNER DELI", -(950 + Math.round(rand() * 600)));
    if (rand() < 0.05) push(date, "WELLCARE PHARMACY", -(1200 + Math.round(rand() * 1300)));
    if (rand() < 0.06) push(date, "HOMEBASE GOODS", -(1800 + Math.round(rand() * 2700)));
  }
  // One-off large purchase outside the estimate window, and a same-day double charge to review.
  push(addDays(today, -50), "TECHMART ELECTRONICS", -64999);
  push(addDays(today, -40), "BEAN THERE CAFE", -575);
  push(addDays(today, -40), "BEAN THERE CAFE", -575);
  // The file always ends yesterday, so the 28-day estimate window is fixed.
  push(addDays(today, -1), "BEAN THERE CAFE", -525);

  // Make everyday spending in the last 28 days exactly $891.00 -> $350 for an 11-day period.
  const windowStart = addDays(today, -28);
  const billDescriptions = new Set(MONTHLY_BILLS.map((b) => b.description));
  const everyday = rows.filter(
    (r) => r.cents < 0 && r.date >= windowStart && !billDescriptions.has(r.description) && r.cents > -40000,
  );
  const sum = everyday.reduce((s, r) => s - r.cents, 0);
  const adjust = 89100 - sum;
  const lastGrocery = rows
    .filter((r) => r.description.startsWith("GREENLEAF") && r.date >= windowStart)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (lastGrocery) {
    const updated = -lastGrocery.cents + adjust;
    if (updated > 1000 && updated < 39000) lastGrocery.cents = -updated;
  }

  rows.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  const lines = ["Date,Description,Amount"];
  for (const r of rows) lines.push(`${mdy(r.date)},${r.description},${money(r.cents)}`);
  return lines.join("\n") + "\n";
}

function quoteMoney(cents: number): string {
  return `"${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}"`;
}

/** Bank B style: separate Debit/Credit columns, quoted amounts with thousands separators, running balance. */
export function generateSampleCsvB(today: ISODate): string {
  const rand = mulberry32(777);
  const start = addDays(today, -100);
  const end = addDays(today, -2);
  const rows: Row[] = [];
  const push = (date: ISODate | null, description: string, cents: number) => {
    if (date && date >= start && date <= end) rows.push({ date, description, cents });
  };
  for (let m = -4; m <= 0; m++) {
    const monthStart = addMonths(today.slice(0, 8) + "01", m);
    const [y, mo] = monthStart.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    push(makeISODate(y, mo, 15), "NORTHSTAR HEALTH DIR DEP", 185000);
    push(makeISODate(y, mo, lastDay), "NORTHSTAR HEALTH DIR DEP", 185000);
    push(makeISODate(y, mo, 1), "MAPLE COURT RESIDENCES RENT", -125000);
    push(makeISODate(y, mo, 5), "RIVERBANK AUTO LOAN PMT", -31000);
    push(makeISODate(y, mo, 10), "CITY POWER & LIGHT", -(9000 + Math.round(rand() * 3000)));
    push(makeISODate(y, mo, 14), "PIXELPLAY SUBSCRIPTION", -999);
    push(makeISODate(y, mo, 22), "BLUEBELL MOBILE", -4500);
  }
  for (let d = -100; d <= -2; d++) {
    const date = addDays(today, d);
    if (rand() < 0.2) push(date, "FRESHWAY GROCERS", -(3500 + Math.round(rand() * 6000)));
    if (rand() < 0.1) push(date, "GASNGO STATION", -(2800 + Math.round(rand() * 2000)));
    if (rand() < 0.25) push(date, "MORNING CUP COFFEE", -(350 + Math.round(rand() * 400)));
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let balance = 315000;
  const lines = ['"Posting Date","Description","Debit","Credit","Balance"'];
  const out: string[] = [];
  for (const r of rows) {
    balance += r.cents;
    out.push(
      `${mdy(r.date)},"${r.description}",${r.cents < 0 ? quoteMoney(-r.cents) : ""},${r.cents > 0 ? quoteMoney(r.cents) : ""},${quoteMoney(balance)}`,
    );
  }
  return [...lines, ...out.reverse()].join("\r\n") + "\r\n";
}
