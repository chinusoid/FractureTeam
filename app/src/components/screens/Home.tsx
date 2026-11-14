import { useState } from "react";
import {
  type SimulationResult,
  STALE_AFTER_DAYS,
  STATUS_LABEL,
  diffDays,
  formatDate,
  formatUSD,
  isISODate,
  newId,
  planInputFromState,
  simulatePurchase,
  computePlan,
} from "../../lib/finance";
import { useApp } from "../context";
import { FormulaBreakdown, SimulationView, SinceLastUpdateCard, dueLabel } from "../cards";
import { describeEvaluation, parseAmountInput, periodLabel, plural, statusTone } from "../format";
import { Badge, Button, Card, EmptyState, MoneyField, Notice, TextField } from "../ui";

export function NoPlan() {
  const { navigate, state } = useApp();
  const hasDraft = state.transactions.length > 0 || state.obligations.length > 0;
  return (
    <EmptyState
      title={hasDraft ? "Your plan isn't built yet" : "No plan yet"}
      actions={
        <>
          {hasDraft && <Button onClick={() => navigate("/setup/plan")}>Finish setup</Button>}
          <Button variant={hasDraft ? "secondary" : "primary"} onClick={() => navigate("/")}>
            Start with sample or your file
          </Button>
        </>
      }
    >
      {hasDraft ? "Confirm your balance and bills to see what's free to spend." : "Import transactions or try the sample to get a plan in a few minutes."}
    </EmptyState>
  );
}

export function Home() {
  const { state, today, navigate, commit, ask, setAssistantOpen } = useApp();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [sim, setSim] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  const input = planInputFromState(state, today);
  if (!input || !state.plan?.confirmed || !state.account) return <NoPlan />;
  const plan = computePlan(input);
  const tone = statusTone(plan.status);
  const staleDays = diffDays(today, state.account.balanceAsOf);
  const expired = today > state.plan.endDate;
  const suggestedCount = state.obligations.filter((o) => o.confirmationStatus === "suggested" && o.paymentStatus === "unpaid").length;

  const check = () => {
    const cents = parseAmountInput(amount);
    if (cents === null || cents <= 0) {
      setSimError("Enter an amount above $0.");
      setSim(null);
      return;
    }
    if (!isISODate(date)) {
      setSimError("Choose a date.");
      setSim(null);
      return;
    }
    setSimError(null);
    setSim(simulatePurchase(input, cents, date));
  };

  const saveScenario = () => {
    if (!sim || sim.kind !== "ok") return;
    commit({
      ...state,
      scenarios: [
        ...state.scenarios,
        {
          id: newId("scn"),
          baseVersion: state.stateVersion,
          label: `${formatUSD(sim.amountCents)} on ${formatDate(sim.purchaseDate)}`,
          purchaseDate: sim.purchaseDate,
          amountCents: sim.amountCents,
          createdAt: new Date().toISOString(),
        },
      ].slice(-10),
    });
  };

  return (
    <div className="stack">
      {state.isSample && (
        <Notice tone="info" title="You're looking at sample data">
          All names and numbers are made up.{" "}
          <button type="button" className="linklike" onClick={() => navigate("/setup/import")}>
            Import your own file
          </button>{" "}
          when you're ready.
        </Notice>
      )}
      {expired ? (
        <Notice
          tone="warn"
          title={`This plan ended on ${formatDate(state.plan.endDate)}`}
          action={<Button small onClick={() => navigate("/app/settings")}>Start a new period</Button>}
          testId="expired"
        >
          Set the next period and everyday spending to keep the numbers meaningful.
        </Notice>
      ) : (
        staleDays > STALE_AFTER_DAYS && (
          <Notice
            tone="warn"
            title={`Balance last updated ${plural(staleDays, "day")} ago`}
            action={<Button small onClick={() => navigate("/app/update")}>Update balance</Button>}
            testId="stale"
          >
            Numbers below use the balance from {formatDate(state.account.balanceAsOf)}.
          </Notice>
        )
      )}
      {suggestedCount > 0 && (
        <Notice
          tone="info"
          title={`${plural(suggestedCount, "suggested bill")} not confirmed`}
          action={<Button small variant="secondary" onClick={() => navigate("/app/bills")}>Review</Button>}
        >
          They are not counted until you confirm them.
        </Notice>
      )}

      <section className={`hero-card tone-${tone}`} data-testid="remainder-card">
        <div className="hero-top">
          <span className="hero-label">Free to spend until {formatDate(plan.periodEnd)}</span>
          <Badge tone={tone === "ok" ? "ok" : tone === "warn" ? "warn" : "danger"}>{STATUS_LABEL[plan.status]}</Badge>
        </div>
        <div className={`hero-number${plan.remainderCents < 0 ? " negative" : ""}`} data-testid="remainder">
          {formatUSD(plan.remainderCents)}
        </div>
        <p className="hero-verdict" data-testid="verdict">
          {describeEvaluation(plan)}
        </p>
        <p className="hero-meta">
          Balance {formatUSD(plan.availableCents)} as of {formatDate(plan.balanceAsOf)} · Period {periodLabel(plan.periodStart, plan.periodEnd)}
        </p>
        <FormulaBreakdown plan={plan} />
      </section>

      {state.lastUpdate && (
        <SinceLastUpdateCard summary={state.lastUpdate} onDismiss={() => commit({ ...state, lastUpdate: null })} />
      )}

      <div className="grid-2 align-start">
        <Card title="Check a purchase" testId="purchase-card">
          <form
            className="stack-sm"
            onSubmit={(e: { preventDefault: () => void }) => {
              e.preventDefault();
              check();
            }}
          >
            <div className="grid-2">
              <MoneyField id="purchase-amount" label="Amount" value={amount} onChange={setAmount} error={simError} testId="purchase-amount" />
              <TextField id="purchase-date" type="date" label="Date" value={date} min={today} max={plan.periodEnd} onChange={setDate} testId="purchase-date" />
            </div>
            <div className="row-actions">
              <Button type="submit" testId="purchase-check">
                Check
              </Button>
              <Button variant="ghost" onClick={() => { setAssistantOpen(true); }}>
                Ask in words
              </Button>
            </div>
          </form>
          {sim && <SimulationView result={sim} testId="purchase-result" />}
          {sim?.kind === "ok" && (
            <div className="row-actions">
              <Button small variant="secondary" onClick={saveScenario}>
                Save this scenario
              </Button>
            </div>
          )}
          {state.scenarios.length > 0 && (
            <details className="evidence">
              <summary>Saved scenarios ({state.scenarios.length})</summary>
              <ul>
                {state.scenarios.map((s) => {
                  const r = simulatePurchase(input, s.amountCents, s.purchaseDate);
                  return (
                    <li key={s.id}>
                      {s.label}: {r.kind === "ok" ? `${formatUSD(r.after.remainderCents)} left — ${describeEvaluation(r.after)}` : "outside the current period"}{" "}
                      <button type="button" className="linklike" onClick={() => commit({ ...state, scenarios: state.scenarios.filter((x) => x.id !== s.id) })}>
                        remove
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="muted small">Scenarios are what-ifs; they never change your balance.</p>
            </details>
          )}
        </Card>

        <Card
          title={`Bills until ${formatDate(plan.periodEnd)}`}
          actions={<Button small variant="ghost" onClick={() => navigate("/app/bills")}>Manage</Button>}
          testId="bills-card"
        >
          {plan.status === "bills_short" && (
            <Notice tone="danger" title={`${formatUSD(plan.shortfallCents)} short for these bills`}>
              Not every bill can be paid from the current balance. Decide which to pay first; we won&apos;t pick for you.
            </Notice>
          )}
          {plan.billsInPeriod.length === 0 ? (
            <p className="muted">No unpaid bills due in this period.</p>
          ) : (
            <ul className="simple-list">
              {plan.billsInPeriod.map((b) => (
                <li key={b.id}>
                  <span>
                    <strong>{b.name}</strong>
                    <span className="muted small"> · {dueLabel(b.dueDate, today)}</span>
                    {b.overdue && <Badge tone="danger">overdue</Badge>}
                  </span>
                  <span className="list-right">
                    <span className="money">{formatUSD(b.amountCents)}</span>
                    {plan.billsCovered ? <Badge tone="ok">covered</Badge> : <Badge tone="danger">at risk</Badge>}
                  </span>
                </li>
              ))}
              <li className="list-total">
                <span>Total</span>
                <span className="money">{formatUSD(plan.billsCents)}</span>
              </li>
            </ul>
          )}
          {plan.billsOutsidePeriod.length > 0 && (
            <details className="evidence">
              <summary>Later bills, not counted now ({plan.billsOutsidePeriod.length})</summary>
              <ul className="simple-list muted">
                {plan.billsOutsidePeriod.slice(0, 10).map((b) => (
                  <li key={b.id}>
                    <span>
                      {b.name} · {formatDate(b.dueDate)}
                    </span>
                    <span className="money">{formatUSD(b.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      </div>

      <Card title="Keep it current">
        <div className="row-actions">
          <Button onClick={() => navigate("/app/update")} testId="go-update">
            Update balance
          </Button>
          <Button variant="secondary" onClick={() => ask("Explain my plan")}>
            Explain my plan
          </Button>
          <Button variant="secondary" onClick={() => navigate("/app/bills")}>
            A bill changed
          </Button>
        </div>
      </Card>
    </div>
  );
}
