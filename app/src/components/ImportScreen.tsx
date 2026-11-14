import { useMemo, useState } from "react";
import {
  buildSetupSuggestion,
  detectDateFormats,
  emptyState,
  fileHash,
  normalizeRows,
  parseCsv,
  today,
  usesDebitCredit,
  type DateFormat,
  type Mapping,
} from "@/lib/client/model";
import { useApp } from "./context";
import { Button, downloadText, Notice, PageHeading } from "./UI";
import { Icon } from "./Icon";

/** A starting point for people who keep their own spreadsheet: fill it in, save as CSV, upload. */
const CSV_TEMPLATE = [
  "Date,Description,Amount",
  "11/01/2026,RENT PAYMENT,-1100.00",
  "11/05/2026,PAYCHECK,2100.00",
  "11/06/2026,GROCERY STORE,-65.40",
  "",
].join("\n");

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
      : { date: -1, description: -1, amount: -1, debit: -1, credit: -1 },
  );
  const [format, setFormat] = useState<DateFormat>(() => {
    if (!initialText) return "";
    const p = parseCsv(initialText);
    return p.mapping.date >= 0
      ? detectDateFormats(p.rows.map((r) => r[p.mapping.date] ?? ""))
      : "";
  }),
    [invert, setInvert] = useState(false),
    [excludeDuplicates, setExcludeDuplicates] = useState(false),
    [excluded, setExcluded] = useState<number[]>([]),
    [error, setError] = useState(""),
    [duplicateOfPlan, setDuplicateOfPlan] = useState(false),
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
    setDuplicateOfPlan(false);
    setExcluded([]);
    setIsSample(false);
    if (/\.(xlsx?|xlsm|numbers|ods)$/i.test(file.name)) {
      setText("");
      setFilename("");
      setError(
        "This is a spreadsheet workbook, not a CSV. Open it and choose File → Save As (or Download) → CSV (.csv), then upload that file.",
      );
      return;
    }
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
    setDuplicateOfPlan(false);
    try {
      const hash = await fileHash(text);
      // The same file again only blocks when a plan was built from it; the way on is that plan.
      // An import that was started and left (no plan yet) can simply be done again.
      if (state.importHashes.includes(hash) && state.plan.confirmed) {
        setError(
          "You already imported this exact file. Choose a different file or continue with your existing plan.",
        );
        setDuplicateOfPlan(true);
        return;
      }
      const suggestion = buildSetupSuggestion(selected),
        base = emptyState();
      change((s) => ({
        ...base,
        stateVersion: s.stateVersion + 1,
        aiConsent: s.aiConsent,
        importHashes: [...s.importHashes.filter((h) => h !== hash).slice(-98), hash],
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
  const continueFooter = (
    <div className={`form-footer ${isSample ? "sample-ready" : ""}`}>
      <span className="small muted">
        {isSample
          ? `Sample ready: ${selected.length} synthetic transactions, columns matched. Details below.`
          : `${selected.length} transactions ready`}
      </span>
      <Button onClick={() => void confirm()} disabled={!selected.length || !format || busy || duplicateOfPlan}>
        {busy ? "Preparing…" : "Continue to setup"}
        <Icon name="arrow" size={16} />
      </Button>
    </div>
  );
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
          {!parsed && (
            <div className="format-help">
              <h3>What the file should look like</h3>
              <ul>
                <li>
                  <strong>A CSV file (.csv).</strong> In your bank’s website,
                  look for Export or Download transactions and pick CSV.
                </li>
                <li>
                  <strong>Have an Excel or Google Sheets file?</strong> Choose
                  File → Save As (or Download) → CSV (.csv) first.
                </li>
                <li>
                  <strong>Three columns are enough:</strong> a date, a
                  description and an amount. Separate debit and credit columns
                  work too.
                </li>
                <li>
                  <strong>Two or three months</strong> of history let us spot
                  bills that repeat.
                </li>
              </ul>
              <div className="format-example" role="img" aria-label="Example: a header row Date, Description, Amount followed by one row per transaction">
                <code>Date,Description,Amount</code>
                <code>11/01/2026,OAKWOOD APARTMENTS,-1100.00</code>
                <code>11/05/2026,ACME PAYROLL,2100.00</code>
              </div>
              <div className="inline-actions">
                <Button
                  kind="secondary"
                  icon="download"
                  onClick={() => downloadText("covered-template.csv", CSV_TEMPLATE, "text/csv")}
                >
                  Download a template
                </Button>
                <button className="text-button" onClick={() => navigate("/setup/plan")}>
                  No file? Enter your numbers by hand
                  <Icon name="arrow" size={13} />
                </button>
              </div>
            </div>
          )}
          {error && <Notice error>{error}</Notice>}
          {error && duplicateOfPlan && (
            <div className="form-footer duplicate-import">
              <Button icon="arrow" onClick={() => navigate("/app")}>
                Open my plan
              </Button>
            </div>
          )}
          {parsed && (
            <>
              {/* The sample's columns are already matched: the way forward comes first, the details stay below. */}
              {isSample && continueFooter}
              <div className="section-heading mapping-heading">
                <h3>Match your columns</h3>
                <span className="muted small">
                  {parsed.rows.length} rows found
                </span>
              </div>
              <div className="segmented" role="group" aria-label="Amount columns">
                <button
                  type="button"
                  className={!usesDebitCredit(mapping) ? "active" : ""}
                  aria-pressed={!usesDebitCredit(mapping)}
                  onClick={() =>
                    setMapping((m) => ({
                      ...m,
                      amount:
                        m.amount >= 0
                          ? m.amount
                          : parsed.headers.findIndex((h) => /amount/i.test(h)),
                      debit: -1,
                      credit: -1,
                    }))
                  }
                >
                  One amount column
                </button>
                <button
                  type="button"
                  className={usesDebitCredit(mapping) ? "active" : ""}
                  aria-pressed={usesDebitCredit(mapping)}
                  onClick={() =>
                    setMapping((m) => ({
                      ...m,
                      amount: -1,
                      debit:
                        m.debit >= 0
                          ? m.debit
                          : Math.max(0, parsed.headers.findIndex((h) => /debit|withdraw|money out/i.test(h))),
                      credit:
                        m.credit >= 0
                          ? m.credit
                          : Math.max(0, parsed.headers.findIndex((h) => /credit|deposit|money in/i.test(h))),
                    }))
                  }
                >
                  Separate debit and credit
                </button>
              </div>
              <div className="form-grid three">
                {(usesDebitCredit(mapping)
                  ? (["date", "description", "debit", "credit"] as const)
                  : (["date", "description", "amount"] as const)
                ).map((key) => (
                  <label key={key}>
                    {key === "date"
                      ? "Date"
                      : key === "description"
                        ? "Description"
                        : key === "debit"
                          ? "Debit (money out)"
                          : key === "credit"
                            ? "Credit (money in)"
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
                {!usesDebitCredit(mapping) && (
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
                )}
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
              {!isSample && continueFooter}
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
            A CSV export from your bank with a date, a description, and either
            one amount column or separate debit and credit columns. Two or
            three months of history helps spot recurring bills.
          </p>
          <h3>No file handy?</h3>
          <p>Let the assistant ask you five questions, or type the numbers in yourself. Either takes a couple of minutes.</p>
          <div className="inline-actions">
            <Button kind="secondary" icon="spark" onClick={() => navigate("/setup/interview")}>
              Answer five questions
            </Button>
            <Button kind="ghost" onClick={() => navigate("/setup/plan")}>
              Enter by hand
            </Button>
          </div>
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
