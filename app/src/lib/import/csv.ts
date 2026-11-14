/** Minimal RFC 4180 CSV reader that runs in the browser: quotes, escaped quotes, CRLF, BOM. */

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 5000;

export interface ParsedCsv {
  delimiter: string;
  headers: string[];
  rows: string[][];
  /** Row numbers (1-based, header = row 1) that had a different number of cells than the header. */
  ragged: number[];
}

export class CsvError extends Error {}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    // count delimiters outside quotes
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(input: string): ParsedCsv {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.trim()) throw new CsvError("The file is empty.");
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field.trim() === "") {
      field = "";
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) records.push(row);
      row = [];
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++;
      if (records.length > MAX_ROWS + 1) {
        throw new CsvError(`The file has more than ${MAX_ROWS.toLocaleString("en-US")} rows. Export a shorter date range.`);
      }
      continue;
    }
    field += ch;
    i++;
  }
  if (inQuotes) throw new CsvError("The file has an unclosed quote. It may be cut off or not a CSV file.");
  row.push(field);
  if (row.some((c) => c.trim() !== "")) records.push(row);
  if (records.length < 2) throw new CsvError("The file needs a header row and at least one transaction.");
  if (records.length > MAX_ROWS + 1) {
    throw new CsvError(`The file has more than ${MAX_ROWS.toLocaleString("en-US")} rows. Export a shorter date range.`);
  }
  const headers = records[0].map((h) => h.trim());
  const ragged: number[] = [];
  const rows = records.slice(1).map((r, idx) => {
    if (r.length !== headers.length) ragged.push(idx + 2);
    return r.map((c) => c.trim());
  });
  return { delimiter, headers, rows, ragged };
}

/** Fast non-cryptographic hash (FNV-1a) used to notice re-imports of the same file. */
export function fileHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0") + text.length.toString(16);
}
