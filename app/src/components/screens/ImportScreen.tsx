import { useEffect, useMemo, useState } from "react";
import { type Obligation, type Transaction, bumpVersion, formatDate, formatUSD, newId } from "../../lib/finance";
import { CsvError, MAX_FILE_BYTES, MAX_ROWS, fileHash, parseCsv, type ParsedCsv } from "../../lib/import/csv";
import {
  type ColumnMapping,
  type DateFormat,
  type SignConvention,
  detectDateFormats,
  guessMapping,
  mappingProblems,
  normalizeRows,
  parseDate,
} from "../../lib/import/normalize";
import { buildSetupSuggestion } from "../../lib/import/prefill";
import { generateSampleCsvA } from "../../lib/demo/sample";
import { useApp } from "../context";
import { plural } from "../format";
import { Badge, Button, Card, Notice } from "../ui";

interface LoadedFile {
  name: string;
  text: string;
  isSample: boolean;
}

const DATE_LABEL: Record<DateFormat, string> = {
  MDY: "Month/Day/Year (US, e.g. 11/14/2026)",
  DMY: "Day/Month/Year (e.g. 14/11/2026)",
  YMD: "Year-Month-Day (e.g. 2026-11-14)",
};

export function ImportScreen() {
  const { pending, setPending, state, commit, today, navigate } = useApp();
  const [file, setFile] = useState<LoadedFile | null>(pending ? { name: pending.fileName, text: pending.text, isSample: pending.isSample } : null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [useDebitCredit, setUseDebitCredit] = useState(false);
  const [sign, setSign] = useState<SignConvention>("negative_is_out");
  const [dateChoice, setDateChoice] = useState<DateFormat | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);

  const parsed = useMemo((): { ok: true; csv: ParsedCsv } | { ok: false; message: string } | null => {
    if (!file) return null;
    try {
      return { ok: true, csv: parseCsv(file.text) };
    } catch (e) {
      return { ok: false, message: e instanceof CsvError ? e.message : "This doesn't look like a CSV file." };
    }
  }, [file]);

  useEffect(() => {
    if (parsed?.ok) {
      const m = guessMapping(parsed.csv.headers);
      setMapping(m);
      setUseDebitCredit(m.amount === null && m.debit !== null);
      setDateChoice(null);
      setExcluded([]);
      setSign("negative_is_out");
    } else {
      setMapping(null);
    }
  }, [parsed]);

  const csv = parsed?.ok ? parsed.csv : null;
  const effectiveMapping: ColumnMapping | null = mapping
    ? useDebitCredit
      ? { ...mapping, amount: null }
      : { ...mapping, debit: null, credit: null }
    : null;
  const problems = effectiveMapping ? mappingProblems(effectiveMapping) : [];
  const dateInfo = useMemo(
    () => (csv && effectiveMapping?.date !== null && effectiveMapping ? detectDateFormats(csv.rows.map((r) => r[effectiveMapping.date as number] ?? "")) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [csv, effectiveMapping?.date],
  );
  // When a few rows have broken dates, still pick the format that fits most rows (the broken rows are listed as errors).
  const bestFit = useMemo(() => {
    if (!csv || !effectiveMapping || effectiveMapping.date === null || !dateInfo || dateInfo.fits.length > 0) return null;
    const col = effectiveMapping.date;
    const values = csv.rows.map((r) => r[col] ?? "").filter((v) => v.trim());
    if (!values.length) return null;
    const isIso = (v: string) => /^\d{4}-\d{1,2}-\d{1,2}/.test(v.trim());
    const counts = (["MDY", "DMY", "YMD"] as DateFormat[]).map((f) => ({
      f,
      n: values.filter((v) => (f === "YMD" ? isIso(v) : !isIso(v)) && parseDate(v, f) !== null).length,
    }));
    counts.sort((a, b) => b.n - a.n);
    if (counts[0].n / values.length < 0.6 || counts[0].n === counts[1].n) return null;
    return counts[0].f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csv, effectiveMapping?.date, dateInfo]);
  const autoFormat = dateInfo && !dateInfo.ambiguous && dateInfo.fits.length > 0 ? dateInfo.fits[0] : bestFit;
  const dateFormat = dateChoice ?? autoFormat;
  const needsDateChoice = !!dateInfo && (dateInfo.ambiguous || (dateInfo.fits.length === 0 && !bestFit));

  const normalized = useMemo(() => {
    if (!csv || !effectiveMapping || problems.length || !dateFormat) return null;
    return normalizeRows(csv.rows, { mapping: effectiveMapping, dateFormat, sign });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csv, JSON.stringify(effectiveMapping), problems.length, dateFormat, sign]);

  const allPositive =
    !!normalized && !useDebitCredit && normalized.transactions.length > 3 && normalized.transactions.every((t) => (sign === "negative_is_out" ? t.amountCents > 0 : t.amountCents < 0));

  const hash = file ? fileHash(file.text) : "";
  const previousImport = state.importBatches.find((b) => b.fileHash === hash);

  const onFile = async (f: File | undefined) => {
    setFileError(null);
    setPending(null);
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      setFile(null);
      setFileError(`This file is ${(f.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB — export a shorter date range (2–3 months is enough).`);
      return;
    }
    try {
      const text = await f.text();
      setFile({ name: f.name, text, isSample: false });
    } catch {
      setFileError("The file could not be opened. Try exporting it again.");
    }
  };

  const confirm = () => {
    if (!normalized || normalized.transactions.length === 0 || !file || !effectiveMapping || !csv) return;
    const batchId = newId("batch");
    const transactions: Transaction[] = normalized.transactions.map((t) => ({
      id: `${batchId}_${t.row}`,
      importBatchId: batchId,
      postedDate: t.postedDate,
      description: t.description,
      amountCents: t.amountCents,
      reviewStatus: excluded.includes(t.id) ? "excluded" : "ok",
      possibleTransfer: t.possibleTransfer,
    }));
    const suggestion = buildSetupSuggestion(transactions, today);
    const kept = state.obligations.filter((o) => !(o.source === "import" && o.confirmationStatus === "suggested"));
    const suggested: Obligation[] = suggestion.candidates
      .filter(
        (c) =>
          !kept.some((o) => o.id === c.id || (o.paymentStatus === "unpaid" && o.name.toLowerCase() === c.displayName.toLowerCase())),
      )
      .map((c) => ({
        id: c.id,
        name: c.displayName,
        amountCents: c.amountCents,
        dueDate: c.nextDueDate,
        paymentStatus: "unpaid",
        confirmationStatus: "suggested",
        source: "import",
        sourceTransactionIds: c.sourceTransactionIds,
        recurrence: c.cadence,
        paidOn: null,
      }));
    const headerName = (i: number | null) => (i === null ? null : csv.headers[i] ?? null);
    commit(
      bumpVersion({
        ...state,
        isSample: file.isSample,
        transactions,
        importBatches: [
          ...state.importBatches,
          {
            id: batchId,
            fileName: file.name.slice(0, 120),
            fileHash: hash,
            importedAt: new Date().toISOString(),
            rowCount: transactions.length,
            columnMapping: {
              date: headerName(effectiveMapping.date),
              description: headerName(effectiveMapping.description),
              amount: headerName(effectiveMapping.amount),
              debit: headerName(effectiveMapping.debit),
              credit: headerName(effectiveMapping.credit),
            },
          },
        ].slice(-10),
        obligations: [...kept, ...suggested],
      }),
    );
    setPending(null);
    navigate("/setup/plan");
  };

  const columnSelect = (key: keyof ColumnMapping, label: string) =>
    csv && mapping ? (
      <div className="field">
        <label className="field-label" htmlFor={`col-${key}`}>
          {label}
        </label>
        <select
          id={`col-${key}`}
          className="input"
          value={mapping[key] === null ? "" : String(mapping[key])}
          onChange={(e: { target: { value: string } }) => setMapping({ ...mapping, [key]: e.target.value === "" ? null : Number(e.target.value) })}
        >
          <option value="">— not in file —</option>
          {csv.headers.map((h, i) => (
            <option key={i} value={i}>
              {h || `Column ${i + 1}`}
            </option>
          ))}
        </select>
      </div>
    ) : null;

  const duplicates = normalized?.transactions.filter((t) => t.reviewStatus === "possible_duplicate") ?? [];
  const kept = normalized ? normalized.transactions.length - excluded.length : 0;

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Import transactions</h1>
        <p className="muted">Your file is read in this browser. It is not uploaded anywhere.</p>
      </div>

      {(!file || (parsed && !parsed.ok)) && (
        <Card title="Choose a CSV file">
          <p>Export 2–3 months of transactions from your bank as CSV. It needs a date, a description and an amount (or separate debit and credit columns). Up to 2 MB and {MAX_ROWS.toLocaleString("en-US")} rows.</p>
          <label className="file-drop">
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e: { target: { files: FileList | null } }) => void onFile(e.target.files?.[0])}
              data-testid="file-input"
            />
            <span>Choose file…</span>
          </label>
          {fileError && (
            <Notice tone="danger" title="File not imported">
              {fileError}
            </Notice>
          )}
          {parsed && !parsed.ok && (
            <Notice tone="danger" title="We couldn't read this file" testId="bad-csv">
              {parsed.message} Check that you exported CSV (not PDF or Excel), or try the sample data.
            </Notice>
          )}
          <div className="row-actions">
            <Button
              variant="ghost"
              onClick={() => setFile({ name: "sample-bank-a.csv", text: generateSampleCsvA(today), isSample: true })}
            >
              Use sample data instead
            </Button>
            <Button variant="ghost" onClick={() => navigate("/setup/plan")}>
              Skip — enter bills by hand
            </Button>
          </div>
        </Card>
      )}

      {file && csv && mapping && (
        <>
          <Card
            title={
              <>
                {file.name} {file.isSample && <Badge tone="info">Sample</Badge>}
              </>
            }
            actions={
              <Button small variant="ghost" onClick={() => { setFile(null); setPending(null); }}>
                Choose another file
              </Button>
            }
          >
            <p className="muted small">
              {plural(csv.rows.length, "row")} found{csv.ragged.length ? ` · ${plural(csv.ragged.length, "row")} with an unusual number of columns` : ""}.
            </p>
            {previousImport && (
              <Notice tone="warn" title="You already imported this file">
                On {new Date(previousImport.importedAt).toLocaleDateString("en-US")}. Importing again replaces your transaction history; bills you confirmed stay.
              </Notice>
            )}
            <h3 className="sub">Columns</h3>
            <div className="grid-2">
              {columnSelect("date", "Date")}
              {columnSelect("description", "Description")}
            </div>
            <label className="check">
              <input type="checkbox" checked={useDebitCredit} onChange={(e: { target: { checked: boolean } }) => setUseDebitCredit(e.target.checked)} />
              My file has separate debit and credit columns
            </label>
            {useDebitCredit ? (
              <div className="grid-2">
                {columnSelect("debit", "Debit (money out)")}
                {columnSelect("credit", "Credit (money in)")}
              </div>
            ) : (
              <>
                <div className="grid-2">{columnSelect("amount", "Amount")}</div>
                <fieldset className="radios">
                  <legend className="field-label">How does your bank show money going out?</legend>
                  <label className="check">
                    <input type="radio" name="sign" checked={sign === "negative_is_out"} onChange={() => setSign("negative_is_out")} />
                    As negative numbers (−45.00)
                  </label>
                  <label className="check">
                    <input type="radio" name="sign" checked={sign === "positive_is_out"} onChange={() => setSign("positive_is_out")} />
                    As positive numbers
                  </label>
                </fieldset>
              </>
            )}
            {problems.length > 0 && (
              <Notice tone="warn" title="Choose the missing columns">
                {problems.join(" ")}
              </Notice>
            )}
            {needsDateChoice && (
              <div className="field">
                <label className="field-label" htmlFor="date-format">
                  Date format {dateInfo?.ambiguous ? <Badge tone="warn">Please choose</Badge> : <Badge tone="danger">Not recognized</Badge>}
                </label>
                <select
                  id="date-format"
                  className="input"
                  value={dateChoice ?? ""}
                  onChange={(e: { target: { value: string } }) => setDateChoice((e.target.value || null) as DateFormat | null)}
                  data-testid="date-format"
                >
                  <option value="">— choose —</option>
                  {(["MDY", "DMY", "YMD"] as DateFormat[]).map((f) => (
                    <option key={f} value={f}>
                      {DATE_LABEL[f]}
                    </option>
                  ))}
                </select>
                <div className="field-hint">
                  {dateInfo?.ambiguous
                    ? "Every date in this file could be read either way (like 03/04). Pick the one your bank uses."
                    : "We couldn't recognize the dates. Pick the format, or check that the right column is selected."}
                </div>
              </div>
            )}
          </Card>

          {normalized && (
            <Card title="Check before importing" testId="import-summary">
              <p>
                <strong>{plural(kept, "transaction")}</strong>
                {normalized.firstDate && normalized.lastDate && (
                  <>
                    {" "}
                    from {formatDate(normalized.firstDate)} to {formatDate(normalized.lastDate)}
                  </>
                )}
                .
              </p>
              {allPositive && (
                <Notice tone="warn" title="All amounts have the same sign">
                  Check the “money going out” option above — otherwise spending would look like income.
                </Notice>
              )}
              {normalized.errors.length > 0 && (
                <Notice
                  tone="warn"
                  title={`${plural(normalized.errors.length, "row")} could not be read and will be skipped`}
                  testId="row-errors"
                >
                  <ul className="tight">
                    {normalized.errors.slice(0, 8).map((e) => (
                      <li key={e.row}>
                        Row {e.row}: {e.message}
                      </li>
                    ))}
                    {normalized.errors.length > 8 && <li>…and {normalized.errors.length - 8} more</li>}
                  </ul>
                </Notice>
              )}
              {duplicates.length > 0 && (
                <div className="dupes">
                  <h3 className="sub">Possible duplicates ({duplicates.length})</h3>
                  <p className="muted small">Same date, amount and description as another row. They are kept unless you exclude them — two identical charges can be real.</p>
                  {duplicates.slice(0, 10).map((t) => (
                    <label key={t.id} className="check">
                      <input
                        type="checkbox"
                        checked={excluded.includes(t.id)}
                        onChange={(e: { target: { checked: boolean } }) =>
                          setExcluded(e.target.checked ? [...excluded, t.id] : excluded.filter((x) => x !== t.id))
                        }
                      />
                      Exclude {formatDate(t.postedDate)} · {t.description} · {formatUSD(t.amountCents)}
                    </label>
                  ))}
                </div>
              )}
              {normalized.transfers > 0 && (
                <p className="muted small">
                  {plural(normalized.transfers, "transaction")} look like transfers (tagged below). They are left out of the everyday spending estimate.
                </p>
              )}
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {normalized.transactions.slice(0, 8).map((t) => (
                      <tr key={t.id}>
                        <td>{formatDate(t.postedDate)}</td>
                        <td>
                          {t.description} {t.possibleTransfer && <Badge tone="info">transfer?</Badge>}
                          {t.reviewStatus === "possible_duplicate" && <Badge tone="warn">duplicate?</Badge>}
                        </td>
                        <td className={`num${t.amountCents < 0 ? "" : " positive"}`}>{formatUSD(t.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {normalized.transactions.length > 8 && <p className="muted small">Showing 8 of {normalized.transactions.length}.</p>}
              {normalized.transactions.length === 0 ? (
                <Notice tone="danger" title="Nothing to import">
                  No row could be read with these settings. Check the columns and date format above.
                </Notice>
              ) : (
                <div className="row-actions">
                  <Button onClick={confirm} testId="import-confirm">
                    Import {plural(kept, "transaction")}
                  </Button>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
