import { useState } from "react";
import { applyBalanceUpdate, formatDate, formatDelta, formatUSD, previewBalanceUpdate } from "../../lib/finance";
import { useApp } from "../context";
import { parseAmountInput } from "../format";
import { Button, Card, MoneyField, Notice } from "../ui";
import { NoPlan } from "./Home";

export function UpdateBalance() {
  const { state, commit, today, navigate, flash } = useApp();
  const [balance, setBalance] = useState("");
  const [paidIds, setPaidIds] = useState<string[]>([]);
  const [assign, setAssign] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  if (!state.plan?.confirmed || !state.account) return <NoPlan />;
  const account = state.account;

  const candidates = state.obligations
    .filter((o) => o.paymentStatus === "unpaid" && o.confirmationStatus === "confirmed" && o.dueDate <= state.plan!.endDate)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const cents = parseAmountInput(balance, true);
  const preview = cents !== null ? previewBalanceUpdate(state, { newBalanceCents: cents, paidBillIds: paidIds, assignToEssentials: assign }, today) : null;

  const save = () => {
    setSubmitted(true);
    if (cents === null || !preview) return;
    commit(applyBalanceUpdate(state, { newBalanceCents: cents, paidBillIds: paidIds, assignToEssentials: assign }, today, new Date().toISOString()));
    flash("Plan updated");
    navigate("/app");
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Update your plan</h1>
        <p className="muted">
          Last balance: {formatUSD(account.balanceCents)} on {formatDate(account.balanceAsOf)}. Enter what your bank shows now and tick the bills that have gone out.
        </p>
      </div>
      <Card title="1. Your balance now">
        <MoneyField
          id="new-balance"
          label="Available balance today"
          value={balance}
          onChange={setBalance}
          error={submitted && cents === null ? "Enter your current balance." : null}
          testId="new-balance"
          autoFocus
        />
      </Card>
      <Card title="2. Bills that were paid">
        {candidates.length === 0 ? (
          <p className="muted">No unpaid bills in this period.</p>
        ) : (
          <>
            <p className="muted small">Tick a bill only if the payment is already included in the balance above.</p>
            {candidates.map((o) => (
              <label key={o.id} className="check bill-check">
                <input
                  type="checkbox"
                  checked={paidIds.includes(o.id)}
                  onChange={(e: { target: { checked: boolean } }) =>
                    setPaidIds(e.target.checked ? [...paidIds, o.id] : paidIds.filter((x) => x !== o.id))
                  }
                  data-testid={`paid-${o.id}`}
                />
                <span>
                  {o.name} · {formatUSD(o.amountCents)} · due {formatDate(o.dueDate)}
                </span>
              </label>
            ))}
          </>
        )}
      </Card>
      {preview && (
        <Card title="3. What changes" testId="update-preview">
          <table className="formula-table">
            <tbody>
              <tr>
                <td>Previous balance</td>
                <td className="num">{formatUSD(preview.oldBalanceCents)}</td>
              </tr>
              <tr>
                <td>− Bills you marked paid</td>
                <td className="num">{formatUSD(preview.paidTotalCents)}</td>
              </tr>
              <tr>
                <td>= Expected balance</td>
                <td className="num">{formatUSD(preview.expectedBalanceCents)}</td>
              </tr>
              <tr>
                <td>Balance you entered</td>
                <td className="num">{formatUSD(preview.newBalanceCents)}</td>
              </tr>
            </tbody>
          </table>
          {preview.unexplainedDecreaseCents > 0 && (
            <div className="stack-sm">
              <p>
                {formatUSD(preview.unexplainedDecreaseCents)} went out besides the bills you ticked.
              </p>
              <label className="check">
                <input type="checkbox" checked={assign} onChange={(e: { target: { checked: boolean } }) => setAssign(e.target.checked)} data-testid="assign-essentials" />
                Count {formatUSD(preview.essentialsAssignableCents)} of it as everyday spending (budget {formatUSD(preview.essentialsBeforeCents)} →{" "}
                {formatUSD(preview.essentialsBeforeCents - preview.essentialsAssignableCents)})
              </label>
              {preview.excessDecreaseCents > 0 && (
                <Notice tone="warn" title={`${formatUSD(preview.excessDecreaseCents)} more than your everyday budget`}>
                  This part is not assigned to anything. If a bill was paid, tick it above; otherwise it lowers what&apos;s free to spend.
                </Notice>
              )}
            </div>
          )}
          {preview.unexplainedIncreaseCents > 0 && (
            <Notice
              tone="info"
              title={`${formatUSD(preview.unexplainedIncreaseCents)} more than expected`}
              action={preview.suggestNewPeriod ? <Button small variant="secondary" onClick={() => navigate("/app/settings")}>Start a new period</Button> : null}
            >
              Did a paycheck or refund arrive? If your paycheck came in, start a new period so the next bills are planned from it.
            </Notice>
          )}
          <div className="preview-line">
            <span>Free to spend</span>
            <strong className="money big" data-testid="update-after">
              {formatUSD(preview.remainderBeforeCents)} → {formatUSD(preview.remainderAfterCents)}
            </strong>
            <span className="muted small">
              {preview.remainderAfterCents === preview.remainderBeforeCents
                ? "No change: your spending matched the plan."
                : `${formatDelta(preview.remainderAfterCents - preview.remainderBeforeCents)} compared with before.`}
            </span>
          </div>
        </Card>
      )}
      <div className="row-actions">
        <Button onClick={save} testId="save-update" disabled={cents === null}>
          Save update
        </Button>
        <Button variant="ghost" onClick={() => navigate("/app")}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
