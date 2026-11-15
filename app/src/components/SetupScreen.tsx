import { useMemo, useState } from "react";
import {
  buildSetupSuggestion,
  dateLabel,
  money,
  newId,
  parseMoney,
  RESERVE_OPTIONS_CENTS,
  today,
  type Bill,
} from "@/lib/client/model";
import { useApp } from "./context";
import { Button, Notice, PageHeading } from "./UI";
import { billIcon, Icon } from "./Icon";
import { BillDialog } from "./management";
import { INTERVIEW_NOTE } from "@/lib/client/intake";

/** Suggestions with one of these notes need the user's own decision and are never confirmed in bulk. */
const NEEDS_A_LOOK =
  /transfer|varies|latest amount|assumed paid|after your file ends|only if it is a bill/i;

export function SetupScreen() {
  const { state, change, navigate, openAssistant } = useApp();
  const suggestion = useMemo(
    () => buildSetupSuggestion(state.transactions),
    [state.transactions],
  );
  const [balance, setBalance] = useState(
      state.sample || state.plan.balanceCents
        ? String(state.plan.balanceCents / 100)
        : "",
    ),
    [end, setEnd] = useState(state.plan.horizonEndDate),
    [essentials, setEssentials] = useState(
      String(state.plan.essentialsCents / 100),
    ),
    [reserve, setReserve] = useState(state.plan.reserveCents),
    [custom, setCustom] = useState(!RESERVE_OPTIONS_CENTS.includes(state.plan.reserveCents)),
    [error, setError] = useState(""),
    [editor, setEditor] = useState<Bill | "new" | null>(null);
  /** Started without a file: nothing was detected, every number comes from the person. */
  const byHand = state.transactions.length === 0;
  const fromInterview = byHand && state.bills.some((b) => b.note === INTERVIEW_NOTE);
  const bills = state.bills.filter((b) => b.status !== "dismissed");
  const pending = bills.filter((b) => b.status === "candidate");
  const clear = bills.filter(
    (b) => b.status === "candidate" && !NEEDS_A_LOOK.test(b.note),
  );
  const flagged = bills.filter(
    (b) => b.status === "candidate" && NEEDS_A_LOOK.test(b.note),
  );
  /** By hand: the assistant shows what each bill leaves, so it needs the numbers typed so far. */
  function typeBills() {
    const balanceCents = parseMoney(balance),
      essentialsCents = parseMoney(essentials);
    if (balanceCents === null || balanceCents <= 0) {
      setError("Enter your current balance first, so each bill can show what it leaves you.");
      return;
    }
    setError("");
    change((s) => ({
      ...s,
      stateVersion: s.stateVersion + 1,
      plan: {
        ...s.plan,
        balanceCents,
        balanceDate: today(),
        essentialsCents: essentialsCents !== null && essentialsCents >= 0 ? essentialsCents : s.plan.essentialsCents,
        reserveCents: Number.isSafeInteger(reserve) && reserve >= 0 ? reserve : s.plan.reserveCents,
        horizonEndDate: end >= today() ? end : s.plan.horizonEndDate,
      },
    }));
    openAssistant();
  }
  function save() {
    const balanceCents = parseMoney(balance),
      essentialsCents = parseMoney(essentials);
    if (
      balanceCents === null ||
      balanceCents < 0 ||
      essentialsCents === null ||
      essentialsCents < 0 ||
      !Number.isSafeInteger(reserve) ||
      reserve < 0
    ) {
      setError(
        "Enter a valid non-negative balance, everyday spending, and reserve, with at most two decimal places.",
      );
      return;
    }
    if (end < today()) {
      setError("The period must end today or later.");
      return;
    }
    if (state.bills.some((b) => b.status === "candidate")) {
      setError(
        "Confirm or dismiss each suggested bill before building your plan.",
      );
      return;
    }
    change((s) => ({
      ...s,
      stateVersion: s.stateVersion + 1,
      plan: {
        ...s.plan,
        balanceCents,
        balanceDate: today(),
        essentialsCents,
        everydayPerPeriodCents: essentialsCents,
        // A plan built here starts its own pay period, with nothing paid in it yet.
        periodStartDate: today(),
        periodPaidCents: 0,
        reserveCents: reserve,
        horizonEndDate: end,
        confirmed: true,
      },
    }));
    navigate("/app");
  }
  return (
    <>
      <PageHeading
        title="Let’s make it your plan."
        description={
          byHand
            ? "Four numbers and your bills. No file needed."
            : "A few details today. A little more peace of mind tomorrow."
        }
      />
      <div className="steps">
        <span className="complete">
          <b>
            <Icon name="check" size={12} />
          </b>{" "}
          {byHand ? "Start by hand" : "Import transactions"}
        </span>
        <i />
        <span className="active">
          <b>2</b> Make it yours
        </span>
        <i />
        <span>
          <b>3</b> See your plan
        </span>
      </div>
      {fromInterview && (
        <Notice>
          These numbers and bills came from your answers. Check each one: edit a number, confirm or dismiss a bill,
          or add one that is missing. Nothing counts until you press “Build my plan”.
        </Notice>
      )}
      <div className="setup-layout">
        <section className="panel">
          <div className="section-heading">
            <h2>The essentials</h2>
            <span className="pill">Your starting point</span>
          </div>
          <div className="field-block">
            <label htmlFor="balance">
              Current available balance{" "}
              {state.sample && <span className="pill">Sample</span>}
            </label>
            <div className="money-input large">
              <span>$</span>
              <input
                id="balance"
                inputMode="decimal"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <p className="field-help">
              The amount available in your bank account right now. Past
              transactions won’t be deducted again.
            </p>
          </div>
          <div className="form-grid">
            <label>
              Plan through
              <input
                type="date"
                min={today()}
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value);
                }}
              />
              <small>{byHand ? "Usually your next payday. Bills due up to this day are counted." : suggestion.horizonSource}</small>
            </label>
            <label>
              Everyday spending
              <div className="money-input">
                <span>$</span>
                <input
                  aria-label="Everyday spending"
                  inputMode="decimal"
                  value={essentials}
                  onChange={(e) => setEssentials(e.target.value)}
                />
              </div>
              <small>
                {byHand
                  ? "Groceries, transport and other day-to-day costs until that day."
                  : `Estimate from the last ${suggestion.basisDays} days. Review for your selected period.`}
              </small>
            </label>
          </div>
          {suggestion.largePurchases.length > 0 && (
            <p className="field-help">
              Large one-off purchases excluded:{" "}
              {suggestion.largePurchases
                .map((t) => `${t.description} (${money(-t.amountCents)})`)
                .join(", ")}
              .
            </p>
          )}
          <div className="field-block">
            <label>A little breathing room</label>
            <p className="field-help">
              Choose a reserve you’d like to leave untouched.
            </p>
            <div className="reserve-chips">
              {RESERVE_OPTIONS_CENTS.map((n) => (
                <button
                  key={n}
                  className={reserve === n && !custom ? "selected" : ""}
                  onClick={() => {
                    setReserve(n);
                    setCustom(false);
                  }}
                >
                  {money(n)}
                </button>
              ))}
              <button
                className={custom ? "selected" : ""}
                onClick={() => setCustom(true)}
              >
                Custom
              </button>
            </div>
            {custom && (
              <label className="custom-reserve">
                Your reserve
                <div className="money-input">
                  <span>$</span>
                  <input
                    aria-label="Custom reserve"
                    type="number"
                    min="0"
                    step="0.01"
                    value={reserve / 100}
                    onChange={(e) =>
                      setReserve(Math.round(Number(e.target.value) * 100))
                    }
                  />
                </div>
              </label>
            )}
          </div>
          <Notice>
            These are estimates until you select “Build my plan.” Review your
            bills and spending before confirming.
          </Notice>
        </section>
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>{byHand ? "Your bills" : "Bills we spotted"}</h2>
              <p className="small muted">
                {fromInterview
                  ? "From your answers. Confirm, edit or dismiss each one, and add any that are missing."
                  : byHand
                  ? "Add each bill due before the end of your plan."
                  : "Recurring transactions, ready for your review."}
              </p>
            </div>
            <span className="count">{bills.length}</span>
          </div>
          {bills.length === 0 && (
            <div className="empty-inline">
              <Icon name="bill" size={30} />
              <h3>{byHand ? "No bills yet" : "No recurring bills found"}</h3>
              <p>
                {byHand
                  ? "Add rent, insurance, phone, subscriptions: a name, an amount and a due date each."
                  : "Add any upcoming payments you want your plan to cover."}
              </p>
            </div>
          )}
          {clear.length > 1 && (
            <div className="confirm-all">
              <Button
                kind="secondary"
                icon="check"
                onClick={() =>
                  change((s) => ({
                    ...s,
                    stateVersion: s.stateVersion + 1,
                    bills: s.bills.map((x) =>
                      x.status === "candidate" && !NEEDS_A_LOOK.test(x.note)
                        ? { ...x, status: "confirmed" }
                        : x,
                    ),
                  }))
                }
              >
                Confirm {clear.length} bills
              </Button>
              <span className="small muted">
                {flagged.length
                  ? `${flagged.length} with a note ${flagged.length === 1 ? "stays" : "stay"} for you to decide.`
                  : "You can still edit or dismiss each one."}
              </span>
            </div>
          )}
          <div className="candidate-list">
            {bills.map((b) => (
              <article className="candidate" key={b.id} data-pending={b.status === "candidate" ? "" : undefined}>
                <div className="candidate-top">
                  <span className="entity-icon">
                    <Icon name={billIcon(b.name)} size={20} />
                  </span>
                  <div>
                    <h3>{b.name}</h3>
                    <p>
                      {dateLabel(b.dueDate)}{" "}
                      <span className="separator">/</span> {b.frequency}
                    </p>
                  </div>
                  <strong>{money(b.amountCents)}</strong>
                </div>
                {(() => {
                  const flags = b.note
                    .split(/(?<=\.)\s+/)
                    .filter((s) => NEEDS_A_LOOK.test(s));
                  return (
                    flags.length > 0 && (
                      <p className="candidate-flag">
                        <Icon name="info" size={14} />
                        <span>{flags.join(" ")}</span>
                      </p>
                    )
                  );
                })()}
                <details>
                  <summary>
                    {b.evidence.length
                      ? `${b.evidence.length} transactions behind this estimate`
                      : "Manually added bill"}
                  </summary>
                  <p>{b.note}</p>
                  {b.evidence.map((id) => {
                    const t = state.transactions.find((t) => t.id === id);
                    return (
                      t && (
                        <p className="evidence" key={id}>
                          {dateLabel(t.date)}
                          <span>{money(-t.amountCents)}</span>
                        </p>
                      )
                    );
                  })}
                </details>
                <div className="candidate-actions">
                  {b.status === "candidate" ? (
                    <Button
                      kind="secondary"
                      icon="check"
                      onClick={() =>
                        change((s) => ({
                          ...s,
                          stateVersion: s.stateVersion + 1,
                          bills: s.bills.map((x) =>
                            x.id === b.id ? { ...x, status: "confirmed" } : x,
                          ),
                        }))
                      }
                    >
                      Confirm
                    </Button>
                  ) : (
                    <span className="confirmed-text">
                      <Icon name="check" size={14} /> Confirmed
                    </span>
                  )}
                  <Button kind="ghost" onClick={() => setEditor(b)}>
                    Edit
                  </Button>
                  <Button
                    kind="ghost"
                    onClick={() =>
                      change((s) => ({
                        ...s,
                        stateVersion: s.stateVersion + 1,
                        bills: s.bills.map((x) =>
                          x.id === b.id ? { ...x, status: "dismissed" } : x,
                        ),
                      }))
                    }
                  >
                    Dismiss
                  </Button>
                </div>
              </article>
            ))}
          </div>
          <div className="inline-actions">
            <Button
              kind="secondary"
              icon="plus"
              onClick={() => setEditor("new")}
            >
              Add a bill
            </Button>
            <Button kind="ghost" icon="spark" onClick={byHand ? typeBills : openAssistant}>
              {byHand ? "Add bills by typing" : "Review with assistant"}
            </Button>
          </div>
        </section>
      </div>
      <div className="setup-dock">
      {error && <Notice error>{error}</Notice>}
      <div className="setup-footer">
        {pending.length > 0 ? (
          <p>
            <Icon name="bill" size={16} />
            {pending.length === 1
              ? "1 suggested bill still needs Confirm or Dismiss."
              : `${pending.length} suggested bills still need Confirm or Dismiss.`}
            <button
              className="text-button"
              onClick={() =>
                document.querySelector("[data-pending]")?.scrollIntoView({ block: "center" })
              }
            >
              Show me
            </button>
          </p>
        ) : (
          <p>
            <Icon name="shield" size={16} />
            You’re in control. Change anything later.
          </p>
        )}
        <Button onClick={save}>
          Build my plan
          <Icon name="arrow" size={16} />
        </Button>
      </div>
      </div>
      {editor && (
        <BillDialog
          bill={editor === "new" ? undefined : editor}
          close={() => setEditor(null)}
          onSave={(bill) => {
            change((s) => ({
              ...s,
              stateVersion: s.stateVersion + 1,
              bills:
                editor === "new"
                  ? [...s.bills, { ...bill, id: newId() }]
                  : s.bills.map((b) => (b.id === bill.id ? bill : b)),
            }));
            setEditor(null);
          }}
        />
      )}
    </>
  );
}
