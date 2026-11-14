import { useState } from "react";
import {
  addDays,
  computePlan,
  dateLabel,
  emptyState,
  markBillPaid,
  money,
  newId,
  parseMoney,
  previewBalanceUpdate,
  today,
  type Bill,
} from "@/lib/client/model";
import { useApp } from "./context";
import { Button, downloadText, Modal, Notice, PageHeading } from "./UI";
import { billIcon, Icon } from "./Icon";
import { clearState } from "@/lib/storage/local";

export function BillDialog({
  bill,
  close,
  onSave,
}: {
  bill?: Bill;
  close: () => void;
  onSave: (bill: Bill) => void;
}) {
  const [name, setName] = useState(bill?.name ?? ""),
    [amount, setAmount] = useState(bill ? String(bill.amountCents / 100) : ""),
    [due, setDue] = useState(bill?.dueDate ?? today()),
    [frequency, setFrequency] = useState<Bill["frequency"]>(
      bill?.frequency ?? "Monthly",
    ),
    [note, setNote] = useState(bill?.note ?? ""),
    [error, setError] = useState("");
  return (
    <Modal title={bill ? "Edit bill" : "Add a bill"} close={close}>
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault();
          const cents = parseMoney(amount);
          if (!name.trim() || cents === null || cents <= 0 || !due) {
            setError("Enter a name, a valid amount above $0, and a due date.");
            return;
          }
          onSave({
            id: bill?.id ?? newId(),
            name: name.trim(),
            amountCents: cents,
            dueDate: due,
            frequency,
            status: bill?.status === "paid" ? "paid" : "confirmed",
            evidence: bill?.evidence ?? [],
            note,
          });
        }}
      >
        <label>
          Bill name
          <input
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Car insurance"
            required
          />
        </label>
        <div className="form-grid">
          <label>
            Amount
            <div className="money-input">
              <span>$</span>
              <input
                inputMode="decimal"
                aria-label="Bill amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
          </label>
          <label>
            Due date
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              required
            />
          </label>
        </div>
        <label>
          Frequency
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as Bill["frequency"])}
          >
            {["Monthly", "Biweekly", "Weekly", "One-time"].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label>
          Notes (optional)
          <textarea
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything you’d like to remember"
          />
        </label>
        {error && <Notice error>{error}</Notice>}
        <div className="form-footer">
          <Button kind="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit">{bill ? "Save changes" : "Add bill"}</Button>
        </div>
      </form>
    </Modal>
  );
}
export function BillsScreen() {
  const { state, change, toast } = useApp();
  const [editor, setEditor] = useState<Bill | "new" | null>(null),
    [pay, setPay] = useState<Bill | null>(null),
    [remove, setRemove] = useState<Bill | null>(null),
    [filter, setFilter] = useState("unpaid"),
    [error, setError] = useState("");
  const bills = state.bills
    .filter(
      (b) =>
        b.status !== "dismissed" &&
        b.status !== "candidate" &&
        (filter === "all" ||
          (filter === "paid" ? b.status === "paid" : b.status === "confirmed")),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  function paid(already: boolean) {
    try {
      change((s) => markBillPaid(s, pay!.id, already));
      setPay(null);
      toast("Bill marked paid. Your plan is up to date.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <PageHeading
        title="The things you’ve got covered."
        description="Every bill, one clear place. Keep the details in your hands."
      >
        <Button icon="plus" onClick={() => setEditor("new")}>
          Add a bill
        </Button>
      </PageHeading>
      <div className="section-heading">
        <div className="segmented">
          {[
            ["unpaid", "Upcoming"],
            ["paid", "Paid"],
            ["all", "All bills"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="small muted">{bills.length} bills</span>
      </div>
      {bills.length ? (
        <div className="bill-list">
          {bills.map((b) => (
            <article className="bill-list-row" key={b.id}>
              <span className="entity-icon">
                <Icon name={billIcon(b.name)} size={23} />
              </span>
              <div className="bill-list-name">
                <h3>{b.name}</h3>
                <p>
                  {b.frequency} <span className="separator">/</span> Due{" "}
                  {dateLabel(b.dueDate)}
                  {b.dueDate > state.plan.horizonEndDate && (
                    <span className="row-flag">Outside this period</span>
                  )}
                </p>
              </div>
              <strong>{money(b.amountCents)}</strong>
              <span className={`pill ${b.status === "paid" ? "paid" : ""}`}>
                {b.status === "paid" ? "Paid" : "Upcoming"}
              </span>
              <div className="bill-list-actions">
                {b.status !== "paid" && (
                  <Button
                    kind="secondary"
                    icon="check"
                    onClick={() => {
                      setPay(b);
                      setError("");
                    }}
                  >
                    Mark paid
                  </Button>
                )}
                <button
                  className="icon-button"
                  aria-label={`Edit ${b.name}`}
                  onClick={() => setEditor(b)}
                >
                  <Icon name="edit" size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Delete ${b.name}`}
                  onClick={() => setRemove(b)}
                >
                  <Icon name="trash" size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel empty-state">
          <Icon name="bill" size={36} />
          <h2>{filter === "paid" ? "A clean slate." : "No bills here yet."}</h2>
          <p>
            {filter === "paid"
              ? "Payments you mark as paid will appear here."
              : "Add your next payment and give it a place in your plan."}
          </p>
          <Button icon="plus" onClick={() => setEditor("new")}>
            Add a bill
          </Button>
        </section>
      )}
      {editor && (
        <BillDialog
          bill={editor === "new" ? undefined : editor}
          close={() => setEditor(null)}
          onSave={(b) => {
            change((s) => ({
              ...s,
              stateVersion: s.stateVersion + 1,
              bills:
                editor === "new"
                  ? [...s.bills, b]
                  : s.bills.map((x) => (x.id === b.id ? b : x)),
            }));
            setEditor(null);
            toast("Bill saved.");
          }}
        />
      )}
      {pay && (
        <Modal title={`Mark ${pay.name} paid`} close={() => setPay(null)}>
          <p className="dialog-copy">
            Was this payment already deducted from the balance you entered (
            {money(state.plan.balanceCents)} on{" "}
            {dateLabel(state.plan.balanceDate, true)})?
          </p>
          <Notice>
            Choose “Yes” if your entered balance already reflects the payment.
            This keeps it from being deducted twice.
          </Notice>
          {error && <Notice error>{error}</Notice>}
          <div className="dialog-options">
            <Button onClick={() => paid(true)}>Yes, already deducted</Button>
            <Button kind="secondary" onClick={() => paid(false)}>
              No, deduct it now
            </Button>
          </div>
        </Modal>
      )}
      {remove && (
        <Modal title="Remove this bill?" close={() => setRemove(null)}>
          <p className="dialog-copy">
            {remove.name} ({money(remove.amountCents)}) will be removed from
            your plan.
          </p>
          <div className="form-footer">
            <Button kind="ghost" onClick={() => setRemove(null)}>
              Keep bill
            </Button>
            <Button
              kind="danger"
              onClick={() => {
                change((s) => ({
                  ...s,
                  stateVersion: s.stateVersion + 1,
                  bills: s.bills.filter((b) => b.id !== remove.id),
                }));
                setRemove(null);
                toast("Bill removed.");
              }}
            >
              Remove bill
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function UpdateScreen() {
  const { state, change, navigate } = useApp();
  const [balance, setBalance] = useState(""),
    [paidIds, setPaidIds] = useState<string[]>([]),
    [allocate, setAllocate] = useState(true),
    [ack, setAck] = useState(false),
    [error, setError] = useState("");
  const cents = parseMoney(balance),
    preview =
      cents !== null && cents >= 0
        ? previewBalanceUpdate(state, cents, paidIds, allocate)
        : null;
  const expired = today() > state.plan.horizonEndDate;
  return (
    <>
      <PageHeading
        title="Life moves. Your plan can too."
        description="Refresh your balance and check off what’s been paid."
      />
      <div className="update-layout">
        <section className="panel">
          <h2>Where things stand today</h2>
          <p className="muted">
            Last balance: {money(state.plan.balanceCents)} on{" "}
            {dateLabel(state.plan.balanceDate)}.
          </p>
          <label className="field-block">
            New available balance
            <div className="money-input large">
              <span>$</span>
              <input
                aria-label="New available balance"
                inputMode="decimal"
                value={balance}
                onChange={(e) => {
                  setBalance(e.target.value);
                  setAck(false);
                }}
                placeholder="0.00"
              />
            </div>
          </label>
          <h3>What’s been paid?</h3>
          <p className="small muted">
            Select bills already deducted from the new balance above.
          </p>
          <div className="payment-checklist">
            {state.bills
              .filter((b) => b.status === "confirmed")
              .map((b) => (
                <label key={b.id}>
                  <input
                    type="checkbox"
                    checked={paidIds.includes(b.id)}
                    onChange={(e) =>
                      setPaidIds((prev) =>
                        e.target.checked
                          ? [...prev, b.id]
                          : prev.filter((id) => id !== b.id),
                      )
                    }
                  />
                  <span>
                    {b.name}
                    <small>Due {dateLabel(b.dueDate)}</small>
                  </span>
                  <strong>{money(b.amountCents)}</strong>
                </label>
              ))}
          </div>
          {!state.bills.some((b) => b.status === "confirmed") && (
            <p className="muted">No unpaid bills to check off.</p>
          )}
        </section>
        <section className="panel update-preview">
          <span className="pill">Before you confirm</span>
          <h2>Since your last update</h2>
          {preview ? (
            <>
              <div className="preview-money">
                <span>Available to spend after update</span>
                <strong>{money(preview.remainderCents)}</strong>
              </div>
              <div className="detail-rows">
                <p>
                  Bills marked paid<strong>{preview.closed.length}</strong>
                </p>
                <p>
                  Balance decrease after those bills
                  <strong>
                    {money(Math.max(0, preview.unexplainedCents))}
                  </strong>
                </p>
                <p>
                  Remaining everyday spending
                  <strong>{money(preview.state.plan.essentialsCents)}</strong>
                </p>
              </div>
              {preview.unexplainedCents > 0 && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={allocate}
                    onChange={(e) => setAllocate(e.target.checked)}
                  />
                  <span>
                    Count{" "}
                    {money(
                      Math.min(
                        state.plan.essentialsCents,
                        preview.unexplainedCents,
                      ),
                    )}{" "}
                    of the decrease as everyday spending.
                  </span>
                </label>
              )}
              {preview.excessCents > 0 && (
                <Notice error>
                  {money(preview.excessCents)} is beyond your everyday budget.
                  This amount is shown separately and needs review.
                </Notice>
              )}
              {preview.unexplainedCents < 0 && (
                <>
                  <Notice>
                    Your balance is {money(-preview.unexplainedCents)} higher
                    than expected. Did income or a refund arrive? If this is a
                    paycheck, start a new period in Settings.
                  </Notice>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                    />
                    I’ve reviewed the increase and want to keep this period.
                  </label>
                </>
              )}
            </>
          ) : (
            <div className="empty-inline">
              <Icon name="refresh" size={30} />
              <p>Enter your new balance to see exactly what will change.</p>
            </div>
          )}
          {expired && (
            <Notice error>
              This period has ended. Start a new period in Settings to update
              your balance.
            </Notice>
          )}
          {error && <Notice error>{error}</Notice>}
          <div className="form-footer">
            <Button kind="ghost" onClick={() => navigate("/app")}>
              Cancel
            </Button>
            <Button
              disabled={
                !preview || expired || (preview.unexplainedCents < 0 && !ack)
              }
              onClick={() => {
                if (!preview) {
                  setError("Enter a valid balance.");
                  return;
                }
                change(() => preview.state);
                navigate("/app");
              }}
            >
              Confirm update
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}

export function SettingsScreen() {
  const { state, change, navigate, toast, openAssistant } = useApp();
  const [end, setEnd] = useState(state.plan.horizonEndDate),
    [essentials, setEssentials] = useState(
      String(state.plan.essentialsCents / 100),
    ),
    [reserve, setReserve] = useState(String(state.plan.reserveCents / 100)),
    [reconfirmed, setReconfirmed] = useState(false),
    [clear, setClear] = useState(false),
    [newPeriod, setNewPeriod] = useState(false),
    [error, setError] = useState("");
  const changedDate = end !== state.plan.horizonEndDate;
  return (
    <>
      <PageHeading
        title="A plan that feels like yours."
        description="Fine-tune the details. Stay in control of your data."
      />
      <div className="settings-layout">
        <section className="panel">
          <h2>Your planning preferences</h2>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              const ec = parseMoney(essentials),
                rc = parseMoney(reserve);
              if (
                ec === null ||
                rc === null ||
                ec < 0 ||
                rc < 0 ||
                end < state.plan.balanceDate ||
                (changedDate && !reconfirmed)
              ) {
                setError(
                  "Review your dates and enter valid non-negative amounts. Confirm everyday spending again after changing the period.",
                );
                return;
              }
              change((s) => ({
                ...s,
                stateVersion: s.stateVersion + 1,
                plan: {
                  ...s.plan,
                  horizonEndDate: end,
                  essentialsCents: ec,
                  reserveCents: rc,
                },
              }));
              setError("");
              toast("Plan preferences saved.");
            }}
          >
            <label>
              Plan through
              <input
                type="date"
                min={state.plan.balanceDate}
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value);
                  setReconfirmed(false);
                }}
              />
            </label>
            <div className="form-grid">
              <label>
                Everyday spending
                <div className="money-input">
                  <span>$</span>
                  <input
                    aria-label="Everyday spending budget"
                    inputMode="decimal"
                    value={essentials}
                    onChange={(e) => setEssentials(e.target.value)}
                  />
                </div>
              </label>
              <label>
                Reserve
                <div className="money-input">
                  <span>$</span>
                  <input
                    aria-label="Reserve budget"
                    inputMode="decimal"
                    value={reserve}
                    onChange={(e) => setReserve(e.target.value)}
                  />
                </div>
              </label>
            </div>
            {changedDate && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={reconfirmed}
                  onChange={(e) => setReconfirmed(e.target.checked)}
                />
                I’ve reviewed everyday spending for this new period.
              </label>
            )}
            {error && <Notice error>{error}</Notice>}
            <div className="form-footer">
              <Button type="submit">Save preferences</Button>
            </div>
          </form>
          <div className="thin-line" />
          <div className="section-heading">
            <div>
              <h3>A new paycheck, a new period.</h3>
              <p className="small muted">
                Review your next bills and set a fresh balance.
              </p>
            </div>
            <Button kind="secondary" onClick={() => setNewPeriod(true)}>
              Start new period
            </Button>
          </div>
        </section>
        <div className="settings-right">
          <section className="panel">
            <div className="section-heading">
              <span className="entity-icon">
                <Icon name="spark" />
              </span>
              <span className="pill">
                {state.aiConsent ? "Enabled" : "Off"}
              </span>
            </div>
            <h2>Your assistant, your choice.</h2>
            <p>
              With your permission, your messages, plan balances, amounts,
              dates, bill names, and a limited set of cleaned transaction
              descriptions may be sent to the assistant service and its AI
              provider.
            </p>
            <p className="small muted">
              Your full CSV stays in this browser. You can always use every
              manual form without AI.
            </p>
            <Button
              kind="secondary"
              onClick={() =>
                state.aiConsent
                  ? change((s) => ({
                      ...s,
                      aiConsent: false,
                      stateVersion: s.stateVersion + 1,
                    }))
                  : openAssistant()
              }
            >
              {state.aiConsent ? "Turn assistant off" : "Review and enable"}
            </Button>
          </section>
          <section className="panel">
            <h2>Your data belongs to you.</h2>
            <p>
              Saved on this device, in this browser. Export a copy whenever you
              like.
            </p>
            <Button
              kind="secondary"
              icon="download"
              onClick={() =>
                downloadText(
                  `covered-plan-${today()}.json`,
                  JSON.stringify(state, null, 2),
                  "application/json",
                )
              }
            >
              Export my data
            </Button>
            <div className="thin-line" />
            <button className="danger-link" onClick={() => setClear(true)}>
              <Icon name="trash" size={15} />
              Clear all local data
            </button>
          </section>
        </div>
      </div>
      {clear && (
        <Modal title="Clear this device’s plan?" close={() => setClear(false)}>
          <p className="dialog-copy">
            This removes your current plan, transactions, and bills from this
            browser. Export a copy first if you’d like to keep them.
          </p>
          <div className="form-footer">
            <Button kind="ghost" onClick={() => setClear(false)}>
              Keep my data
            </Button>
            <Button
              kind="danger"
              onClick={() => {
                if (!clearState()) {
                  toast(
                    "Browser storage could not be cleared. Please try again.",
                  );
                  return;
                }
                change(() => emptyState());
                setClear(false);
                navigate("/");
                toast("Your local plan was cleared.");
              }}
            >
              Clear data
            </Button>
          </div>
        </Modal>
      )}
      {newPeriod && (
        <Modal
          title="Start a fresh planning period?"
          close={() => setNewPeriod(false)}
        >
          <p className="dialog-copy">
            Your imported history stays. Review the balance, everyday spending,
            and the next dates for your recurring bills before building the new
            plan.
          </p>
          <div className="form-footer">
            <Button kind="ghost" onClick={() => setNewPeriod(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                change((s) => ({
                  ...s,
                  stateVersion: s.stateVersion + 1,
                  sample: false,
                  lastUpdate: null,
                  plan: {
                    ...s.plan,
                    confirmed: false,
                    balanceCents: 0,
                    balanceDate: today(),
                    horizonEndDate: addDays(today(), 13),
                  },
                  bills: s.bills
                    .filter(
                      (b) =>
                        b.frequency !== "One-time" && b.status !== "dismissed",
                    )
                    .map((b) => {
                      const interval =
                        b.frequency === "Weekly"
                          ? 7
                          : b.frequency === "Biweekly"
                            ? 14
                            : 30;
                      let due =
                        b.status === "paid"
                          ? addDays(b.dueDate, interval)
                          : b.dueDate;
                      while (due < today()) due = addDays(due, interval);
                      return {
                        ...b,
                        dueDate: due,
                        status: "candidate" as const,
                      };
                    }),
                }));
                setNewPeriod(false);
                navigate("/setup/plan");
              }}
            >
              Review new period
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function TransactionsScreen({
  search: initialSearch = "",
}: {
  search?: string;
}) {
  const { state, navigate } = useApp();
  const [search, setSearch] = useState(initialSearch);
  const transactions = [...state.transactions]
    .filter((t) =>
      `${t.description} ${t.date} ${money(t.amountCents)}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <PageHeading
        title="The story behind your numbers."
        description="Your imported history helps spot patterns. It isn’t deducted again."
      >
        <Button
          icon="upload"
          kind="secondary"
          onClick={() => navigate("/setup/import")}
        >
          Import transactions
        </Button>
      </PageHeading>
      <section className="panel">
        <div className="section-heading">
          <h2>
            Transactions <span className="count">{transactions.length}</span>
          </h2>
          <div className="search-field">
            <Icon name="search" size={16} />
            <input
              aria-label="Search transactions"
              placeholder="Search transactions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Details</th>
                <th className="number">Amount</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td className="nowrap">{dateLabel(t.date, true)}</td>
                  <td>{t.description}</td>
                  <td>
                    {t.transfer
                      ? "Possible transfer"
                      : t.duplicate
                        ? "Possible duplicate"
                        : t.amountCents > 0
                          ? "Income"
                          : "Spending"}
                  </td>
                  <td className="number nowrap">{money(t.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {transactions.length === 0 && (
          <div className="empty-inline">
            <Icon name="search" size={30} />
            <h3>
              {search ? "No matching transactions" : "No transactions yet"}
            </h3>
            <p>
              {search
                ? "Try another name or date."
                : "Import a CSV to see your transaction history here."}
            </p>
          </div>
        )}
      </section>
    </>
  );
}
