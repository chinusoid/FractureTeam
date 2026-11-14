/**
 * Contract between the browser and POST /api/intake: the setup interview.
 * The order and wording of the questions are fixed here, in code. The model only reads the
 * person's answer to one question; every value it returns is checked before it is used.
 */
import { z } from "zod";
import { isISODate } from "../finance/dates";

export const INTAKE_STEPS = ["balance", "payday", "bills", "everyday", "reserve"] as const;
export type IntakeStep = (typeof INTAKE_STEPS)[number];

export const INTAKE_QUESTIONS: Record<IntakeStep, string> = {
  balance: "How much money is in your checking account right now?",
  payday: "When is your next payday? The plan will run up to that day.",
  bills: "Which bills are due before then? Give a name, an amount and a due date for each, for example: rent $1,100 on the 20th, phone $65 on the 22nd.",
  everyday: "How much do you expect to spend on everyday things like groceries and transport until then?",
  reserve: "How much do you want to keep untouched as a reserve? Many people start with $250.",
};

/** Names the server and the test model share: the JSON form's name and the prefix of the context item. */
export const INTAKE_FORMAT_NAME = "intake_extract";
export const INTAKE_CONTEXT_PREFIX = "INTERVIEW ";

export const MAX_INTAKE_BILLS = 30;
/** Dollars. Anything above this is treated as a misreading, not as an answer. */
export const MAX_INTAKE_USD = 1_000_000;

const isoDate = z.string().refine(isISODate, "Expected a YYYY-MM-DD date");
const cents = z.number().int().min(0).max(MAX_INTAKE_USD * 100);

export const IntakeBillSchema = z.object({
  name: z.string().min(1).max(60),
  amountCents: cents.min(1),
  dueDate: isoDate,
});
export type IntakeBill = z.infer<typeof IntakeBillSchema>;

export const IntakeRequestSchema = z.object({
  consent: z.object({ aiEnabled: z.literal(true), policyVersion: z.number().int().min(1) }),
  today: isoDate,
  step: z.enum(INTAKE_STEPS),
  answer: z.string().min(1).max(500),
  /** The end of the plan, once known: bill dates are checked against it. */
  endDate: isoDate.nullable(),
  /** Names already collected, so a repeated bill is not added twice. */
  knownBills: z.array(z.string().max(60)).max(MAX_INTAKE_BILLS),
});
export type IntakeRequest = z.infer<typeof IntakeRequestSchema>;

export const IntakeResponseSchema = z.object({
  step: z.enum(INTAKE_STEPS),
  /** true = the answer was read and the interview can move on (for bills: stay until `done`). */
  understood: z.boolean(),
  /** What was read, or what is missing. Built from checked values, never from the model's own text. */
  message: z.string().max(600),
  balanceCents: cents.optional(),
  endDate: isoDate.optional(),
  everydayCents: cents.optional(),
  reserveCents: cents.optional(),
  bills: z.array(IntakeBillSchema).max(MAX_INTAKE_BILLS).optional(),
  /** Bills step only: the person has no more bills to add. */
  done: z.boolean().optional(),
});
export type IntakeResponse = z.infer<typeof IntakeResponseSchema>;
