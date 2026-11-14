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
    [custom, setCustom] = useState(false),
    [error, setError] = useState(""),
    [editor, setEditor] = useState<Bill | "new" | null>(null);
  const bills = state.bills.filter((b) => b.status !== "dismissed");
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
        description="A few details today. A little more peace of mind tomorrow."
      />
      <div className="steps">
        <span className="complete">
          <b>
            <Icon name="check" size={12} />
          </b>{" "}
          Import transactions
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
              <small>{suggestion.horizonSource}</small>
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
                Estimate from the last {suggestion.basisDays} days. Review for
                your selected period.
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
              <h2>Bills we spotted</h2>
              <p className="small muted">
                Recurring transactions, ready for your review.
              </p>
            </div>
            <span className="count">{bills.length}</span>
          </div>
          {bills.length === 0 && (
            <div className="empty-inline">
              <Icon name="bill" size={30} />
              <h3>No recurring bills found</h3>
              <p>Add any upcoming payments you want your plan to cover.</p>
            </div>
          )}
          <div className="candidate-list">
            {bills.map((b) => (
              <article className="candidate" key={b.id}>
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
            <Button kind="ghost" icon="spark" onClick={openAssistant}>
              Review with assistant
            </Button>
          </div>
        </section>
      </div>
      {error && <Notice error>{error}</Notice>}
      <div className="setup-footer">
        <p>
          <Icon name="shield" size={16} />
          You’re in control. Change anything later.
        </p>
        <Button onClick={save}>
          Build my plan
          <Icon name="arrow" size={16} />
        </Button>
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
