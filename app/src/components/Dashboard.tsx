import { useState } from "react";
import {
  buildSetupSuggestion,
  computePlan,
  dateLabel,
  daysBetween,
  money,
  simulatePurchase,
  STALE_AFTER_DAYS,
  STATUS_LABEL,
  today,
} from "@/lib/client/model";
import { useApp } from "./context";
import { Button, downloadText, Gauge, Notice, PageHeading } from "./UI";
import { buildReminderIcs, REPEAT_LABEL } from "@/lib/client/reminder";
import { billIcon, Icon } from "./Icon";
import { parseMoney, today as todayIso } from "@/lib/client/model";

/** What is free per day from today through the end of the period (whole cents, rounded down). */
function perDay(remainderCents: number, endDate: string): number | null {
  const start = todayIso();
  if (remainderCents <= 0 || endDate < start) return null;
  const toDay = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
  const days = toDay(endDate) - toDay(start) + 1;
  return days >= 1 ? Math.floor(remainderCents / days) : null;
}

export function Dashboard() {
  const { state, navigate, openAssistant, toast } = useApp();
  const plan = computePlan(state),
    p = state.plan;
  const [purchase, setPurchase] = useState(""),
    [date, setDate] = useState(today()),
    [result, setResult] = useState<ReturnType<typeof simulatePurchase> | null>(
      null,
    );
  function remind() {
    // Repeat only when the period really ends on the paycheck found in the import.
    const suggestion = buildSetupSuggestion(state.transactions);
    const cadence =
      suggestion.endsOnPayday && suggestion.horizon === p.horizonEndDate
        ? suggestion.payCadence
        : null;
    downloadText(
      "covered-reminder.ics",
      buildReminderIcs({
        date: p.horizonEndDate,
        url: `${window.location.origin}/app/update`,
        cadence,
      }),
      "text/calendar",
    );
    const repeats = cadence ? REPEAT_LABEL[cadence] : null;
    toast(
      `Reminder for ${dateLabel(p.horizonEndDate)} downloaded${repeats ? `, repeating ${repeats}` : ""}. Open the file to add it to your calendar.`,
    );
  }
  const allocated =
    p.balanceCents > 0
      ? ((p.balanceCents - plan.remainderCents) / p.balanceCents) * 100
      : 0;
  const due = [...plan.bills].sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate),
  );
  return (
    <>
      <PageHeading
        title="A little clarity. A lot less worry."
        description="Here’s where your money stands, and what’s already spoken for."
      >
        <Button
          kind="secondary"
          icon="refresh"
          onClick={() => navigate("/app/update")}
        >
          Update balance
        </Button>
        <Button icon="plus" onClick={openAssistant}>
          Ask assistant
        </Button>
      </PageHeading>
      {daysBetween(p.balanceDate, today()) >= STALE_AFTER_DAYS && (
        <Notice>
          Your balance is {daysBetween(p.balanceDate, today())} days old. Update
          it to keep this plan useful.{" "}
          <button
            className="text-button"
            onClick={() => navigate("/app/update")}
          >
            Update now
          </button>
        </Notice>
      )}
      {p.horizonEndDate < today() && (
        <Notice error>
          This planning period has ended. Start a new period in Settings before
          making spending decisions.{" "}
          <button
            className="text-button"
            onClick={() => navigate("/app/settings")}
          >
            Review settings
          </button>
        </Notice>
      )}
      <section
        className={`summary-band ${plan.status !== "covered" ? "needs-attention" : ""}`}
        aria-label="Your plan summary"
      >
        <div className="remaining-summary">
          <span className="status-label">
            <i
              className={
                plan.status === "covered" ? "status-dot" : "status-dot warning"
              }
            />
            {STATUS_LABEL[plan.status]}
          </span>
          <div className="big-money" data-testid="plan-remainder">
            {money(plan.remainderCents)}
          </div>
          <p>
            {plan.remainderCents < 0
              ? "Short of your chosen plan"
              : "Available to spend"}
            <span className="summary-arrow">
              <Icon name="up" size={19} />
            </span>
          </p>
          {perDay(plan.remainderCents, p.horizonEndDate) !== null && (
            <div className="per-day" data-testid="per-day">
              ≈ {money(perDay(plan.remainderCents, p.horizonEndDate)!)} a day
              until {dateLabel(p.horizonEndDate)}
            </div>
          )}
          <div className="period-label">
            <Icon name="calendar" size={13} />
            {dateLabel(p.balanceDate)} – {dateLabel(p.horizonEndDate)}
          </div>
        </div>
        <Gauge percent={allocated} />
        <div className="summary-stat">
          <div className="stat-label">
            <Icon name="bill" size={17} />
            Upcoming bills
          </div>
          <strong>{money(plan.billsCents)}</strong>
          <p>
            {due.length} payments in this period
            <button
              className="icon-button"
              aria-label="View all bills"
              onClick={() => navigate("/app/bills")}
            >
              <Icon name="arrow" />
            </button>
          </p>
        </div>
        <div className="summary-stat">
          <div className="stat-label">
            <Icon name="bag" size={17} />
            Everyday spending
          </div>
          <strong>{money(p.essentialsCents)}</strong>
          <p>
            Set aside for daily life
            <button
              className="icon-button"
              aria-label="Edit everyday spending"
              onClick={() => navigate("/app/settings")}
            >
              <Icon name="arrow" />
            </button>
          </p>
        </div>
      </section>
      <div className="summary-foot">
        <span>
          <Icon name="clock" size={13} />
          Balance updated {dateLabel(p.balanceDate)}
          {state.sample ? " · Sample data" : ""}
        </span>
        {p.horizonEndDate >= today() && (
          <button className="text-button reminder-button" onClick={remind}>
            <Icon name="calendar" size={13} />
            Remind me on {dateLabel(p.horizonEndDate)}
          </button>
        )}
        <details className="calculation">
          <summary>
            How is this calculated?
            <Icon name="chevron" size={14} />
          </summary>
          <div className="calculation-content">
            <h3>Every dollar, accounted for.</h3>
            {[
              ["Available bank balance", p.balanceCents],
              ["Upcoming confirmed bills", -plan.billsCents],
              ["Everyday spending", -p.essentialsCents],
              ["Your reserve", -p.reserveCents],
            ].map(([name, amount]) => (
              <p key={name}>
                {name}
                <strong>{money(Number(amount))}</strong>
              </p>
            ))}
            <p className="calculation-total">
              Available to spend<strong>{money(plan.remainderCents)}</strong>
            </p>
            <small>
              Past CSV transactions help find patterns. They are not deducted
              from your current balance.
            </small>
          </div>
        </details>
      </div>
      {plan.status !== "covered" && (
        <Notice error>
          {plan.status === "bills_short"
            ? `There is a ${money(-plan.afterBills)} shortfall for your bills. Individual bills are not marked covered. Review all payments before spending.`
            : plan.status === "essentials_short"
              ? `Bills are covered, but you need ${money(-plan.afterEssentials)} more for everyday spending.`
              : `Bills and everyday spending are covered. You are ${money(-plan.remainderCents)} below your reserve.`}
        </Notice>
      )}
      <div className="dashboard-content">
        <div className="bills-area">
          <div className="section-heading">
            <h2>
              Coming up <span className="count">{due.length}</span>
            </h2>
            <button
              className="text-button"
              onClick={() => navigate("/app/bills")}
            >
              All bills
              <Icon name="arrow" size={15} />
            </button>
          </div>
          <div className="bills-grid">
            {due.slice(0, 3).map((b) => (
              <article className="bill-card" key={b.id}>
                <div className="bill-card-top">
                  <span className="entity-icon">
                    <Icon name={billIcon(b.name)} size={21} />
                  </span>
                  <span className="pill">
                    <span
                      className={`tiny-dot ${plan.status === "bills_short" ? "warning" : ""}`}
                    />
                    {plan.status === "bills_short" ? "Review" : "Covered"}
                  </span>
                </div>
                <h3>{b.name}</h3>
                <p className="bill-frequency">{b.frequency} payment</p>
                <strong className="bill-amount">{money(b.amountCents)}</strong>
                <div className="bill-card-bottom">
                  <span>
                    <Icon name="calendar" size={13} />
                    {dateLabel(b.dueDate)}
                  </span>
                  <button
                    className="icon-button"
                    aria-label={`Manage ${b.name}`}
                    onClick={() => navigate("/app/bills")}
                  >
                    <Icon name="up" size={17} />
                  </button>
                </div>
              </article>
            ))}
            {!due.length && (
              <div className="empty-inline">
                <Icon name="check" size={24} />
                <h3>No unpaid bills in this period</h3>
                <p>Add a bill whenever you need to.</p>
                <Button kind="secondary" onClick={() => navigate("/app/bills")}>
                  Manage bills
                </Button>
              </div>
            )}
          </div>
          {plan.outsideBills.length > 0 && (
            <details className="outside-bills">
              <summary>
                {plan.outsideBills.length} bills outside this period
              </summary>
              {plan.outsideBills.map((b) => (
                <p key={b.id}>
                  {b.name}
                  <span>
                    {dateLabel(b.dueDate)} · {money(b.amountCents)}
                  </span>
                </p>
              ))}
            </details>
          )}
          <section className="spending-panel">
            <div className="section-heading">
              <div>
                <h2>The bigger picture</h2>
                <p className="small muted">
                  A place for everything in your balance.
                </p>
              </div>
              <span className="pill">This period</span>
            </div>
            <div
              className="allocation-bar"
              role="img"
              aria-label={`Bills ${money(plan.billsCents)}, everyday spending ${money(p.essentialsCents)}, reserve ${money(p.reserveCents)}, available ${money(plan.remainderCents)}`}
            >
              {[
                plan.billsCents,
                p.essentialsCents,
                p.reserveCents,
                Math.max(0, plan.remainderCents),
              ].map((n, i) => (
                <span
                  key={i}
                  className={`allocation-${i}`}
                  style={{ flex: n || 0.01 }}
                />
              ))}
            </div>
            <div className="allocation-legend">
              {[
                ["Bills", plan.billsCents],
                ["Everyday", p.essentialsCents],
                ["Reserve", p.reserveCents],
                ["Available", plan.remainderCents],
              ].map(([label, n], i) => (
                <div key={label}>
                  <span>
                    <i className={`allocation-${i}`} />
                    {label}
                  </span>
                  <strong>{money(Number(n))}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="activity-panel">
            <div className="section-heading">
              <h2>Recent transactions</h2>
              <button
                className="text-button"
                onClick={() => navigate("/app/transactions")}
              >
                View all
                <Icon name="arrow" size={15} />
              </button>
            </div>
            {[...state.transactions]
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, 3)
              .map((t) => (
                <div className="transaction-row" key={t.id}>
                  <span className="entity-icon small-icon">
                    <Icon
                      name={
                        t.amountCents > 0 ? "wallet" : billIcon(t.description)
                      }
                    />
                  </span>
                  <div>
                    <h3>{t.description}</h3>
                    <p>{dateLabel(t.date)}</p>
                  </div>
                  <strong>
                    {t.amountCents > 0 ? "+" : "−"}
                    {money(Math.abs(t.amountCents))}
                  </strong>
                </div>
              ))}
            {!state.transactions.length && (
              <p className="muted">
                Your imported transactions will appear here.
              </p>
            )}
          </section>
        </div>
        <aside className="dashboard-aside">
          <section className="purchase-panel">
            <div className="section-heading">
              <span className="entity-icon">
                <Icon name="bag" size={20} />
              </span>
              <span className="small muted">A little look ahead</span>
            </div>
            <h2>Can it fit your plan?</h2>
            <p>Check a purchase before you make it.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setResult(
                  simulatePurchase(state, parseMoney(purchase) ?? 0, date),
                );
              }}
            >
              <label htmlFor="purchase-amount">Purchase amount</label>
              <div className="money-input">
                <span>$</span>
                <input
                  id="purchase-amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={purchase}
                  onChange={(e) => {
                    setPurchase(e.target.value);
                    setResult(null);
                  }}
                  required
                />
              </div>
              <label htmlFor="purchase-date">Purchase date</label>
              <input
                id="purchase-date"
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setResult(null);
                }}
                required
              />
              <Button type="submit" kind="primary">
                Check a purchase
                <Icon name="arrow" size={16} />
              </Button>
            </form>
            {result &&
              ("error" in result ? (
                <Notice error>{result.error}</Notice>
              ) : (
                <div
                  className={`purchase-result ${result.remainderCents! < 0 ? "warning-result" : ""}`}
                  role="status"
                >
                  <div>
                    <span>Your plan</span>
                    <strong>{money(plan.remainderCents)}</strong>
                  </div>
                  <div>
                    <span>With this purchase</span>
                    <strong data-testid="scenario-remainder">
                      {money(result.remainderCents!)}
                    </strong>
                  </div>
                  <p>{result.message}</p>
                  {perDay(result.remainderCents!, p.horizonEndDate) !== null && (
                    <p className="per-day-after">
                      After it: ≈{" "}
                      {money(perDay(result.remainderCents!, p.horizonEndDate)!)} a
                      day until {dateLabel(p.horizonEndDate)}.
                    </p>
                  )}
                  <small>A preview only. Your balance hasn’t changed.</small>
                </div>
              ))}
          </section>
          <section className="reserve-panel">
            <span className="reserve-mark">
              <Icon name="shield" size={23} />
            </span>
            <div>
              <span className="small">Your breathing room</span>
              <strong>{money(p.reserveCents)}</strong>
              <p>Set aside. Just in case.</p>
            </div>
            <button
              className="icon-button"
              aria-label="Edit reserve"
              onClick={() => navigate("/app/settings")}
            >
              <Icon name="up" size={19} />
            </button>
          </section>
          {state.lastUpdate && (
            <section className="last-update">
              <div className="section-heading">
                <h3>Since last update</h3>
                <Icon name="refresh" size={16} />
              </div>
              <p>
                {state.lastUpdate.closedBills.length
                  ? `${state.lastUpdate.closedBills.join(", ")} marked paid.`
                  : "Balance refreshed."}
              </p>
              <p>
                {money(state.lastUpdate.essentialsSpentCents)} of everyday
                spending accounted for.
              </p>
              {state.lastUpdate.excessCents > 0 && (
                <Notice error>
                  {money(state.lastUpdate.excessCents)} beyond your everyday
                  budget needs review.
                </Notice>
              )}
              <div className="update-summary">
                Available to spend <strong>{money(plan.remainderCents)}</strong>
              </div>
            </section>
          )}
        </aside>
      </div>
      <div className="page-note">
        <Icon name="shield" size={14} />A plan based on what you’ve confirmed.
        Review it whenever life changes.
      </div>
    </>
  );
}
