// "Lower this bill": what to try and what to say, picked by the bill's category (from the Covered model)
// and filled in with the user's own numbers. Built on the device; Covered never calls anyone or takes a cut.
import { addDays, dateLabel, money, type Bill } from "./model";

export type GuideKind = "negotiate" | "cancel" | "insurance" | "assistance" | "hardship" | "due_date";

export interface BillGuide {
  kind: GuideKind;
  title: string;
  /** One line with the user's own numbers. */
  lead: string;
  steps: string[];
  /** What to say on the phone or in chat. Plain text, ready to copy. */
  script: string;
  /** Moving the due date to just after payday, when the bill lands inside the period. */
  dueDateTip: string | null;
}

const PER_YEAR: Record<Bill["frequency"], number> = { Monthly: 12, Biweekly: 26, Weekly: 52, "One-time": 0 };
const FREQ_WORD: Record<Bill["frequency"], string> = {
  Monthly: "a month",
  Biweekly: "every two weeks",
  Weekly: "a week",
  "One-time": "once",
};

const KIND_BY_CATEGORY: Record<string, GuideKind> = {
  internet: "negotiate",
  phone: "negotiate",
  subscription: "cancel",
  gym: "cancel",
  insurance: "insurance",
  utilities: "assistance",
  loan: "hardship",
  card_payment: "hardship",
  rent: "due_date",
};

/** Ordinal day for scripts: 1st, 2nd, 3rd, 4th ... 21st, 22nd. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

export interface GuideContext {
  /** Last day of the plan period: the next payday. */
  periodEnd: string;
}

export function lowerBillGuide(bill: Bill, category: string | null, ctx: GuideContext): BillGuide {
  const kind = (category && KIND_BY_CATEGORY[category]) || "negotiate";
  const yearly = bill.amountCents * PER_YEAR[bill.frequency];
  const price = `${money(bill.amountCents)} ${FREQ_WORD[bill.frequency]}`;
  const paid = bill.evidence.length;
  const history =
    bill.frequency === "Monthly" && paid >= 3
      ? ` I've paid you every month for the last ${paid} months.`
      : paid >= 3
        ? ` I've paid you on schedule for my last ${paid} payments.`
        : "";
  const lead = yearly
    ? `You pay ${price}: ${money(yearly)} a year. Every $10 off a month keeps $120 a year in your pocket.`
    : `This is a one-time payment of ${money(bill.amountCents)}.`;

  // A monthly bill due inside the period is the one that squeezes it: suggest a date right after payday.
  // Days 29-31 don't exist every month, so those become the 1st.
  const dayAfter = Number(addDays(ctx.periodEnd, 1).slice(8));
  const newDay = dayAfter > 28 ? 1 : dayAfter;
  const dueDateTip =
    bill.frequency === "Monthly" && bill.dueDate <= ctx.periodEnd
      ? `Ask to move the due date to the ${ordinal(newDay)}, just after payday. Many companies let you choose your due date, and the payment then lands when the money is already there.`
      : null;

  const name = bill.name;
  switch (kind) {
    case "cancel":
      return {
        kind,
        title: `Cancel or pause ${name}`,
        lead: yearly ? `You pay ${price}: ${money(yearly)} a year if you keep it.` : lead,
        steps: [
          "Check when you last used it. If you can't remember, that's your answer.",
          "Cancel in the account settings on their site or app. Look for “Manage plan” or “Membership”.",
          "Ask to pause instead if you'll want it back. Many services and gyms allow a pause of a month or more.",
          "Save the cancellation confirmation, and check your next statement that the charge stopped.",
        ],
        script: `Hi, I'd like to cancel my ${name} membership, effective today.${history} Please confirm the cancellation in writing and that I won't be charged again. If you can't cancel it, I'd like to pause it instead.`,
        dueDateTip: null,
      };
    case "insurance":
      return {
        kind,
        title: `Lower ${name}`,
        lead,
        steps: [
          "Get two quotes from other insurers for the same coverage, so you know the going rate.",
          "Call your insurer and ask which discounts you're not getting: autopay, paperless, bundling, safe driver, low mileage.",
          "Ask what raising your deductible would save, and only choose it if you could pay that deductible from savings.",
          "Ask to drop coverage you no longer need, such as rental car cover you never use.",
        ],
        script: `Hi, I'm reviewing my ${name} policy before it renews.${history} I've been quoted a lower price elsewhere for similar coverage. Before I switch, which discounts am I eligible for, and what would my premium be with them? I'd also like to know the price with a higher deductible.`,
        dueDateTip,
      };
    case "assistance":
      return {
        kind,
        title: `Ease ${name}`,
        lead,
        steps: [
          "Ask about budget billing: the same amount every month instead of high winter or summer bills.",
          "Ask which assistance programs you qualify for. Utilities run their own, and many states offer help through LIHEAP.",
          "If a bill is already late, ask for a payment plan before it goes to collections.",
        ],
        script: `Hi, I'd like help managing my ${name} bill.${history} Could you put me on budget billing, and tell me which payment assistance programs I might qualify for? I'd also like to move my due date if that's possible.`,
        dueDateTip,
      };
    case "hardship":
      return {
        kind,
        title: `Lower ${name}`,
        lead,
        steps: [
          "Call the number on your statement and ask for a lower interest rate. Lenders can say yes to customers who pay.",
          "If money is tight right now, ask about a hardship program: a lower payment or rate for a few months.",
          "Ask to move the due date so the payment comes right after payday.",
          "Get any change confirmed in writing before you pay a different amount.",
        ],
        script: `Hi, I'm calling about my ${name}.${history} I'd like to ask for a lower interest rate. If that's not possible, what hardship options do you have, and can I move my due date to just after my payday?`,
        dueDateTip,
      };
    case "due_date":
      return {
        kind,
        title: `Make ${name} easier to cover`,
        lead,
        steps: [
          "Rent is rarely lowered mid-lease, but its timing can often change.",
          "Ask your landlord to move the due date to just after payday, or to split rent into two payments.",
          "Ask before your lease renews: that's when you have the most say about price and terms.",
        ],
        script: `Hi, I wanted to ask about my rent.${history} My paycheck now arrives a few days after rent is due. Could we move the due date${dueDateTip ? ` to the ${ordinal(newDay)}` : ""}, or split it into two payments each month? I'm happy to put it in writing.`,
        dueDateTip,
      };
    default:
      return {
        kind: "negotiate",
        title: `Lower ${name}`,
        lead,
        steps: [
          "Look up what new customers pay for the same plan today. That's your target price.",
          "Call or chat and ask for the retention or loyalty team: they can offer prices the regular line can't.",
          "Ask them to remove add-ons and equipment rental you don't use.",
          "If they won't move, say you're ready to switch. Then compare and decide.",
        ],
        script: `Hi, I've been reviewing my ${name} bill, which is ${price}.${history} I've seen lower prices for the same service, including your own offers for new customers. Can you lower my rate, or tell me which promotions I qualify for? Otherwise I'm considering switching.`,
        dueDateTip,
      };
  }
}

/** The bill date in the user's words, for the modal subtitle. */
export const guideDueLine = (bill: Bill) => `Next payment ${dateLabel(bill.dueDate)} · ${money(bill.amountCents)}`;
