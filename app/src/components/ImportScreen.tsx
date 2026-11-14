import { useMemo, useState } from "react";
import {
  buildSetupSuggestion,
  detectDateFormats,
  emptyState,
  fileHash,
  normalizeRows,
  parseCsv,
  today,
  type DateFormat,
  type Mapping,
} from "@/lib/client/model";
import { useApp } from "./context";
import { Button, Notice, PageHeading } from "./UI";
import { Icon } from "./Icon";

export function ImportScreen({
  initialText,
  variant,
}: {
  initialText: string;
  variant: "A" | "B" | null;
}) {
  const { state, change, navigate } = useApp();
  const [text, setText] = useState(initialText),
    [filename, setFilename] = useState(
      initialText ? `covered-sample-${variant}.csv` : "",
    );
  const [mapping, setMapping] = useState<Mapping>(() =>
    initialText
      ? parseCsv(initialText).mapping
      : { date: -1, description: -1, amount: -1 },
  );
  const [format, setFormat] = useState<DateFormat>(initialText ? "ISO" : ""),
    [invert, setInvert] = useState(false),
    [excludeDuplicates, setExcludeDuplicates] = useState(false),
    [excluded, setExcluded] = useState<number[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [isSample, setIsSample] = useState(!!initialText);
  const parsed = useMemo(() => {
    try {
      return text ? parseCsv(text) : null;
    } catch {
      return null;
    }
  }, [text]);
  const result = useMemo(
    () =>
      parsed
        ? normalizeRows(parsed.rows, mapping, format, invert)
        : { transactions: [], errors: [] },
    [parsed, mapping, format, invert],
  );
  const selected = result.transactions.filter(
    (t) => (!excludeDuplicates || !t.duplicate) && !excluded.includes(t.row),
  );
  async function readFile(file?: File) {
    if (!file) return;
    setError("");
    setExcluded([]);
    setIsSample(false);
    if (file.size > 2 * 1024 * 1024) {
      setError("This file is larger than 2 MB. Export a smaller date range.");
      return;
    }
    try {
      const next = await file.text(),
        p = parseCsv(next);
      setText(next);
      setFilename(file.name);
      setMapping(p.mapping);
      setFormat(
        p.mapping.date >= 0
          ? detectDateFormats(p.rows.map((r) => r[p.mapping.date]))
          : "",
      );
    } catch (e) {
      setText("");
      setError((e as Error).message);
    }
  }
  async function confirm() {
    if (!selected.length || !format) return;
    setBusy(true);
    setError("");
    try {
      const hash = await fileHash(text);
      if (state.importHashes.includes(hash)) {
        setError(
          "You already imported this exact file. Choose a different file or continue with your existing plan.",
        );
        return;
      }
      const suggestion = buildSetupSuggestion(selected),
        base = emptyState();
      change((s) => ({
        ...base,
        stateVersion: s.stateVersion + 1,
        aiConsent: s.aiConsent,
        importHashes: [...s.importHashes.slice(-98), hash],
        transactions: selected,
        bills: suggestion.bills,
        sample: isSample,
        plan: {
          ...base.plan,
          balanceCents: isSample ? (variant === "B" ? 310000 : 220000) : 0,
          balanceDate: today(),
          horizonEndDate: suggestion.horizon,
          essentialsCents: suggestion.essentialsCents,
        },
      }));
      navigate("/setup/plan");
    } catch {
      setError("This import could not be prepared. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title="A fresh start for your money."
        description="Bring your transactions. We’ll help you find the pattern."
      />
      <div className="steps">
        <span className="active">
          <b>1</b> Import transactions
        </span>
        <i />
        <span>
          <b>2</b> Make it yours
        </span>
        <i />
        <span>
          <b>3</b> See your plan
        </span>
      </div>
      <div className="import-layout">
        <section className="panel import-panel">
          <div className="section-heading">
            <h2>Your transactions</h2>
            <span className="pill">CSV only</span>
          </div>
          <label
            className={`dropzone ${filename ? "has-file" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void readFile(e.dataTransfer.files[0]);
            }}
          >
            <input
              aria-label="Upload transactions CSV"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void readFile(e.target.files?.[0])}
            />
            <span className="upload-icon">
              <Icon name={filename ? "bill" : "upload"} size={27} />
            </span>
            <strong>{filename || "Drop your CSV here"}</strong>
            <span>
              {filename
                ? "Choose a different file"
                : "or click to choose a file"}
            </span>
            <small>Up to 2 MB and 5,000 transactions</small>
          </label>
          {error && <Notice error>{error}</Notice>}
          {parsed && (
            <>
              <div className="section-heading mapping-heading">
                <h3>Match your columns</h3>
                <span className="muted small">
                  {parsed.rows.length} rows found
                </span>
              </div>
              <div className="form-grid three">
                {(["date", "description", "amount"] as const).map((key) => (
                  <label key={key}>
                    {key === "date"
                      ? "Date"
                      : key === "description"
                        ? "Description"
                        : "Amount"}
                    <select
                      value={mapping[key]}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setMapping((m) => ({ ...m, [key]: value }));
                        if (key === "date")
                          setFormat(
                            detectDateFormats(
                              parsed.rows.map((r) => r[value] ?? ""),
                            ),
                          );
                      }}
                    >
                      <option value={-1}>Choose a column</option>
                      {parsed.headers.map((h, i) => (
                        <option value={i} key={i}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="form-grid">
                <label>
                  Date format
                  <select
                    value={format}
                    onChange={(e) => setFormat(e.target.value as DateFormat)}
                  >
                    <option value="">Select a date format</option>
                    <option value="ISO">YYYY-MM-DD</option>
                    <option value="MDY">MM/DD/YYYY (US)</option>
                    <option value="DMY">DD/MM/YYYY</option>
                  </select>
                </label>
                <label>
                  Amount sign
                  <select
                    value={invert ? "invert" : "normal"}
                    onChange={(e) => setInvert(e.target.value === "invert")}
                  >
                    <option value="normal">Spending is negative</option>
                    <option value="invert">Spending is positive</option>
                  </select>
                </label>
              </div>
              {!format && (
                <Notice error>
                  These dates could have more than one meaning. Choose a date
                  format to continue.
                </Notice>
              )}
              {format && result.errors.length > 0 && (
                <Notice error>
                  <strong>{result.errors.length} rows need attention.</strong>{" "}
                  Valid rows can still be imported.
                  <ul>
                    {result.errors.slice(0, 6).map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </Notice>
              )}
              {result.transactions.some((t) => t.duplicate) && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={excludeDuplicates}
                    onChange={(e) => setExcludeDuplicates(e.target.checked)}
                  />
                  Exclude possible duplicates (kept by default)
                </label>
              )}
              {selected.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <caption>
                      Preview of the first{" "}
                      {Math.min(8, result.transactions.length)} valid rows.
                      Uncheck a row to leave it out.
                    </caption>
                    <thead>
                      <tr>
                        <th>Keep</th>
                        <th>Row</th>
                        <th>Date</th>
                        <th>Description</th>
                        <th className="number">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.transactions.slice(0, 8).map((t) => (
                        <tr key={t.row}>
                          <td>
                            <input
                              aria-label={`Keep row ${t.row}`}
                              type="checkbox"
                              checked={!excluded.includes(t.row)}
                              onChange={(e) =>
                                setExcluded((prev) =>
                                  e.target.checked
                                    ? prev.filter((n) => n !== t.row)
                                    : [...prev, t.row],
                                )
                              }
                            />
                          </td>
                          <td>{t.row}</td>
                          <td className="nowrap">{t.date}</td>
                          <td>
                            {t.description}
                            {t.duplicate && (
                              <small className="row-flag">
                                Possible duplicate
                              </small>
                            )}
                            {t.transfer && (
                              <small className="row-flag">
                                Possible transfer
                              </small>
                            )}
                          </td>
                          <td className="number nowrap">
                            {(t.amountCents / 100).toLocaleString("en-US", {
                              style: "currency",
                              currency: "USD",
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {state.plan.confirmed && (
                <Notice>
                  Importing this file starts a new plan and replaces the current
                  transactions and bills. Export your existing plan in Settings
                  if you want to keep it.
                </Notice>
              )}
              <div className="form-footer">
                <span className="small muted">
                  {selected.length} transactions ready
                </span>
                <Button
                  onClick={() => void confirm()}
                  disabled={!selected.length || !format || busy}
                >
                  {busy ? "Preparing…" : "Continue to setup"}
                  <Icon name="arrow" size={16} />
                </Button>
              </div>
            </>
          )}
        </section>
        <aside className="import-aside">
          <Icon name="shield" size={30} />
          <h2>Your data stays with you.</h2>
          <p>Your CSV is read in this browser and saved on this device.</p>
          <div className="thin-line" />
          <h3>What do I need?</h3>
          <p>
            A CSV with a date, description, and amount column. A month or two of
            history helps spot recurring bills.
          </p>
          <h3>Want a quick look first?</h3>
          <p>Use a synthetic sample. No bank connection or account needed.</p>
          <Button
            kind="secondary"
            onClick={() => {
              setText("");
              navigate("/");
            }}
          >
            Back to sample options
          </Button>
        </aside>
      </div>
    </>
  );
}
