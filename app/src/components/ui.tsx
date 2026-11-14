import { useEffect, useRef, type ReactNode } from "react";
import { formatUSD } from "../lib/finance";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  type?: "button" | "submit";
  disabled?: boolean;
  small?: boolean;
  block?: boolean;
  testId?: string;
  ariaLabel?: string;
}) {
  const { variant = "primary", type = "button", small, block } = props;
  return (
    <button
      type={type}
      className={`btn btn-${variant}${small ? " btn-small" : ""}${block ? " btn-block" : ""}`}
      onClick={props.onClick}
      disabled={props.disabled}
      data-testid={props.testId}
      aria-label={props.ariaLabel}
    >
      {props.children}
    </button>
  );
}

export function Card(props: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode; testId?: string }) {
  return (
    <section className={`card ${props.className ?? ""}`} data-testid={props.testId}>
      {(props.title || props.actions) && (
        <div className="card-head">
          {props.title && <h2 className="card-title">{props.title}</h2>}
          {props.actions && <div className="card-actions">{props.actions}</div>}
        </div>
      )}
      {props.children}
    </section>
  );
}

export function Notice(props: {
  tone?: "info" | "warn" | "danger" | "success";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  const tone = props.tone ?? "info";
  return (
    <div className={`notice notice-${tone}`} role={tone === "danger" ? "alert" : "status"} data-testid={props.testId}>
      <div className="notice-body">
        {props.title && <strong className="notice-title">{props.title}</strong>}
        {props.children && <div className="notice-text">{props.children}</div>}
      </div>
      {props.action && <div className="notice-action">{props.action}</div>}
    </div>
  );
}

export function Badge(props: { tone?: "neutral" | "ok" | "warn" | "danger" | "info" | "estimate"; children: ReactNode }) {
  return <span className={`badge badge-${props.tone ?? "neutral"}`}>{props.children}</span>;
}

export function Money(props: { cents: number; className?: string; testId?: string }) {
  return (
    <span className={`money ${props.cents < 0 ? "negative " : ""}${props.className ?? ""}`} data-testid={props.testId}>
      {formatUSD(props.cents)}
    </span>
  );
}

export function MoneyField(props: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  error?: string | null;
  badge?: ReactNode;
  placeholder?: string;
  testId?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={props.id} className="field-label">
        {props.label} {props.badge}
      </label>
      <div className={`money-input${props.error ? " has-error" : ""}`}>
        <span aria-hidden="true">$</span>
        <input
          id={props.id}
          inputMode="decimal"
          autoComplete="off"
          value={props.value}
          placeholder={props.placeholder ?? "0"}
          onChange={(e: { target: { value: string } }) => props.onChange(e.target.value)}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={props.hint || props.error ? `${props.id}-hint` : undefined}
          data-testid={props.testId}
          autoFocus={props.autoFocus}
        />
      </div>
      {(props.error || props.hint) && (
        <div id={`${props.id}-hint`} className={props.error ? "field-error" : "field-hint"}>
          {props.error ?? props.hint}
        </div>
      )}
    </div>
  );
}

export function TextField(props: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "date";
  hint?: ReactNode;
  error?: string | null;
  badge?: ReactNode;
  testId?: string;
  min?: string;
  max?: string;
  placeholder?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={props.id} className="field-label">
        {props.label} {props.badge}
      </label>
      <input
        id={props.id}
        className={`input${props.error ? " has-error" : ""}`}
        type={props.type ?? "text"}
        value={props.value}
        min={props.min}
        max={props.max}
        placeholder={props.placeholder}
        onChange={(e: { target: { value: string } }) => props.onChange(e.target.value)}
        aria-invalid={props.error ? true : undefined}
        data-testid={props.testId}
      />
      {(props.error || props.hint) && <div className={props.error ? "field-error" : "field-hint"}>{props.error ?? props.hint}</div>}
    </div>
  );
}

export function Modal(props: { title: string; children: ReactNode; onClose: () => void; actions?: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    const first = ref.current?.querySelector<HTMLElement>("button, input, select, textarea");
    first?.focus();
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        ref={ref}
        data-testid={props.testId}
        onClick={(e: { stopPropagation: () => void }) => e.stopPropagation()}
      >
        <h2 className="modal-title">{props.title}</h2>
        <div className="modal-body">{props.children}</div>
        {props.actions && <div className="modal-actions">{props.actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState(props: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{props.title}</h2>
      {props.children && <div className="empty-text">{props.children}</div>}
      {props.actions && <div className="row-actions center">{props.actions}</div>}
    </div>
  );
}
