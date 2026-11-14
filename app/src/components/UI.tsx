import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
import { BRAND } from "./brand";
export function Logo() {
  return (
    <span className="brand">
      <span className="brand-symbol">
        <Icon name="check" size={17} />
      </span>
      {BRAND.name}
      <span className="brand-dot">®</span>
    </span>
  );
}
export function Button({
  children,
  onClick,
  kind = "primary",
  icon,
  type = "button",
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "secondary" | "ghost" | "danger";
  icon?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      className={`button ${kind} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <Icon name={icon} size={16} />}
      <span>{children}</span>
    </button>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      <Icon name="info" size={17} />
      <div>{children}</div>
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
  drawer = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("button, input, select")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], textarea",
          ) ?? [],
        );
        if (!nodes.length) return;
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className={`modal-overlay ${drawer ? "drawer-overlay" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`modal ${drawer ? "drawer" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={ref}
      >
        <div className="section-heading">
          <h2 id="modal-title">{title}</h2>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close dialog"
          >
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
export function Gauge({
  percent,
  label = "of your balance allocated",
}: {
  percent: number;
  label?: string;
}) {
  const safe = Math.max(0, Math.min(100, percent));
  return (
    <div className="gauge">
      <svg
        viewBox="0 0 220 126"
        role="img"
        aria-label={`${Math.round(safe)}% ${label}`}
      >
        {Array.from({ length: 49 }, (_, i) => {
          const a = Math.PI + (i / 48) * Math.PI;
          return (
            <line
              key={i}
              x1={110 + Math.cos(a) * 86}
              y1={110 + Math.sin(a) * 86}
              x2={110 + Math.cos(a) * 103}
              y2={110 + Math.sin(a) * 103}
              stroke={(i / 48) * 100 <= safe ? "#1f1f1f" : "#dcded2"}
              strokeWidth="1.4"
            />
          );
        })}
        <text x="110" y="89" textAnchor="middle" className="gauge-value">
          {Math.round(safe)}%
        </text>
        <text x="110" y="111" textAnchor="middle" className="gauge-label">
          {label}
        </text>
      </svg>
    </div>
  );
}
export function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
