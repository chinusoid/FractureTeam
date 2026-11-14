import { useMemo, useState } from "react";
import {
  type Obligation,
  addDays,
  bumpVersion,
  centsToInput,
  computePlan,
  daysInclusive,
  formatDate,
  formatUSD,
  isISODate,
  newId,
  removeObligation,
  upsertObligation,
} from "../../lib/finance";
import { buildSetupSuggestion, essentialsForPeriod, RESERVE_OPTIONS_CENTS } from "../../lib/import/prefill";
import type { RecurringCandidate } from "../../lib/import/recurring";
import { SAMPLE_BALANCE_CENTS } from "../../lib/demo/sample";
import { ERROR_TEXT, buildAssistantRequest, callAssistant } from "../../lib/client/assistant";
import { useApp } from "../context";
import { describeEvaluation, parseAmountInput, plural } from "../format";
import { Badge, Button, Card, MoneyField, Notice, TextField } from "../ui";

interface ReviewItem {
  candidateId: string;
  displayName: string;
  isLikelyBill: boolean;
  reason: string;
  question: string | null;
}

export function PlanSetup() {
  const { state, commit, today, navigate, requestConsent } = useApp();
  const suggestion = useMemo(
    () => (state.transactions.length ? buildSetupSuggestion(state.transactions, today) : null),
    [state.transactions, today],
  );
  const candidates = useMemo(() => {
    const map = new Map<string, RecurringCandidate>();
    suggestion?.candidates.forEach((c) => map.set(c.id, c));
    return map;
  }, [suggestion]);

  const existing = state.plan?.confirmed ? state.plan : null;
  const estimateFor = (end: string) =>
    suggestion?.essentials && isISODate(end) && end >= today ? essentialsForPeriod(suggestion.essentials, daysInclusive(today, end)) : null;

  const [balance, setBalance] = useState(() =>
    state.account ? centsToInput(state.account.balanceCents) : state.isSample ? centsToInput(SAMPLE_BALANCE_CENTS) : "",
  );
  const [balanceTouched, setBalanceTouched] = useState(!!state.account);
  const [endDate, setEndDate] = useState(() => existing?.endDate ?? suggestion?.endDate ?? addDays(today, 13));
  const [endEdited, setEndEdited] = useState(!!existing);
  const [essentials, setEssentials] = useState(() => {
    if (existing) return centsToInput(existing.essentialRemainingCents);
    const est = estimateFor(suggestion?.endDate ?? addDays(today, 13));
    return est !== null ? centsToInput(est) : "";
  });
  const [essentialsEdited, setEssentialsEdited] = useState(!!existing);
  const [essentialsNeedsCheck, setEssentialsNeedsCheck] = useState(false);
  const [reserve, setReserve] = useState<number | "custom">(existing ? (RESERVE_OPTIONS_CENTS.includes(existing.reserveTargetCents) ? existing.reserveTargetCents : "custom") : 25000);
  const [customReserve, setCustomReserve] = useState(existing && !RESERVE_OPTIONS_CENTS.includes(existing.reserveTargetCents) ? centsToInput(existing.reserveTargetCents) : "");
  const [submitted, setSubmitted] = useState(false);
  const [review, setReview] = useState<Record<string, ReviewItem> | null>(null);
  const [reviewState, setReviewState] = useState<{ status: "idle" | "loading" | "error"; message?: string }>({ status: "idle" });
  const [adding, setAdding] = useState(false);

  const balanceCents = parseAmountInput(balance, true);
  const essentialsCents = parseAmountInput(essentials);
  const reserveCents = reserve === "custom" ? parseAmountInput(customReserve) : reserve;
  const endValid = isISODate(endDate) && endDate >= today;

  const changeEnd = (v: string) => {
    setEndDate(v);
    setEndEdited(true);
    if (!essentialsEdited) {
      const est = estimateFor(v);
      if (est !== null) setEssentials(centsToInput(est));
    } else {
      setEssentialsNeedsCheck(true);
    }
  };

  const unpaid = state.obligations.filter((o) => o.paymentStatus === "unpaid").sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.name.localeCompare(b.name)));
  const suggested = unpaid.filter((o) => o.confirmationStatus === "suggested");
  const suggestedInPeriod = suggested.filter((o) => endValid && o.dueDate <= endDate);

  const errors = {
    balance: balanceCents === null ? "Enter the balance you can spend from today, e.g. 2200." : null,
    end: !endValid ? "Choose a date from today onward." : null,
    essentials: essentialsCents === null ? "Enter an amount (0 if none)." : null,
    reserve: reserveCents === null ? "Enter a reserve amount (0 if none)." : null,
  };
  const valid = !errors.balance && !errors.end && !errors.essentials && !errors.reserve;

  const preview =
    valid && balanceCents !== null && essentialsCents !== null && reserveCents !== null
      ? computePlan({
          today,
          balanceCents,
          balanceAsOf: today,
          startDate: today,
          endDate,
          essentialRemainingCents: essentialsCents,
          reserveTargetCents: reserveCents,
          obligations: state.obligations,
        })
      : null;

  const build = () => {
    setSubmitted(true);
    if (!valid || balanceCents === null || essentialsCents === null || reserveCents === null) return;
    commit(
      bumpVersion({
        ...state,
        account: { currency: "USD", balanceCents, balanceAsOf: today },
        plan: { startDate: today, endDate, essentialRemainingCents: essentialsCents, reserveTargetCents: reserveCents, confirmed: true },
      }),
    );
    navigate("/app");
  };

  const runReview = async () => {
    const ok = await requestConsent();
    if (!ok) {
      setReviewState({ status: "error", message: ERROR_TEXT.no_consent.title + " " + ERROR_TEXT.no_consent.action });
      return;
    }
    const list = suggested.map((o) => candidates.get(o.id)).filter((c): c is RecurringCandidate => !!c);
    if (!list.length) return;
    setReviewState({ status: "loading" });
    const req = buildAssistantRequest(state, today, "setup", "Review these suggested bills.", [], list);
    const res = await callAssistant(req, state.clientId);
    if (!res.ok) {
      const e = ERROR_TEXT[res.code];
      setReviewState({ status: "error", message: `${e.title} ${e.action}` });
      return;
    }
    const items: Record<string, ReviewItem> = {};
    res.data.setupReview?.items.forEach((i) => (items[i.candidateId] = i));
    setReview(items);
    setReviewState({ status: "idle", message: res.data.message });
  };

  const est = suggestion?.essentials;

  return (
    <div className="stack">
      <div className="page-head">
        <h1>{existing ? "Review your plan" : "Set up your plan"}</h1>
        <p className="muted">
          Values marked <Badge tone="estimate">Estimate</Badge> come from your transactions. Check them — nothing is final until you build the plan.
        </p>
      </div>

      <Card title="Money and period">
        <div className="grid-2">
          <MoneyField
            id="balance"
            label="Available balance today"
            value={balance}
            onChange={(v) => {
              setBalance(v);
              setBalanceTouched(true);
            }}
            badge={state.isSample && !balanceTouched ? <Badge tone="info">Sample</Badge> : null}
            hint="What your bank shows as available right now (checking account)."
            error={submitted ? errors.balance : null}
            testId="balance-input"
          />
          <TextField
            id="end-date"
            type="date"
            label="Plan until"
            value={endDate}
            min={today}
            onChange={changeEnd}
            badge={!endEdited && suggestion ? <Badge tone="estimate">Estimate</Badge> : null}
            hint={
              suggestion?.income && !endEdited
                ? `Next payday from “${suggestion.income.displayName}” (${suggestion.income.cadence}). Your paycheck is not added — only money you already have counts.`
                : "Usually your next payday."
            }
            error={submitted ? errors.end : null}
            testId="end-date"
          />
          <MoneyField
            id="essentials"
            label="Everyday spending until then"
            value={essentials}
            onChange={(v) => {
              setEssentials(v);
              setEssentialsEdited(true);
              setEssentialsNeedsCheck(false);
            }}
            badge={!essentialsEdited && est ? <Badge tone="estimate">Estimate</Badge> : null}
            hint={
              est && !essentialsEdited
                ? `About ${formatUSD(est.dailyCents)}/day from your last ${est.windowDays} days of groceries, gas and similar, without bills and transfers${est.excludedLarge ? ` (${plural(est.excludedLarge, "large purchase")} left out)` : ""}.`
                : "Groceries, gas, eating out — money you will need that isn't a bill."
            }
            error={submitted ? errors.essentials : null}
            testId="essentials-input"
          />
          <div className="field">
            <span className="field-label" id="reserve-label">
              Reserve to keep untouched
            </span>
            <div className="chips" role="radiogroup" aria-labelledby="reserve-label">
              {RESERVE_OPTIONS_CENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={reserve === c}
                  className={`chip${reserve === c ? " chip-on" : ""}`}
                  onClick={() => setReserve(c)}
                  data-testid={`reserve-${c}`}
                >
                  {formatUSD(c)}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={reserve === "custom"}
                className={`chip${reserve === "custom" ? " chip-on" : ""}`}
                onClick={() => setReserve("custom")}
              >
                Other
              </button>
            </div>
            {reserve === "custom" && (
              <MoneyField id="reserve-custom" label="Reserve amount" value={customReserve} onChange={setCustomReserve} error={submitted ? errors.reserve : null} />
            )}
            <div className="field-hint">A cushion you'd rather not spend. Going below it is shown as a warning, not as missing bill money.</div>
          </div>
        </div>
        {essentialsNeedsCheck && (
          <Notice tone="warn" title="You changed the dates">
            Check that everyday spending still fits the new period ({endValid ? plural(daysInclusive(today, endDate), "day") : "—"}).
          </Notice>
        )}
      </Card>

      <Card
        title={`Bills (${unpaid.length})`}
        actions={
          suggested.length > 0 && candidates.size > 0 ? (
            <Button small variant="secondary" onClick={() => void runReview()} disabled={reviewState.status === "loading"} testId="review-with-ai">
              {reviewState.status === "loading" ? "Reviewing…" : "Review with assistant"}
            </Button>
          ) : null
        }
      >
        <p className="muted small">
          Confirm each bill you really have to pay. Only confirmed bills count in your plan.
          {suggestion && suggestion.candidates.length === 0 && " We didn't find repeating payments in your file — add bills by hand."}
        </p>
        {reviewState.status === "error" && (
          <Notice tone="warn" title="Assistant review unavailable" testId="review-error">
            {reviewState.message}
          </Notice>
        )}
        {review && reviewState.message && <p className="assistant-note">Assistant: {reviewState.message}</p>}
        <ul className="bill-list">
          {unpaid.map((o) => (
            <BillSetupRow
              key={o.id}
              bill={o}
              candidate={candidates.get(o.id)}
              review={review?.[o.id]}
              inPeriod={endValid && o.dueDate <= endDate}
            />
          ))}
        </ul>
        {unpaid.length === 0 && <p className="muted">No bills yet.</p>}
        {adding ? (
          <ManualBillForm onDone={() => setAdding(false)} />
        ) : (
          <Button variant="secondary" small onClick={() => setAdding(true)} testId="add-bill">
            + Add a bill
          </Button>
        )}
      </Card>

      <Card title="Result" className="result-card">
        {suggestedInPeriod.length > 0 && (
          <Notice tone="warn" title={`${plural(suggestedInPeriod.length, "suggested bill")} due before ${formatDate(endDate)} not confirmed`}>
            They won't be counted. Confirm or dismiss them above.
          </Notice>
        )}
        {preview ? (
          <div className="preview-line">
            <span>Free to spend until {formatDate(endDate)}</span>
            <strong className={`money big${preview.remainderCents < 0 ? " negative" : ""}`} data-testid="setup-preview">
              {formatUSD(preview.remainderCents)}
            </strong>
            <span className="muted small">{describeEvaluation(preview)}</span>
          </div>
        ) : (
          <p className="muted">Enter your balance to see the result.</p>
        )}
        <div className="row-actions">
          <Button onClick={build} testId="build-plan">
            {existing ? "Save plan" : "Build my plan"}
          </Button>
          {existing && (
            <Button variant="ghost" onClick={() => navigate("/app")}>
              Cancel
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function BillSetupRow(props: { bill: Obligation; candidate?: RecurringCandidate; review?: ReviewItem; inPeriod: boolean }) {
  const { state, commit, today } = useApp();
  const { bill, candidate, review } = props;
  const [editing, setEditing] = useState(false);
  const confirmed = bill.confirmationStatus === "confirmed";
  const evidence = state.transactions.filter((t) => bill.sourceTransactionIds.includes(t.id));
  const set = (patch: Partial<Obligation>) => commit(upsertObligation(state, { ...bill, ...patch }));

  return (
    <li className={`bill-row${confirmed ? " is-confirmed" : ""}`} data-testid={`bill-${bill.id}`}>
      <div className="bill-main">
        <div className="bill-name">
          {bill.name}
          {confirmed ? <Badge tone="ok">Confirmed</Badge> : <Badge tone="estimate">Suggested</Badge>}
          {!props.inPeriod && <Badge>After this period</Badge>}
          {bill.recurrence && <Badge>{bill.recurrence}</Badge>}
        </div>
        <div className="bill-meta">
          {formatDate(bill.dueDate, true)}
          {bill.dueDate < today ? " · overdue" : ""}
        </div>
      </div>
      <div className="bill-amount money">{formatUSD(bill.amountCents)}</div>
      {candidate && candidate.notes.length > 0 && !confirmed && (
        <ul className="bill-notes">
          {candidate.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {review && (
        <div className={`ai-review ${review.isLikelyBill ? "likely" : "unlikely"}`} data-testid="ai-review">
          <strong>Assistant:</strong> {review.isLikelyBill ? "Looks like a bill" : "Probably not a bill"} — {review.reason}
          {review.question && <div className="ai-question">{review.question}</div>}
          {review.displayName && review.displayName !== bill.name && (
            <Button small variant="link" onClick={() => set({ name: review.displayName.slice(0, 60) })}>
              Rename to “{review.displayName}”
            </Button>
          )}
        </div>
      )}
      {evidence.length > 0 && (
        <details className="evidence">
          <summary>Based on {plural(evidence.length, "payment")}</summary>
          <ul>
            {evidence
              .slice()
              .sort((a, b) => (a.postedDate < b.postedDate ? 1 : -1))
              .slice(0, 6)
              .map((t) => (
                <li key={t.id}>
                  {formatDate(t.postedDate)} · {t.description} · {formatUSD(t.amountCents)}
                </li>
              ))}
          </ul>
        </details>
      )}
      {editing ? (
        <BillEditor
          bill={bill}
          onCancel={() => setEditing(false)}
          onSave={(patch) => {
            set({ ...patch, confirmationStatus: "confirmed" });
            setEditing(false);
          }}
          saveLabel="Save and confirm"
        />
      ) : (
        <div className="row-actions">
          {!confirmed ? (
            <>
              <Button small onClick={() => set({ confirmationStatus: "confirmed" })} testId={`confirm-${bill.id}`}>
                Confirm
              </Button>
              <Button small variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button small variant="ghost" onClick={() => commit(removeObligation(state, bill.id))} testId={`dismiss-${bill.id}`}>
                Not a bill
              </Button>
            </>
          ) : (
            <>
              <Button small variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button small variant="ghost" onClick={() => set({ confirmationStatus: "suggested" })}>
                Undo confirm
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function BillEditor(props: {
  bill?: Obligation;
  onSave: (patch: { name: string; amountCents: number; dueDate: string; recurrence: Obligation["recurrence"] }) => void;
  onCancel: () => void;
  saveLabel?: string;
}) {
  const { today } = useApp();
  const [name, setName] = useState(props.bill?.name ?? "");
  const [amount, setAmount] = useState(props.bill ? centsToInput(props.bill.amountCents) : "");
  const [due, setDue] = useState(props.bill?.dueDate ?? today);
  const [monthly, setMonthly] = useState(props.bill ? props.bill.recurrence === "monthly" : true);
  const [submitted, setSubmitted] = useState(false);
  const amountCents = parseAmountInput(amount);
  const errors = {
    name: !name.trim() ? "Enter a name." : name.trim().length > 60 ? "Use 60 characters or fewer." : null,
    amount: amountCents === null || amountCents <= 0 ? "Enter an amount above $0." : null,
    due: !isISODate(due) ? "Choose a date." : null,
  };
  const idBase = props.bill?.id ?? "new";
  return (
    <form
      className="bill-editor"
      onSubmit={(e: { preventDefault: () => void }) => {
        e.preventDefault();
        setSubmitted(true);
        if (errors.name || errors.amount || errors.due || amountCents === null) return;
        props.onSave({
          name: name.trim(),
          amountCents,
          dueDate: due,
          recurrence: monthly ? "monthly" : props.bill?.recurrence === "monthly" ? null : props.bill?.recurrence ?? null,
        });
      }}
    >
      <div className="grid-3">
        <TextField id={`name-${idBase}`} label="Name" value={name} onChange={setName} error={submitted ? errors.name : null} testId="bill-name" />
        <MoneyField id={`amount-${idBase}`} label="Amount" value={amount} onChange={setAmount} error={submitted ? errors.amount : null} testId="bill-amount" />
        <TextField id={`due-${idBase}`} type="date" label="Due date" value={due} onChange={setDue} error={submitted ? errors.due : null} testId="bill-due" />
      </div>
      <label className="check">
        <input type="checkbox" checked={monthly} onChange={(e: { target: { checked: boolean } }) => setMonthly(e.target.checked)} />
        Repeats every month
      </label>
      <div className="row-actions">
        <Button type="submit" small testId="bill-save">
          {props.saveLabel ?? "Save"}
        </Button>
        <Button small variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ManualBillForm({ onDone }: { onDone: () => void }) {
  const { state, commit } = useApp();
  return (
    <BillEditor
      saveLabel="Add bill"
      onCancel={onDone}
      onSave={(p) => {
        commit(
          upsertObligation(state, {
            id: newId("bill"),
            name: p.name,
            amountCents: p.amountCents,
            dueDate: p.dueDate,
            paymentStatus: "unpaid",
            confirmationStatus: "confirmed",
            source: "manual",
            sourceTransactionIds: [],
            recurrence: p.recurrence,
            paidOn: null,
          }),
        );
        onDone();
      }}
    />
  );
}
