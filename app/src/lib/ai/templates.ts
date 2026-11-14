/** Deterministic messages built only from verified numbers (plan section 8: money conclusions come from templates). */
import { formatUSD } from "../finance/money";
import { formatDate } from "../finance/dates";
import type { PlanResult, SimulationResult } from "../finance/calc";
import type { ProposalPayload, ProposalPreview } from "../finance/proposals";

export function summaryMessage(plan: PlanResult): string {
  const base = `${formatUSD(plan.billsCents)} in bills, ${formatUSD(plan.essentialsCents)} for everyday spending and your ${formatUSD(
    plan.reserveTargetCents,
  )} reserve`;
  const through = formatDate(plan.periodEnd);
  switch (plan.status) {
    case "ok":
      return `After ${base}, you have ${formatUSD(plan.remainderCents)} left through ${through}.`;
    case "reserve_short":
      return `Bills and everyday spending through ${through} are covered, but you are ${formatUSD(
        plan.shortfallCents,
      )} below your ${formatUSD(plan.reserveTargetCents)} reserve.`;
    case "essentials_short":
      return `Bills through ${through} are covered, but everyday spending is ${formatUSD(plan.shortfallCents)} short and the reserve is used up.`;
    case "bills_short":
      return `You are ${formatUSD(plan.shortfallCents)} short for bills due by ${through}. Choose which bills to pay first; nothing is moved automatically.`;
  }
}

export function simulationMessage(sim: SimulationResult): string {
  if (sim.kind === "invalid") return sim.reason;
  if (sim.kind === "outside_period") {
    return `${formatDate(sim.purchaseDate)} is outside your current plan (${formatDate(sim.periodStart)} – ${formatDate(
      sim.periodEnd,
    )}). Update the plan period first, then check this purchase again.`;
  }
  const amount = formatUSD(sim.amountCents);
  const a = sim.after;
  switch (a.status) {
    case "ok":
      return `After a ${amount} purchase you would still have ${formatUSD(a.remainderCents)} left. Bills, everyday spending and your ${formatUSD(
        a.reserveTargetCents,
      )} reserve stay covered.`;
    case "reserve_short":
      return `A ${amount} purchase leaves you ${formatUSD(a.shortfallCents)} below your ${formatUSD(
        a.reserveTargetCents,
      )} reserve; bills and everyday spending are still covered.`;
    case "essentials_short":
      return `A ${amount} purchase keeps bills covered but leaves everyday spending ${formatUSD(
        a.shortfallCents,
      )} short, and your reserve would be used up.`;
    case "bills_short":
      return `A ${amount} purchase would leave you ${formatUSD(a.shortfallCents)} short for bills in this period.`;
  }
}

export function proposalMessage(payload: ProposalPayload, preview: ProposalPreview): string {
  const after = `Your remainder would go from ${formatUSD(preview.before.remainderCents)} to ${formatUSD(preview.after.remainderCents)}.`;
  if (payload.type === "add_obligation") {
    return `Add ${preview.updated.name}, ${formatUSD(preview.updated.amountCents)} due ${formatDate(
      preview.updated.dueDate,
    )}? ${after} Review and confirm to save it.`;
  }
  const t = preview.target!;
  const parts: string[] = [];
  if (preview.updated.amountCents !== t.amountCents) {
    parts.push(`${formatUSD(t.amountCents)} → ${formatUSD(preview.updated.amountCents)}`);
  }
  if (preview.updated.dueDate !== t.dueDate) {
    parts.push(`due ${formatDate(t.dueDate)} → ${formatDate(preview.updated.dueDate)}`);
  }
  if (preview.updated.name !== t.name) parts.push(`renamed to ${preview.updated.name}`);
  return `${t.name}: ${parts.join(", ")}. ${after} Review and confirm to save it.`;
}

export const NO_PLAN_MESSAGE =
  "Set up your plan first: enter your balance and confirm your bills. Then I can check purchases and bill changes.";

export const CAPABILITIES_MESSAGE =
  "I can check how a purchase affects your plan, prepare a change to a bill, or explain how your remainder is calculated.";
