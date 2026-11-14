"""
Trains the Covered model and exports it for the TypeScript runtime (src/lib/ai/own).

    python3 tools/ml/train.py          # from app/

Features are hashed exactly like src/lib/ai/own/features.ts (FNV-1a, same normalisation).
Weights are quantised to int8; the TypeScript runtime reproduces these predictions (see the
parity fixtures checked by tests/unit/ai-own.test.ts).
"""
import base64
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
from scipy.sparse import csr_matrix
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier

sys.path.insert(0, str(Path(__file__).parent))
from data import BILL_CATEGORIES, CATEGORIES, INTENTS, category_data, intent_data  # noqa: E402

DIM = 4096
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src/lib/ai/own/weights.json"
FIXTURES = ROOT / "tests/unit/fixtures/own-model-parity.json"


def fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def normalize(text: str) -> list:
    t = text.lower().replace("’", "'")
    t = re.sub(r"\$\s?\d[\d,]*(?:\.\d+)?", " zmoney ", t)
    t = re.sub(r"\b\d[\d,]*(?:\.\d+)?\s?(?:dollars|usd|bucks)\b", " zmoney ", t)
    t = re.sub(r"\b\d{4}-\d{2}-\d{2}\b", " zdate ", t)
    t = re.sub(r"\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b", " zdate ", t)
    t = re.sub(r"\b\d+(?:st|nd|rd|th)\b", " zord ", t)
    t = re.sub(r"\d+(?:\.\d+)?", " znum ", t)
    t = t.replace("'", "")
    t = re.sub(r"[^a-z ]+", " ", t)
    return t.split()


def features(text: str) -> list:
    toks = normalize(text)
    names = set()
    for i, tok in enumerate(toks):
        names.add("w:" + tok)
        if i + 1 < len(toks):
            names.add("b:" + tok + " " + toks[i + 1])
        padded = "#" + tok + "#"
        for j in range(len(padded) - 2):
            names.add("c:" + padded[j : j + 3])
    idx = sorted({fnv1a(n) % DIM for n in names})
    return idx


def matrix(texts):
    rows, cols, vals = [], [], []
    for r, t in enumerate(texts):
        idx = features(t)
        v = 1.0 / math.sqrt(len(idx)) if idx else 0.0
        for c in idx:
            rows.append(r)
            cols.append(c)
            vals.append(v)
    return csr_matrix((vals, (rows, cols)), shape=(len(texts), DIM), dtype=np.float64)


def quant(w: np.ndarray):
    scale = float(np.abs(w).max() / 127.0) or 1.0
    q = np.clip(np.round(w / scale), -127, 127).astype(np.int8)
    return q, scale


def b64(q: np.ndarray) -> str:
    return base64.b64encode(q.tobytes(order="C")).decode("ascii")


def forward_mlp(X, q1, s1, b1, w2, b2):
    h = np.maximum(0, X @ (q1.astype(np.float64) * s1) + b1)
    z = h @ w2 + b2
    z = z - z.max(axis=1, keepdims=True)
    p = np.exp(z)
    return p / p.sum(axis=1, keepdims=True)


def forward_linear(X, q, s, b):
    z = X @ (q.astype(np.float64) * s) + b
    z = z - z.max(axis=1, keepdims=True)
    p = np.exp(z)
    return p / p.sum(axis=1, keepdims=True)


def eval_sentences():
    src = (ROOT / "tests/ai-eval/scenarios.ts").read_text()
    return {m.lower().strip() for m in re.findall(r'message: "([^"]+)"', src)}


def main():
    itr, ite = intent_data()
    ctr, cte = category_data()
    leak = eval_sentences() & {t.lower().strip() for t, _ in itr + ite}
    assert not leak, f"evaluation sentences leaked into training data: {leak}"

    # Intent: one hidden layer MLP.
    Xi, yi = matrix([t for t, _ in itr]), [INTENTS.index(l) for _, l in itr]
    mlp = MLPClassifier(hidden_layer_sizes=(48,), alpha=1e-4, max_iter=300, random_state=0, early_stopping=True)
    mlp.fit(Xi, yi)
    q1, s1 = quant(mlp.coefs_[0])
    b1, w2, b2 = mlp.intercepts_[0], mlp.coefs_[1], mlp.intercepts_[1]
    Xte = matrix([t for t, _ in ite])
    pte = forward_mlp(Xte, q1, s1, b1, w2, b2)
    acc_i = float((pte.argmax(1) == np.array([INTENTS.index(l) for _, l in ite])).mean())
    acc_i_train = float((forward_mlp(Xi, q1, s1, b1, w2, b2).argmax(1) == np.array(yi)).mean())

    # Category: multinomial logistic regression.
    Xc, yc = matrix([t for t, _ in ctr]), [CATEGORIES.index(l) for _, l in ctr]
    lr = LogisticRegression(C=8.0, max_iter=3000)
    lr.fit(Xc, yc)
    qc, sc = quant(lr.coef_.T)  # DIM x K
    bc = lr.intercept_
    Xcte = matrix([t for t, _ in cte])
    pcte = forward_linear(Xcte, qc, sc, bc)
    y_cte = np.array([CATEGORIES.index(l) for _, l in cte])
    acc_c = float((pcte.argmax(1) == y_cte).mean())
    bill_true = np.array([l in BILL_CATEGORIES for _, l in cte])
    bill_pred = np.array([CATEGORIES[k] in BILL_CATEGORIES for k in pcte.argmax(1)])
    acc_bill = float((bill_true == bill_pred).mean())

    model = {
        "name": "covered-nlu-1",
        "dim": DIM,
        "trainedOn": {"intentExamples": len(itr), "categoryExamples": len(ctr)},
        "heldOut": {
            "intentAccuracy": round(acc_i, 4),
            "intentExamples": len(ite),
            "categoryAccuracy": round(acc_c, 4),
            "billOrNotAccuracy": round(acc_bill, 4),
            "categoryExamples": len(cte),
        },
        "intent": {
            "labels": INTENTS,
            "hidden": int(q1.shape[1]),
            "w1": b64(q1),
            "w1Scale": s1,
            "b1": [round(float(x), 6) for x in b1],
            "w2": [[round(float(x), 6) for x in row] for row in w2],
            "b2": [round(float(x), 6) for x in b2],
        },
        "category": {
            "labels": CATEGORIES,
            "billLabels": sorted(BILL_CATEGORIES),
            "w": b64(qc),
            "wScale": sc,
            "b": [round(float(x), 6) for x in bc],
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(model, separators=(",", ":")))

    # Parity fixtures for the TypeScript runtime (uses the rounded b1/w2/b2 exactly as exported).
    b1r = np.array(model["intent"]["b1"])
    w2r = np.array(model["intent"]["w2"])
    b2r = np.array(model["intent"]["b2"])
    bcr = np.array(model["category"]["b"])
    texts = ["Can I afford a $400 jacket?", "my car insurance went up by $30", "Rent is now due on Nov 22",
             "Explain my plan", "hello there", "Add a dentist bill of $120 due Nov 21", "internet is now $65"]
    cats = ["OAKWOOD APARTMENTS ONLINE PMT", "TRANSFER TO SAVINGS 4521", "SKYTALK WIRELESS", "GREENLEAF MARKET #0412"]
    fx = {
        "intent": [{"text": t, "features": features(t),
                    "probs": [round(float(p), 6) for p in forward_mlp(matrix([t]), q1, s1, b1r, w2r, b2r)[0]]} for t in texts],
        "category": [{"text": t, "probs": [round(float(p), 6) for p in forward_linear(matrix([t]), qc, sc, bcr)[0]]} for t in cats],
    }
    FIXTURES.parent.mkdir(parents=True, exist_ok=True)
    FIXTURES.write_text(json.dumps(fx, indent=1))

    size = OUT.stat().st_size
    print(f"intent: train acc {acc_i_train:.3f}, held-out acc {acc_i:.3f} on {len(ite)} unseen phrasings")
    print(f"category: held-out acc {acc_c:.3f}, bill-or-not {acc_bill:.3f} on {len(cte)} unseen names")
    print(f"exported {OUT.relative_to(ROOT)} ({size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
