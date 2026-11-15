import { useCallback, useEffect, useState, type ReactNode } from "react";
import { activatePlus, plusActive } from "@/lib/client/assistant";
import { Button } from "./UI";

const EVENT = "covered:plus-change";

/** What the paid plan is for: keeping the plan going, not building it once. One list for every place it is offered. */
export const PLUS_FEATURES = [
  "Carry your plan from paycheck to paycheck",
  "See what changed since last time, and why",
  "Save and compare what-ifs: a purchase, a new bill, a late paycheck",
  "A payday reminder and a recap of the period",
] as const;

export const PLUS_PRICE = "$10.00";
export const PLUS_PRICE_NOTE = "$10 a month is the price we are testing. The checkout is in test mode: nothing is charged.";
/** The checkout is a test: it shows what is bought and for how much, and charges nothing. */
export const PLUS_CHECKOUT_NOTE =
  "Test mode: no card is needed and nothing is charged. Real payments are not connected yet.";

/** Whether Plus is on in this browser, and a way to turn it on (which also counts one more interested browser). */
export function usePlus(): [boolean, () => Promise<void>] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(plusActive());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const turnOn = useCallback(async () => {
    await activatePlus();
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [on, turnOn];
}

/** Marks a feature that belongs to the paid plan. */
export function PlusTag() {
  return (
    <span className="plus-tag" title="Part of Covered Plus, $10 a month. The checkout runs in test mode.">
      Plus
    </span>
  );
}

export function PlusOffer({
  title,
  lead,
  extra,
  busy = false,
  onAccept,
  children,
}: {
  title: string;
  lead: string;
  /** One more line for the place the offer is shown in. */
  extra?: string;
  busy?: boolean;
  onAccept: () => void;
  children?: ReactNode;
}) {
  // The paywall, then a checkout. Plus turns on only after the checkout is completed.
  const [step, setStep] = useState<"offer" | "checkout">("offer");
  if (step === "checkout")
    return (
      <div className="proposal-card plus-offer plus-checkout" data-testid="plus-checkout">
        <span className="pill">Test mode</span>
        <h3>Checkout</h3>
        <dl className="checkout-lines">
          <div>
            <dt>Covered Plus, monthly</dt>
            <dd>{PLUS_PRICE}</dd>
          </div>
          <div className="checkout-total">
            <dt>Due today</dt>
            <dd>{PLUS_PRICE}</dd>
          </div>
        </dl>
        <p className="small muted">{PLUS_CHECKOUT_NOTE}</p>
        <Button disabled={busy} onClick={onAccept}>
          Pay {PLUS_PRICE} (test)
        </Button>
        <Button kind="ghost" disabled={busy} onClick={() => setStep("offer")}>
          Back
        </Button>
      </div>
    );
  return (
    <div className="proposal-card plus-offer" data-testid="plus-paywall">
      <span className="pill">Covered Plus</span>
      <h3>{title}</h3>
      <p>{lead}</p>
      <ul>
        {PLUS_FEATURES.map((line) => (
          <li key={line}>{line}</li>
        ))}
        {extra && <li>{extra}</li>}
      </ul>
      <p className="plus-price">
        <strong>$10</strong> a month
      </p>
      <p className="small muted">{PLUS_PRICE_NOTE}</p>
      <Button disabled={busy} onClick={() => setStep("checkout")}>
        Continue to checkout
      </Button>
      {children}
    </div>
  );
}
