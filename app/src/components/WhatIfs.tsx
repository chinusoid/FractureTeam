import { useState } from "react";
import { dateLabel, money, parseMoney, today, type Scenario } from "@/lib/client/model";
import { addScenario, evaluateScenario, removeScenario, scenarioTitle, TOUCHES_LABEL } from "@/lib/client/scenarios";
import { useApp } from "./context";
import { Button, Modal, Notice } from "./UI";
import { Icon } from "./Icon";
import { PlusOffer, PlusTag, usePlus } from "./Plus";

type Draft = Parameters<typeof addScenario>[1];

/**
 * Saving a what-if belongs to Covered Plus. With Plus off, the first save shows the offer;
 * accepting it turns Plus on (and counts one more interested browser), then saves.
 */
export function useSaveWhatIf() {
  const { change, toast, state } = useApp();
  const [plus, turnOnPlus] = usePlus();
  const [pending, setPending] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  function store(draft: Draft) {
    try {
      const before = state.scenarios.length;
      let after = before;
      change((s) => {
        const next = addScenario(s, draft);
        after = next.scenarios.length;
        return next;
      });
      toast(after > before ? "Saved to your what-ifs. It is recalculated whenever your plan changes." : "That what-if is already saved.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "This what-if could not be saved.");
    }
  }
  const save = (draft: Draft) => (plus ? store(draft) : setPending(draft));
  const dialog = pending && (
    <Modal title="Saved what-ifs are part of Covered Plus" close={() => setPending(null)}>
      <PlusOffer
        title="Keep your plan going with Covered Plus"
        lead="The first plan and a purchase check are free. Plus is for coming back: your what-ifs are kept and recalculated every time your balance changes."
        busy={busy}
        onAccept={() => {
          setBusy(true);
          void turnOnPlus().then(() => {
            store(pending);
            setBusy(false);
            setPending(null);
          });
        }}
      >
        <Button kind="ghost" onClick={() => setPending(null)}>
          Not now
        </Button>
      </PlusOffer>
    </Modal>
  );
  return { save, dialog };
}

/** Saved what-ifs side by side with the plan as it is, so they can be compared at a glance. */
export function WhatIfs() {
  const { state, change } = useApp();
  const { save, dialog } = useSaveWhatIf();
  const [name, setName] = useState(""),
    [amount, setAmount] = useState(""),
    [due, setDue] = useState(today()),
    [error, setError] = useState("");
  const rows = state.scenarios.map((s: Scenario) => ({ s, out: evaluateScenario(state, s) }));
  return (
    <section className="whatifs-panel" aria-labelledby="whatifs-title" data-testid="whatifs">
      <div className="section-heading">
        <div>
          <h2 id="whatifs-title">Your what-ifs</h2>
          <p className="small muted">
            Saved and recalculated every time your plan changes. They never change the plan.
          </p>
        </div>
        <PlusTag />
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table className="whatifs-table">
            <thead>
              <tr>
                <th scope="col">What if</th>
                <th scope="col" className="number">Left to spend</th>
                <th scope="col">It would touch</th>
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="whatifs-now">
                <th scope="row">Your plan today</th>
                <td className="number">{money(rows[0].out.remainderCents - rows[0].out.changeCents)}</td>
                <td>
                  <span className="muted">Nothing changes</span>
                </td>
                <td />
              </tr>
              {rows.map(({ s, out }) => (
                <tr key={s.id} data-testid="whatif-row">
                  <th scope="row">
                    {scenarioTitle(s)}
                    <small>{out.detail ?? out.summary}</small>
                  </th>
                  <td className="number">
                    <strong>{money(out.remainderCents)}</strong>
                    {out.changeCents !== 0 && <small>{money(out.changeCents)}</small>}
                  </td>
                  <td>
                    <span className={`pill touches-${out.touches}`}>{TOUCHES_LABEL[out.touches]}</span>
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Remove what-if: ${scenarioTitle(s)}`}
                      onClick={() => change((st) => removeScenario(st, s.id))}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="whatifs-empty">
          Nothing saved yet. Check a purchase or a late paycheck on this page and press{" "}
          <strong>Save as a what-if</strong>, or add a bill you expect below.
        </p>
      )}
      <details className="whatifs-add">
        <summary>What if a new bill appears?</summary>
        <form
          className="whatifs-form"
          onSubmit={(e) => {
            e.preventDefault();
            const cents = parseMoney(amount);
            if (!name.trim() || cents === null || cents <= 0) {
              setError("Give the bill a name and an amount greater than $0.");
              return;
            }
            setError("");
            save({ kind: "new_bill", label: name, amountCents: cents, dueDate: due });
            setName("");
            setAmount("");
          }}
        >
          <label>
            Bill
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vet visit" maxLength={60} />
          </label>
          <label>
            Amount
            <div className="money-input">
              <span>$</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" aria-label="What-if bill amount" />
            </div>
          </label>
          <label>
            Due
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <Button type="submit" kind="secondary">
            Save as a what-if
          </Button>
        </form>
        {error && <Notice error>{error}</Notice>}
        <p className="small muted">
          A bill due after {dateLabel(state.plan.horizonEndDate)} does not change this period.
        </p>
      </details>
      {dialog}
    </section>
  );
}
