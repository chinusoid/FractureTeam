import { useMemo, useState } from "react";
import { addDays, centsToInput, daysInclusive, emptyState, formatDate, isISODate, setPlan } from "../../lib/finance";
import { clearState } from "../../lib/storage/local";
import { buildSetupSuggestion, essentialsForPeriod } from "../../lib/import/prefill";
import { useApp } from "../context";
import { downloadText, parseAmountInput, plural } from "../format";
import { AI_DATA_NOT_SENT, AI_DATA_SENT } from "../aiData";
import { Badge, Button, Card, Modal, MoneyField, Notice, TextField } from "../ui";
import { NoPlan } from "./Home";

export function Settings() {
  const { state, commit, today, navigate, flash } = useApp();
  const plan = state.plan;
  const [endDate, setEndDate] = useState(plan?.endDate ?? addDays(today, 13));
  const [essentials, setEssentials] = useState(plan ? centsToInput(plan.essentialRemainingCents) : "");
  const [essentialsTouched, setEssentialsTouched] = useState(false);
  const [checkedEssentials, setCheckedEssentials] = useState(false);
  const [reserve, setReserve] = useState(plan ? centsToInput(plan.reserveTargetCents) : "");
  const [newPeriod, setNewPeriod] = useState(plan ? today > plan.endDate : false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const suggestion = useMemo(
    () => (newPeriod && state.transactions.length ? buildSetupSuggestion(state.transactions, today) : null),
    [newPeriod, state.transactions, today],
  );

  if (!plan?.confirmed || !state.account) return <NoPlan />;

  const datesChanged = endDate !== plan.endDate || newPeriod;
  const mustRecheck = datesChanged && !essentialsTouched;
  const essentialsCents = parseAmountInput(essentials);
  const reserveCents = parseAmountInput(reserve);
  const endValid = isISODate(endDate) && endDate >= (newPeriod ? today : plan.startDate);
  const estimate = suggestion?.essentials && endValid ? essentialsForPeriod(suggestion.essentials, daysInclusive(today, endDate)) : null;

  const save = () => {
    setSubmitted(true);
    if (!endValid || essentialsCents === null || reserveCents === null) return;
    if (mustRecheck && !checkedEssentials) return;
    commit(
      setPlan(state, {
        ...plan,
        startDate: newPeriod ? today : plan.startDate,
        endDate,
        essentialRemainingCents: essentialsCents,
        reserveTargetCents: reserveCents,
        confirmed: true,
      }),
    );
    setNewPeriod(false);
    setEssentialsTouched(false);
    setCheckedEssentials(false);
    setSubmitted(false);
    flash("Plan settings saved");
  };

  const exportJson = () => downloadText(`covered-export-${today}.json`, JSON.stringify(state, null, 2), "application/json");

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <Card title="Period and budget">
        <label className="check">
          <input
            type="checkbox"
            checked={newPeriod}
            onChange={(e: { target: { checked: boolean } }) => {
              setNewPeriod(e.target.checked);
              if (e.target.checked && endDate <= today) setEndDate(addDays(today, 13));
            }}
            data-testid="new-period"
          />
          Start a new period from today{today > plan.endDate ? " (your current one has ended)" : ""}
        </label>
        <div className="grid-3">
          <TextField
            id="settings-end"
            type="date"
            label="Plan until"
            value={endDate}
            min={newPeriod ? today : plan.startDate}
            onChange={setEndDate}
            error={submitted && !endValid ? "Choose a date from the period start onward." : null}
            hint={suggestion?.income ? `Next payday from your file: ${formatDate(suggestion.income.nextPayday)}` : `Current period started ${formatDate(plan.startDate)}.`}
          />
          <MoneyField
            id="settings-essentials"
            label="Everyday spending left"
            value={essentials}
            onChange={(v) => {
              setEssentials(v);
              setEssentialsTouched(true);
            }}
            badge={mustRecheck ? <Badge tone="warn">Check for new dates</Badge> : null}
            hint={estimate !== null ? `Estimate for ${plural(daysInclusive(today, endDate), "day")} from your file: $${centsToInput(estimate)}` : undefined}
            error={submitted && essentialsCents === null ? "Enter an amount (0 if none)." : null}
          />
          <MoneyField
            id="settings-reserve"
            label="Reserve"
            value={reserve}
            onChange={setReserve}
            error={submitted && reserveCents === null ? "Enter an amount (0 if none)." : null}
          />
        </div>
        {mustRecheck && (
          <label className="check">
            <input type="checkbox" checked={checkedEssentials} onChange={(e: { target: { checked: boolean } }) => setCheckedEssentials(e.target.checked)} />
            I checked everyday spending for the new dates
          </label>
        )}
        {submitted && mustRecheck && !checkedEssentials && (
          <Notice tone="warn">The period changed, so confirm or adjust everyday spending before saving.</Notice>
        )}
        <div className="row-actions">
          <Button onClick={save} testId="settings-save">
            Save
          </Button>
          <Button variant="ghost" onClick={() => navigate("/setup/import")}>
            Import a new file
          </Button>
          <Button variant="ghost" onClick={() => navigate("/setup/plan")}>
            Re-run setup
          </Button>
        </div>
      </Card>

      <Card title="AI assistant">
        <p>
          Status: <strong>{state.consent.aiEnabled ? "On" : "Off"}</strong>
          {state.consent.acceptedAt && state.consent.aiEnabled ? ` since ${new Date(state.consent.acceptedAt).toLocaleDateString("en-US")}` : ""}
        </p>
        <p className="muted small">Sent with each request:</p>
        <ul className="tight small">
          {AI_DATA_SENT.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p className="muted small">Never sent: {AI_DATA_NOT_SENT.join(", ").toLowerCase()}.</p>
        <p className="muted small">The AI provider processes what is sent under its own terms. This app does not store your messages on its server.</p>
        <div className="row-actions">
          {state.consent.aiEnabled ? (
            <Button variant="secondary" onClick={() => commit({ ...state, consent: { ...state.consent, aiEnabled: false } })} testId="ai-off">
              Turn off
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => commit({ ...state, consent: { aiEnabled: true, acceptedAt: new Date().toISOString(), policyVersion: 1 } })}
            >
              Turn on
            </Button>
          )}
        </div>
      </Card>

      <Card title="Your data">
        <p className="muted small">
          Stored only in this browser: {plural(state.transactions.length, "transaction")}, {plural(state.obligations.length, "bill")}. To use another device, export here and keep the file safe.
        </p>
        <div className="row-actions">
          <Button variant="secondary" onClick={exportJson}>
            Export JSON
          </Button>
          <Button variant="danger" onClick={() => setConfirmClear(true)} testId="clear-data">
            Delete all local data
          </Button>
        </div>
      </Card>

      {confirmClear && (
        <Modal
          title="Delete everything?"
          onClose={() => setConfirmClear(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                testId="clear-confirm"
                onClick={() => {
                  clearState();
                  commit(emptyState());
                  setConfirmClear(false);
                  navigate("/");
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          <p>This removes your transactions, bills and plan from this browser. It can't be undone. Data already processed by the AI provider is covered by its own retention policy.</p>
        </Modal>
      )}
    </div>
  );
}
