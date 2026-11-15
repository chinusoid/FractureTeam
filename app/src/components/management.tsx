import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  buildSetupSuggestion,
  computePlan,
  dateLabel,
  emptyState,
  everydayForNextPeriod,
  markBillPaid,
  money,
  newId,
  nextPayday,
  parseMoney,
  previewBalanceUpdate,
  startNextPeriod,
  today,
  type Bill,
} from "@/lib/client/model";
import { useApp } from "./context";
import { Button, downloadText, Modal, Notice, PageHeading } from "./UI";
import { billIcon, Icon } from "./Icon";
import { clearState } from "@/lib/storage/local";
import { aiWhere, onAiWhereChange, setAiWhere, type AiWhere } from "@/lib/client/onDevice";
import { guideDueLine, lowerBillGuide } from "@/lib/client/lowerBill";
import { PlusOffer, PlusTag, usePlus } from "./Plus";

/** What to try and what to say to lower a bill or cancel a subscription. Built on the device. */
function LowerBillDialog({
  bill,
  category,
  periodEnd,
  close,
  edit,
}: {
  bill: Bill;
  category: string | null;
  periodEnd: string;
  close: () => void;
  edit: () => void;
}) {
  const { toast } = useApp();
  const guide = lowerBillGuide(bill, category, { periodEnd });
  async function copy() {
    try {
      await navigator.clipboard.writeText(guide.script);
      toast("Script copied. Paste it into their chat or read it on the call.");
    } catch {
      toast("Copying isn’t available here. Select the text and copy it instead.");
    }
  }
  return (
    <Modal title={guide.title} close={close}>
      <div className="lower-bill" data-testid="lower-bill">
        <p className="small muted">{guideDueLine(bill)}</p>
        <p className="lower-lead">{guide.lead}</p>
        {guide.dueDateTip && <Notice>{guide.dueDateTip}</Notice>}
        <h3>What to try</h3>
        <ol>
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <h3>What to say</h3>
        <blockquote className="lower-script" data-testid="lower-script">
          {guide.script}
        </blockquote>
        <div className="form-footer">
          <Button kind="secondary" onClick={() => void copy()}>
            Copy the script
          </Button>
          <Button
            onClick={() => {
              close();
              edit();
            }}
          >
            Got a new price? Update the bill
          </Button>
        </div>
        <p className="small muted">
          Covered doesn’t call anyone for you or take a cut. Whatever you
          save stays yours.
        </p>
      </div>
    </Modal>
  );
}

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
            recurrenceAnchorDay: bill?.dueDate === due && bill.frequency === frequency ? bill.recurrenceAnchorDay : undefined,
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
const CATEGORY_LABEL: Record<string, string> = {
  rent: "Housing",
  insurance: "Insurance",
  phone: "Phone",
  internet: "Internet",
  utilities: "Utilities",
  subscription: "Subscription",
  gym: "Membership",
  loan: "Loan",
  other_bill: "Bill",
  card_payment: "Card payment",
  savings_transfer: "Transfer",
  person_transfer: "Transfer",
  everyday: "Everyday",
  income: "Income",
};
const PER_MONTH: Record<Bill["frequency"], number> = { Monthly: 1, Biweekly: 26 / 12, Weekly: 52 / 12, "One-time": 0 };

type Category = { label: string; confidence: number };
/** The model's category when it is at least 50% sure. */
const sureCategory = (c: Category | undefined) => (c && c.confidence >= 0.5 ? c.label : null);
/** Money moved to savings or to a person, income and everyday spending get no "lower this bill" guide. */
const NOT_A_BILL = new Set(["savings_transfer", "person_transfer", "income", "everyday"]);
const GUIDE_LINK: Record<string, string> = {
  subscription: "Cancel or pause",
  gym: "Cancel or pause",
  rent: "Ease it",
  utilities: "Ease it",
};

/** Bill categories from the Covered model (our own, runs in the browser; loaded only on this screen). */
function useCategories(bills: Bill[]) {
  const [cats, setCats] = useState<Record<string, Category>>({});
  const key = bills.map((b) => `${b.id}:${b.name}`).join("|");
  useEffect(() => {
    let alive = true;
    import("@/lib/ai/own/model")
      .then(({ predictCategory }) => {
        if (!alive) return;
        const out: Record<string, Category> = {};
        for (const b of bills) {
          const p = predictCategory(b.name);
          out[b.id] = { label: p.label, confidence: p.confidence };
        }
        setCats(out);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return cats;
}

export function BillsScreen() {
  const { state, change, toast } = useApp();
  const [editor, setEditor] = useState<Bill | "new" | null>(null),
    [pay, setPay] = useState<Bill | null>(null),
    [remove, setRemove] = useState<Bill | null>(null),
    [lower, setLower] = useState<Bill | null>(null),
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
  const active = state.bills.filter((b) => b.status === "confirmed" || b.status === "paid");
  const cats = useCategories(active);
  const recurring = new Map<string, Bill>();
  for (const b of active) {
    const c = cats[b.id];
    if (c && (c.label === "subscription" || c.label === "gym") && c.confidence >= 0.5 && PER_MONTH[b.frequency] > 0) {
      if (!recurring.has(b.name)) recurring.set(b.name, b);
    }
  }
  const subs = [...recurring.values()];
  const subsMonthly = Math.round(subs.reduce((s, b) => s + b.amountCents * PER_MONTH[b.frequency], 0));
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
      {subs.length > 0 && (
        <section className="subs-card" aria-label="Subscriptions and memberships">
          <span className="entity-icon">
            <Icon name="spark" size={20} />
          </span>
          <div>
            <strong>
              {subs.length} subscription{subs.length > 1 ? "s" : ""} and memberships:{" "}
              {money(subsMonthly)} a month, {money(subsMonthly * 12)} a year
            </strong>
            <p>
              Found by the Covered model, our own model running on your
              device. Worth a look if you want more room before payday.
            </p>
            <div className="subs-actions">
              {subs.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="pill subs-pill"
                  onClick={() => setLower(b)}
                  aria-label={`Cancel or pause ${b.name}`}
                >
                  {b.name} · {money(b.amountCents)}
                  <Icon name="arrow" size={12} />
                </button>
              ))}
            </div>
          </div>
        </section>
      )}
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
                  {cats[b.id] && cats[b.id].confidence >= 0.5 && (
                    <span
                      className="row-flag category-flag"
                      title={`Covered model, ${Math.round(cats[b.id].confidence * 100)}% sure`}
                    >
                      {CATEGORY_LABEL[cats[b.id].label] ?? "Bill"}
                    </span>
                  )}
                  {b.status === "confirmed" &&
                    b.amountCents > 0 &&
                    !NOT_A_BILL.has(sureCategory(cats[b.id]) ?? "") && (
                      <button
                        type="button"
                        className="text-button lower-link"
                        onClick={() => setLower(b)}
                      >
                        {GUIDE_LINK[sureCategory(cats[b.id]) ?? ""] ?? "Lower it"}
                        <span className="sr-only"> {b.name}</span>
                      </button>
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
      {lower && (
        <LowerBillDialog
          bill={lower}
          category={sureCategory(cats[lower.id])}
          periodEnd={state.plan.horizonEndDate}
          close={() => setLower(null)}
          edit={() => setEditor(lower)}
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
  const expired = today() > state.plan.horizonEndDate;
  // A paycheck in the new balance starts the next pay period; once the period has ended that is the only way on.
  const [paycheck, setPaycheck] = useState(false);
  const next = expired || paycheck;
  const cadence = useMemo(() => buildSetupSuggestion(state.transactions).payCadence, [state.transactions]);
  // Paid early: the next payday is the one after the payday this plan runs to.
  const [payday, setPayday] = useState(() =>
      nextPayday(state.plan.horizonEndDate, cadence, state.plan.horizonEndDate > today() ? state.plan.horizonEndDate : today()),
    ),
    [everyday, setEveryday] = useState(() => String(everydayForNextPeriod(state) / 100));
  const cents = parseMoney(balance),
    everydayCents = parseMoney(everyday);
  const preview =
    !next && cents !== null && cents >= 0
      ? previewBalanceUpdate(state, cents, paidIds, allocate)
      : null;
  let nextError = "";
  let nextPreview: ReturnType<typeof startNextPeriod> | null = null;
  if (next && cents !== null && cents >= 0) {
    try {
      nextPreview = startNextPeriod(state, cents, paidIds, payday, everydayCents ?? -1);
    } catch (e) {
      nextError = e instanceof Error ? e.message : "Check the numbers for the new period.";
    }
  }
  const nextPlan = nextPreview ? computePlan(nextPreview.state) : null;
  // Carrying the plan to the next paycheck is the paid job: with Plus off, the offer comes first.
  const [plus, turnOnPlus] = usePlus();
  const [offer, setOffer] = useState(false),
    [busy, setBusy] = useState(false);
  function startNext() {
    if (!nextPreview) return;
    change(() => nextPreview.state);
    navigate("/app");
  }
  return (
    <>
      <PageHeading
        title={expired ? "Payday. Start your next period." : "Life moves. Your plan can too."}
        description={
          expired
            ? "Enter your new balance and next payday. Your bills, reserve and settings carry over."
            : "Refresh your balance and check off what’s been paid."
        }
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
          {expired ? (
            <Notice>
              Your period ended {dateLabel(state.plan.horizonEndDate)}, so this update starts the next one.
            </Notice>
          ) : (
            <label className="checkbox-row">
              <input type="checkbox" checked={paycheck} onChange={(e) => setPaycheck(e.target.checked)} />
              <span>
                My paycheck is in this balance: start the next period <PlusTag />
              </span>
            </label>
          )}
          {next && (
            <div className="next-period-fields">
              <label className="field-block">
                Next payday
                <input type="date" aria-label="Next payday" value={payday} onChange={(e) => setPayday(e.target.value)} />
              </label>
              <label className="field-block">
                Everyday spending until then
                <div className="money-input">
                  <span>$</span>
                  <input aria-label="Everyday spending for the new period" inputMode="decimal" value={everyday} onChange={(e) => setEveryday(e.target.value)} />
                </div>
              </label>
            </div>
          )}
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
          <h2>{next ? "Your next period" : "Since your last update"}</h2>
          {next ? (
            nextPreview && nextPlan ? (
              <>
                <div className="preview-money">
                  <span>Available to spend until {dateLabel(payday)}</span>
                  <strong data-testid="next-period-remainder">{money(nextPreview.remainderCents)}</strong>
                </div>
                <div className="detail-rows">
                  <p>
                    Bills marked paid<strong>{nextPreview.closed.length}</strong>
                  </p>
                  <p data-testid="ended-period-paid">
                    Bills paid in the period that is ending
                    <strong>{money(nextPreview.state.lastUpdate?.endedPeriod?.paidCents ?? 0)}</strong>
                  </p>
                  <p>
                    Bills due before {dateLabel(payday)}
                    <strong>
                      {nextPlan.bills.length} · {money(nextPlan.billsCents)}
                    </strong>
                  </p>
                  <p>
                    Everyday spending<strong>{money(nextPreview.state.plan.essentialsCents)}</strong>
                  </p>
                  <p>
                    Your reserve, carried over<strong>{money(nextPreview.state.plan.reserveCents)}</strong>
                  </p>
                </div>
                <p className="small muted">
                  Your bills, reserve and settings carry over. Nothing is imported again.
                </p>
              </>
            ) : (
              <div className="empty-inline">
                <Icon name="refresh" size={30} />
                <p>{nextError || "Enter your new balance to see the next period."}</p>
              </div>
            )
          ) : preview ? (
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
                    paycheck, tick “My paycheck is in this balance” to start
                    the next period.
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
          {error && <Notice error>{error}</Notice>}
          <div className="form-footer">
            <Button kind="ghost" onClick={() => navigate("/app")}>
              Cancel
            </Button>
            {next ? (
              <Button
                disabled={!nextPreview}
                onClick={() => {
                  if (!nextPreview) {
                    setError(nextError || "Enter a valid balance.");
                    return;
                  }
                  if (plus) startNext();
                  else setOffer(true);
                }}
              >
                Start next period
              </Button>
            ) : (
              <Button
                disabled={!preview || (preview.unexplainedCents < 0 && !ack)}
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
            )}
          </div>
        </section>
      </div>
      {offer && (
        <Modal title="Carrying your plan over is part of Covered Plus" close={() => setOffer(false)}>
          <PlusOffer
            title="Keep your plan going with Covered Plus"
            lead="Building a plan is free, as often as you like. Plus carries this one to your next paycheck: bills, reserve, settings and what-ifs stay, and nothing is imported again."
            busy={busy}
            onAccept={() => {
              setBusy(true);
              void turnOnPlus().then(() => {
                setBusy(false);
                setOffer(false);
                startNext();
              });
            }}
          >
            <Button kind="ghost" onClick={() => setOffer(false)}>
              Not now
            </Button>
          </PlusOffer>
        </Modal>
      )}
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
  const [where, setWhere] = useState<AiWhere>("cloud");
  useEffect(() => {
    setWhere(aiWhere());
    return onAiWhereChange(setWhere);
  }, []);
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
                  // A new end date means a new period was planned: later periods start from this amount.
                  everydayPerPeriodCents: changedDate ? ec : s.plan.everydayPerPeriodCents,
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
                Enter your new balance and next payday. Your bills, reserve and
                settings carry over.
              </p>
            </div>
            <Button kind="secondary" onClick={() => navigate("/app/update")}>
              Start next period
            </Button>
          </div>
          <p className="small muted start-over">
            Rather review every bill again?{" "}
            <button className="text-button" onClick={() => setNewPeriod(true)}>
              Start over with a fresh plan
            </button>
          </p>
        </section>
        <div className="settings-right">
          <section className="panel">
            <div className="section-heading">
              <span className="entity-icon">
                <Icon name="spark" />
              </span>
              <span className="pill">
                {where === "device"
                  ? "Private mode"
                  : state.aiConsent
                    ? "Enabled"
                    : "Off"}
              </span>
            </div>
            <h2>Your assistant, your choice.</h2>
            <div className="where-toggle" role="group" aria-label="Where the assistant runs">
              {(
                [
                  ["cloud", "Cloud"],
                  ["device", "Private, on this device"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={where === value}
                  className={where === value ? "active" : ""}
                  onClick={() => setAiWhere(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {where === "device" ? (
              <p>
                Private mode: our own Covered model answers inside this
                browser. Nothing is sent anywhere, it works offline, and there
                is no daily limit.
              </p>
            ) : (
              <p>
                With your permission, your messages, plan balances, amounts,
                dates, bill names, and a limited set of cleaned transaction
                descriptions may be sent to the assistant service and its AI
                provider.
              </p>
            )}
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
          title="Start over with a fresh plan?"
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
