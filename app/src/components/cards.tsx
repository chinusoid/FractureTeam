import type { ReactNode } from "react";
import {
  type ChangeProposal,
  type ISODate,
  type PlanResult,
  type SimulationResult,
  type UpdateSummary,
  formatDate,
  formatDelta,
  formatUSD,
  planInputFromState,
  previewProposal,
} from "../lib/finance";
import { useApp, type ProposalUiStatus } from "./context";
import { describeEvaluation, plural, statusTone } from "./format";
import { Badge, Button, Money, Notice } from "./ui";

export function FormulaBreakdown({ plan }: { plan: PlanResult }) {
  return (
    <details className="formula" data-testid="formula">
      <summary>How is this calculated?</summary>
      <table className="formula-table">
        <tbody>
          <tr>
            <td>Available balance (as of {formatDate(plan.balanceAsOf)})</td>
            <td className="num">{formatUSD(plan.availableCents)}</td>
          </tr>
          <tr>
            <td>− Unpaid bills due by {formatDate(plan.periodEnd)} ({plural(plan.billsInPeriod.length, "bill")})</td>
            <td className="num">{formatUSD(plan.billsCents)}</td>
          </tr>
          <tr>
            <td>− Everyday spending left for the period</td>
            <td className="num">{formatUSD(plan.essentialsCents)}</td>
          </tr>
          <tr>
            <td>− Reserve you chose to keep</td>
            <td className="num">{formatUSD(plan.reserveTargetCents)}</td>
          </tr>
          <tr className="total">
            <td>= Free to spend</td>
            <td className="num">{formatUSD(plan.remainderCents)}</td>
          </tr>
        </tbody>
      </table>
      <ul className="tight muted">
        <li>Only bills you confirmed are counted. {plan.unconfirmedCount > 0 ? `${plural(plan.unconfirmedCount, "suggested bill")} not counted yet.` : ""}</li>
        <li>Expected paychecks and refunds are not added until they arrive.</li>
        <li>Past transactions from your file are used to find patterns only; they are not subtracted again.</li>
        {plan.billsOutsidePeriod.length > 0 && <li>Bills after {formatDate(plan.periodEnd)} are listed separately and not counted.</li>}
      </ul>
    </details>
  );
}

function Layer({ ok, label, detail }: { ok: boolean; label: string; detail?: ReactNode }) {
  return (
    <li className={`layer ${ok ? "layer-ok" : "layer-bad"}`}>
      <span aria-hidden="true">{ok ? "✓" : "!"}</span> {label}
      {detail && <span className="muted"> — {detail}</span>}
    </li>
  );
}

export function SimulationView({ result, testId }: { result: SimulationResult; testId?: string }) {
  if (result.kind === "invalid") {
    return <Notice tone="warn" title="Can't check that purchase">{result.reason}</Notice>;
  }
  if (result.kind === "outside_period") {
    return (
      <Notice tone="warn" title="That date is outside your plan" testId={testId}>
        Your plan covers {formatDate(result.periodStart)} – {formatDate(result.periodEnd)}. To check a purchase on{" "}
        {formatDate(result.purchaseDate)}, start a new period in Settings first. Nothing was changed.
      </Notice>
    );
  }
  const { before, after } = result;
  const tone = statusTone(after.status);
  return (
    <div className={`sim sim-${tone}`} data-testid={testId}>
      <div className="sim-head">
        What if you spend <strong>{formatUSD(result.amountCents)}</strong> on {formatDate(result.purchaseDate)}?
      </div>
      <div className="compare">
        <div className="compare-col">
          <div className="compare-label">Your plan now</div>
          <Money cents={before.remainderCents} className="compare-num" />
          <div className="compare-note">free to spend</div>
        </div>
        <div className="compare-arrow" aria-hidden="true">→</div>
        <div className="compare-col">
          <div className="compare-label">If you buy it</div>
          <Money cents={after.remainderCents} className="compare-num" testId="sim-after" />
          <div className="compare-note">free to spend</div>
        </div>
      </div>
      <p className="sim-verdict" data-testid="sim-verdict">
        {describeEvaluation(after)}
      </p>
      <ul className="layers">
        <Layer ok={after.billsCovered} label="Bills" detail={after.billsCovered ? "covered" : `${formatUSD(after.shortfallCents)} short`} />
        <Layer
          ok={after.essentialsCovered}
          label="Everyday spending"
          detail={after.essentialsCovered ? "covered" : after.billsCovered ? `${formatUSD(after.shortfallCents)} short` : "not covered"}
        />
        <Layer
          ok={after.remainderCents >= 0}
          label="Reserve"
          detail={`${formatUSD(after.reserveLeftCents)} of ${formatUSD(after.reserveTargetCents)} left`}
        />
      </ul>
      <p className="muted small">This is a what-if. Nothing was saved and your balance did not change.</p>
    </div>
  );
}

export function ProposalCard(props: {
  proposal: ChangeProposal;
  status: ProposalUiStatus;
  note?: string;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const { state, today } = useApp();
  const input = planInputFromState(state, today);
  if (!input) return <Notice tone="warn">Build your plan first to apply changes.</Notice>;
  const preview = previewProposal(input, props.proposal.payload);
  const stale = props.status === "pending" && props.proposal.baseVersion !== state.stateVersion;
  if ("errors" in preview) {
    return (
      <Notice tone="warn" title="This suggestion can't be applied" testId="proposal-card">
        {props.status === "applied" ? "It was already applied." : preview.errors.join(" ")}
      </Notice>
    );
  }
  const { target, updated, before, after } = preview;
  const title = target ? `Change “${target.name}”` : `Add “${updated.name}”`;
  return (
    <div className="proposal" data-testid="proposal-card">
      <div className="proposal-head">
        <strong>{title}</strong>
        {props.status === "applied" && <Badge tone="ok">Saved</Badge>}
        {props.status === "discarded" && <Badge>Discarded</Badge>}
        {props.status === "already_applied" && <Badge tone="ok">Already saved</Badge>}
        {(props.status === "stale" || stale) && <Badge tone="warn">Out of date</Badge>}
      </div>
      <table className="diff">
        <tbody>
          {target && target.name !== updated.name && (
            <tr>
              <td>Name</td>
              <td>{target.name}</td>
              <td>→ {updated.name}</td>
            </tr>
          )}
          <tr>
            <td>Amount</td>
            <td>{target ? formatUSD(target.amountCents) : "—"}</td>
            <td>
              → <strong>{formatUSD(updated.amountCents)}</strong>
              {target && target.amountCents !== updated.amountCents && (
                <span className="muted"> ({formatDelta(updated.amountCents - target.amountCents)})</span>
              )}
            </td>
          </tr>
          <tr>
            <td>Due</td>
            <td>{target ? formatDate(target.dueDate) : "—"}</td>
            <td>→ {formatDate(updated.dueDate)}</td>
          </tr>
          {props.status === "pending" && !stale && (
            <tr className="total">
              <td>Free to spend</td>
              <td>{formatUSD(before.remainderCents)}</td>
              <td>
                → <strong data-testid="proposal-after">{formatUSD(after.remainderCents)}</strong>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {props.status === "pending" && !stale && <p className="muted small">{describeEvaluation(after)}</p>}
      {props.note && <p className="muted small">{props.note}</p>}
      {stale && props.status === "pending" && (
        <p className="muted small">Your plan changed after this suggestion was made. Ask again to get an up-to-date one.</p>
      )}
      {props.status === "pending" && (
        <div className="row-actions">
          <Button onClick={props.onConfirm} disabled={stale} testId="proposal-confirm">
            Confirm change
          </Button>
          <Button variant="secondary" onClick={props.onDiscard}>
            Discard
          </Button>
        </div>
      )}
    </div>
  );
}

export function SinceLastUpdateCard({ summary, onDismiss }: { summary: UpdateSummary; onDismiss?: () => void }) {
  const essentialsUsed = summary.essentialsBeforeCents - summary.essentialsAfterCents;
  return (
    <section className="card since" data-testid="since-card">
      <div className="card-head">
        <h2 className="card-title">Since last update</h2>
        {onDismiss && (
          <Button small variant="ghost" onClick={onDismiss}>
            Hide
          </Button>
        )}
      </div>
      <p className="muted small">
        {formatDate(summary.fromDate)} → {formatDate(summary.toDate)}
      </p>
      <ul className="since-list">
        <li>
          Balance {formatUSD(summary.balanceBeforeCents)} → <strong>{formatUSD(summary.balanceAfterCents)}</strong>
        </li>
        {summary.closedBills.map((b) => (
          <li key={b.id}>
            <span aria-hidden="true">✓</span> {b.name} paid ({formatUSD(b.amountCents)})
          </li>
        ))}
        {essentialsUsed > 0 && (
          <li>
            Everyday spending: {formatUSD(essentialsUsed)} used, {formatUSD(summary.essentialsAfterCents)} left
          </li>
        )}
        {summary.unassignedDecreaseCents > 0 && (
          <li>{formatUSD(summary.unassignedDecreaseCents)} of spending was not matched to a bill or your everyday budget.</li>
        )}
        {summary.unexplainedIncreaseCents > 0 && <li>{formatUSD(summary.unexplainedIncreaseCents)} more than expected arrived.</li>}
        <li>
          Free to spend {formatUSD(summary.remainderBeforeCents)} → <strong>{formatUSD(summary.remainderAfterCents)}</strong>
          {summary.remainderBeforeCents === summary.remainderAfterCents ? " (spending went as planned)" : ` (${formatDelta(summary.remainderAfterCents - summary.remainderBeforeCents)})`}
        </li>
      </ul>
    </section>
  );
}

export function dueLabel(date: ISODate, today: ISODate): string {
  if (date < today) return `was due ${formatDate(date)}`;
  if (date === today) return "due today";
  return `due ${formatDate(date)}`;
}
