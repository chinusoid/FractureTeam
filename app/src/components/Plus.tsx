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

export const PLUS_PRICE_NOTE =
  "$10 a month is the price we are testing. Free during early access: no card, no sign-up.";

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
    <span className="plus-tag" title="Part of Covered Plus. Free during early access.">
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
  return (
    <div className="proposal-card plus-offer">
      <span className="pill">Free during early access</span>
      <h3>{title}</h3>
      <p>{lead}</p>
      <ul>
        {PLUS_FEATURES.map((line) => (
          <li key={line}>{line}</li>
        ))}
        {extra && <li>{extra}</li>}
      </ul>
      <p className="small muted">{PLUS_PRICE_NOTE}</p>
      <Button disabled={busy} onClick={onAccept}>
        Get Plus free
      </Button>
      {children}
    </div>
  );
}
