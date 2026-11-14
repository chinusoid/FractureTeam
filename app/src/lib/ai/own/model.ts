/**
 * Covered model runtime: a small neural network for the user's intent and a linear model for bill
 * categories, trained by tools/ml/train.py on our own synthetic data. Runs in the app server with no
 * external service: no GPU, no network, about a millisecond per request.
 */
import weights from "./weights.json";
import { features } from "./features";

export interface Prediction<L extends string = string> {
  label: L;
  confidence: number;
  probs: Record<string, number>;
}

interface Weights {
  name: string;
  dim: number;
  trainedOn: { intentExamples: number; categoryExamples: number };
  heldOut: { intentAccuracy: number; intentExamples: number; categoryAccuracy: number; billOrNotAccuracy: number; categoryExamples: number };
  intent: { labels: string[]; hidden: number; w1: string; w1Scale: number; b1: number[]; w2: number[][]; b2: number[] };
  category: { labels: string[]; billLabels: string[]; w: string; wScale: number; b: number[] };
}

const W = weights as Weights;

function decodeInt8(b64: string): Int8Array {
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) << 24) >> 24;
  return out;
}

let cache: { w1: Int8Array; wc: Int8Array } | null = null;
function tensors() {
  cache ??= { w1: decodeInt8(W.intent.w1), wc: decodeInt8(W.category.w) };
  return cache;
}

function softmax(z: number[]): number[] {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

function toPrediction(labels: string[], probs: number[]): Prediction {
  let k = 0;
  probs.forEach((p, i) => {
    if (p > probs[k]) k = i;
  });
  return { label: labels[k], confidence: probs[k], probs: Object.fromEntries(labels.map((l, i) => [l, probs[i]])) };
}

export type Intent = "purchase" | "bill_up" | "bill_down" | "bill_set" | "bill_due" | "bill_new" | "explain" | "other";

export function predictIntent(text: string): Prediction<Intent> {
  const { w1 } = tensors();
  const { hidden, w1Scale, b1, w2, b2, labels } = W.intent;
  const idx = features(text, W.dim);
  const v = idx.length ? 1 / Math.sqrt(idx.length) : 0;
  const h = b1.slice();
  for (const i of idx) {
    const row = i * hidden;
    for (let j = 0; j < hidden; j++) h[j] += w1[row + j] * w1Scale * v;
  }
  for (let j = 0; j < hidden; j++) if (h[j] < 0) h[j] = 0;
  const z = b2.slice();
  for (let j = 0; j < hidden; j++) {
    if (h[j] === 0) continue;
    const r = w2[j];
    for (let k = 0; k < z.length; k++) z[k] += h[j] * r[k];
  }
  return toPrediction(labels, softmax(z)) as Prediction<Intent>;
}

export function predictCategory(text: string): Prediction & { isBill: boolean } {
  const { wc } = tensors();
  const { labels, wScale, b, billLabels } = W.category;
  const k = labels.length;
  const idx = features(text, W.dim);
  const v = idx.length ? 1 / Math.sqrt(idx.length) : 0;
  const z = b.slice();
  for (const i of idx) {
    const row = i * k;
    for (let j = 0; j < k; j++) z[j] += wc[row + j] * wScale * v;
  }
  const p = toPrediction(labels, softmax(z));
  return { ...p, isBill: billLabels.includes(p.label) };
}

export const OWN_MODEL = {
  name: W.name,
  trainedOn: W.trainedOn,
  heldOut: W.heldOut,
};
