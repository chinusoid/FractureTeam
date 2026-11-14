import { useState } from "react";
import {
  type Obligation,
  formatDate,
  formatUSD,
  markBillPaid,
  removeObligation,
  upsertObligation,
} from "../../lib/finance";
import { useApp } from "../context";
import { plural } from "../format";
import { Badge, Button, Card, Modal, Notice } from "../ui";
import { BillEditor, ManualBillForm } from "./PlanSetup";
import { NoPlan } from "./Home";

export function Bills() {
  const { state, commit, today, flash } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<Obligation | null>(null);
  const [removing, setRemoving] = useState<Obligation | null>(null);
  if (!state.plan?.confirmed || !state.account) return <NoPlan />;
  const account = state.account;
  const end = state.plan.endDate;

  const sortByDate = (a: Obligation, b: Obligation) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.name.localeCompare(b.name));
  const unpaid = state.obligations.filter((o) => o.paymentStatus === "unpaid").sort(sortByDate);
  const inPeriod = unpaid.filter((o) => o.dueDate <= end);
  const later = unpaid.filter((o) => o.dueDate > end);
  const paid = state.obligations
    .filter((o) => o.paymentStatus === "paid")
    .sort((a, b) => ((a.paidOn ?? "") < (b.paidOn ?? "") ? 1 : -1))
    .slice(0, 10);

  const row = (o: Obligation) => (
    <li key={o.id} className={`bill-row${o.confirmationStatus === "confirmed" ? " is-confirmed" : ""}`} data-testid={`billrow-${o.id}`}>
      <div className="bill-main">
        <div className="bill-name">
          {o.name}
          {o.confirmationStatus === "suggested" && <Badge tone="estimate">Suggested — not counted</Badge>}
          {o.dueDate < today && <Badge tone="danger">overdue</Badge>}
          {o.recurrence && <Badge>{o.recurrence}</Badge>}
          {o.source === "assistant" && <Badge tone="info">added via assistant</Badge>}
        </div>
        <div className="bill-meta">{formatDate(o.dueDate, true)}</div>
      </div>
      <div className="bill-amount money">{formatUSD(o.amountCents)}</div>
      {editing === o.id ? (
        <BillEditor
          bill={o}
          onCancel={() => setEditing(null)}
          onSave={(p) => {
            commit(upsertObligation(state, { ...o, ...p, confirmationStatus: "confirmed" }));
            setEditing(null);
            flash(`${p.name} saved`);
          }}
        />
      ) : (
        <div className="row-actions">
          {o.confirmationStatus === "suggested" && (
            <Button small onClick={() => commit(upsertObligation(state, { ...o, confirmationStatus: "confirmed" }))}>
              Confirm
            </Button>
          )}
          {o.confirmationStatus === "confirmed" && (
            <Button small variant="secondary" onClick={() => setPaying(o)} testId={`pay-${o.id}`}>
              Mark paid
            </Button>
          )}
          <Button small variant="secondary" onClick={() => setEditing(o.id)} testId={`edit-${o.id}`}>
            Edit
          </Button>
          <Button small variant="ghost" onClick={() => setRemoving(o)}>
            Remove
          </Button>
        </div>
      )}
    </li>
  );

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Bills</h1>
        <p className="muted">Only confirmed, unpaid bills due by {formatDate(end)} count in this period.</p>
      </div>
      <Card title={`Due by ${formatDate(end)} (${inPeriod.length})`}>
        {inPeriod.length ? <ul className="bill-list">{inPeriod.map(row)}</ul> : <p className="muted">Nothing due in this period.</p>}
        {adding ? (
          <ManualBillForm onDone={() => setAdding(false)} />
        ) : (
          <Button small variant="secondary" onClick={() => setAdding(true)} testId="add-bill">
            + Add a bill
          </Button>
        )}
      </Card>
      <Card title={`Later (${later.length})`}>
        {later.length ? <ul className="bill-list">{later.map(row)}</ul> : <p className="muted">No later bills.</p>}
      </Card>
      {paid.length > 0 && (
        <Card title="Recently paid">
          <ul className="simple-list muted">
            {paid.map((o) => (
              <li key={o.id}>
                <span>
                  {o.name} · due {formatDate(o.dueDate)}
                  {o.paidOn ? `, marked paid ${formatDate(o.paidOn)}` : ""}
                </span>
                <span className="money">{formatUSD(o.amountCents)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {paying && (
        <Modal
          title={`Mark “${paying.name}” as paid`}
          onClose={() => setPaying(null)}
          testId="pay-modal"
          actions={
            <>
              <Button variant="ghost" onClick={() => setPaying(null)}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                testId="pay-not-reflected"
                onClick={() => {
                  commit(markBillPaid(state, paying.id, false, today));
                  flash(`${paying.name} marked paid; balance lowered by ${formatUSD(paying.amountCents)}`);
                  setPaying(null);
                }}
              >
                No — subtract it now
              </Button>
              <Button
                testId="pay-reflected"
                onClick={() => {
                  commit(markBillPaid(state, paying.id, true, today));
                  flash(`${paying.name} marked paid`);
                  setPaying(null);
                }}
              >
                Yes — already deducted
              </Button>
            </>
          }
        >
          <p>
            Was this {formatUSD(paying.amountCents)} payment already deducted from the balance you entered ({formatUSD(account.balanceCents)} on{" "}
            {formatDate(account.balanceAsOf)})?
          </p>
          <p className="muted small">
            We ask so the payment is never counted twice. {paying.recurrence ? `The next ${paying.recurrence} payment will be added automatically.` : ""}
          </p>
        </Modal>
      )}
      {removing && (
        <Modal
          title={`Remove “${removing.name}”?`}
          onClose={() => setRemoving(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setRemoving(null)}>
                Keep
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  commit(removeObligation(state, removing.id));
                  setRemoving(null);
                }}
              >
                Remove
              </Button>
            </>
          }
        >
          <p>It will no longer be counted in your plan. Use “Mark paid” instead if you paid it.</p>
        </Modal>
      )}
      {unpaid.length === 0 && paid.length === 0 && (
        <Notice tone="info">No bills yet. Add the payments you have to make before {formatDate(end)}.</Notice>
      )}
      <p className="muted small">{plural(unpaid.filter((o) => o.confirmationStatus === "confirmed").length, "confirmed bill")} in total.</p>
    </div>
  );
}
