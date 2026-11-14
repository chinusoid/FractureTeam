/**
 * The sample plan shown on the landing page and the purchase check next to it.
 * One set of numbers feeds both, so the card and the answers cannot drift apart.
 * Pure calculation: no stored state, no network, no AI.
 */
import { STATUS_LABEL, computePlan, simulatePurchase, type PlanInput, type PlanStatus } from "../finance";

/** Fixed dates: the check only needs a purchase inside the period, not today's calendar. */
const DAY = "2026-01-05";
const PERIOD_END = "2026-01-19";

export const HERO_PLAN = {
  balanceCents: 220_000,
  everydayCents: 35_000,
  reserveCents: 25_000,
  bills: [
    { id: "rent", name: "Oakwood Apartments", amountCents: 110_000 },
    { id: "insurance", name: "Saferoad Auto Insurance", amountCents: 15_000 },
    { id: "internet", name: "Brightwave Internet", amountCents: 5_000 },
  ],
} as const;

export const HERO_PRESETS = [
  { amountCents: 8_000, label: "$80 dinner" },
  { amountCents: 40_000, label: "$400 sneakers" },
  { amountCents: 150_000, label: "$1,500 laptop" },
] as const;

export function heroPlanInput(): PlanInput {
  return {
    today: DAY,
    balanceCents: HERO_PLAN.balanceCents,
    balanceAsOf: DAY,
    startDate: DAY,
    endDate: PERIOD_END,
    essentialRemainingCents: HERO_PLAN.everydayCents,
    reserveTargetCents: HERO_PLAN.reserveCents,
    obligations: HERO_PLAN.bills.map((b) => ({
      ...b,
      dueDate: PERIOD_END,
      paymentStatus: "unpaid" as const,
      confirmationStatus: "confirmed" as const,
    })),
  };
}

/** What the landing card shows, computed from the same numbers the check uses. */
export function heroPlanSummary() {
  const plan = computePlan(heroPlanInput());
  return {
    balanceCents: plan.availableCents,
    billsCents: plan.billsCents,
    everydayCents: plan.essentialsCents,
    reserveCents: plan.reserveTargetCents,
    availableCents: plan.remainderCents,
    allocatedPercent: Math.round(((plan.billsCents + plan.essentialsCents + plan.reserveTargetCents) / plan.availableCents) * 100),
  };
}

const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);

export type HeroCheck =
  | { ok: false; message: string }
  | { ok: true; status: PlanStatus; label: string; message: string; amountCents: number; remainderCents: number };

/** Reads what a person typed: "400", "$1,500", "79.99". Null when it is not a dollar amount. */
export function parseHeroAmount(value: string): number | null {
  const s = value.trim().replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** The answer names the first layer the purchase would break: bills, everyday spending or the reserve. */
export function checkHeroPurchase(amountCents: number | null): HeroCheck {
  if (amountCents === null) return { ok: false, message: "Enter an amount in dollars, like 400." };
  const sim = simulatePurchase(heroPlanInput(), amountCents, DAY);
  if (sim.kind === "invalid") return { ok: false, message: sim.reason };
  if (sim.kind !== "ok") return { ok: false, message: "This purchase is outside the sample plan’s period." };
  const { status, shortfallCents, remainderCents } = sim.after;
  const message =
    status === "bills_short"
      ? `${usd(shortfallCents)} short for your bills. This purchase would take money already set aside for rent and other bills.`
      : status === "essentials_short"
        ? `Bills stay covered, but everyday spending would be ${usd(shortfallCents)} short.`
        : status === "reserve_short"
          ? `${usd(shortfallCents)} below your ${usd(sim.after.reserveTargetCents)} reserve. Bills and everyday spending stay covered.`
          : `${usd(remainderCents)} would remain. Bills, everyday spending and your reserve stay covered.`;
  return { ok: true, status, label: STATUS_LABEL[status], message, amountCents, remainderCents };
}
