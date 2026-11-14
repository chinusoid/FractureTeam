// Builds the Covered pitch deck (10 slides, 16:9).
//   npm install pptxgenjs sharp react react-dom react-icons      (in the folder you run this from)
//   PROD_URL=https://your-site.vercel.app APPLY_THEME=<path to apply_theme.js> node build.js <screenshots dir> <output.pptx>
// Without PROD_URL the deck shows a marked placeholder for the production link.
const path = require("node:path");
const pptxgen = require("pptxgenjs");
const sharp = require("sharp");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const fi = require("react-icons/fi");

const [SHOTS, OUT] = process.argv.slice(2);
const PROD_URL = (process.env.PROD_URL || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const REPO = "github.com/chinusoid/FractureTeam";

const THEME = {
  name: "Covered",
  headFontFace: "Arial",
  bodyFontFace: "Arial",
  colors: {
    dk1: "1C1C19", // ink
    lt1: "FFFFFF",
    dk2: "5F6058", // muted text
    lt2: "F6F7ED", // the product's pale cream
    accent1: "2F3A26", // deep olive
    accent2: "6B7A4F", // olive
    accent3: "E3E5D6", // borders, light text on dark
    accent4: "E7ECD9", // "fact" tag
    accent5: "F6E7D8", // "hypothesis" tag
    accent6: "8A4B1F", // warm brown
    hlink: "2F3A26",
    folHlink: "6B7A4F",
  },
};
const HEX = THEME.colors;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = "Covered — pitch deck";
pres.author = "FractureTeam";
pres.subject = "Business Cup 2.0, track Money";
const C = pres.SchemeColor;
const S = pres.ShapeType;

const W = 13.333;
const MX = 0.6;
const CW = W - 2 * MX;
const TOP = 2.0;

// ---------------------------------------------------------------- layouts
const titleBox = (color) => ({
  placeholder: { options: { name: "title", type: "title", x: MX, y: 0.86, w: CW, h: 0.8, fontSize: 34, bold: true, color, align: "left", valign: "top", margin: 0 }, text: "" },
});
const footer = (color) => ({ text: { text: "Covered", options: { x: MX, y: 6.93, w: 3, h: 0.3, fontSize: 10, color, margin: 0 } } });

pres.defineSlideMaster({ title: "COVER", background: { color: C.text1 }, objects: [] });
pres.defineSlideMaster({
  title: "CONTENT",
  background: { color: C.background1 },
  objects: [titleBox(C.text1), footer(C.text2)],
  slideNumber: { x: W - MX - 0.5, y: 6.93, w: 0.5, h: 0.3, fontSize: 10, color: HEX.dk2, align: "right" },
});
pres.defineSlideMaster({
  title: "CONTENT_DARK",
  background: { color: C.text1 },
  objects: [titleBox(C.background1), footer(C.accent3)],
  slideNumber: { x: W - MX - 0.5, y: 6.93, w: 0.5, h: 0.3, fontSize: 10, color: HEX.accent3, align: "right" },
});

// ---------------------------------------------------------------- helpers
let n = 0;
const name = (base) => `${base} ${++n}`;
const text = (slide, value, o) => slide.addText(value, { isTextBox: true, margin: 0, valign: "top", objectName: name("Text"), ...o });
const box = (slide, o) => slide.addShape(S.roundRect, { rectRadius: 0.14, objectName: name("Card"), ...o });
const kicker = (slide, value, color = C.accent2) => text(slide, value, { x: MX, y: 0.5, w: 8, h: 0.3, fontSize: 12, bold: true, charSpacing: 2, color });

const TAGS = {
  FACT: { fill: C.accent4, color: C.accent1, w: 0.72 },
  HYPOTHESIS: { fill: C.accent5, color: C.accent6, w: 1.38 },
  ESTIMATE: { fill: C.accent5, color: C.accent6, w: 1.14 },
  TARGET: { fill: C.accent5, color: C.accent6, w: 0.95 },
};
function tag(slide, kind, x, y) {
  const t = TAGS[kind];
  slide.addShape(S.roundRect, { x, y, w: t.w, h: 0.28, rectRadius: 0.14, fill: { color: t.fill }, line: { color: t.fill, width: 0 }, objectName: name("Tag") });
  text(slide, kind, { x, y, w: t.w, h: 0.28, fontSize: 10, bold: true, charSpacing: 1, color: t.color, align: "center", valign: "middle" });
  return t.w;
}

async function icon(Comp, hex) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { color: `#${hex}`, size: "256" }));
  return "image/png;base64," + (await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64");
}
async function iconCircle(slide, Comp, x, y, { size = 0.56, fill = C.background2, hex = HEX.dk1 } = {}) {
  slide.addShape(S.ellipse, { x, y, w: size, h: size, fill: { color: fill }, line: { color: fill, width: 0 }, objectName: name("Icon circle") });
  const pad = size * 0.27;
  slide.addImage({ data: await icon(Comp, hex), x: x + pad, y: y + pad, w: size - 2 * pad, h: size - 2 * pad, objectName: name("Icon") });
}
function numberCircle(slide, value, x, y, { size = 0.56, fill = C.text1, color = C.background1 } = {}) {
  slide.addShape(S.ellipse, { x, y, w: size, h: size, fill: { color: fill }, line: { color: fill, width: 0 }, objectName: name("Number circle") });
  text(slide, String(value), { x, y, w: size, h: size, fontSize: 16, bold: true, color, align: "center", valign: "middle" });
}

/** Screenshot (optionally cropped) with rounded corners, plus a thin frame behind it. */
async function shot(slide, file, { crop, x, y, w, h, radiusPx = 36, alt, frame = HEX.accent3 }) {
  let img = sharp(path.join(SHOTS, file));
  if (crop) img = img.extract(crop);
  const raw = await img.png().toBuffer();
  const meta = await sharp(raw).metadata();
  const ratio = meta.width / meta.height;
  if (w === undefined) w = h * ratio;
  if (h === undefined) h = w / ratio;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}"><rect width="${meta.width}" height="${meta.height}" rx="${radiusPx}" ry="${radiusPx}" fill="#fff"/></svg>`);
  const rounded = await sharp(raw).ensureAlpha().composite([{ input: mask, blend: "dest-in" }]).png({ compressionLevel: 9 }).toBuffer();
  const radiusIn = (radiusPx / meta.width) * w;
  slide.addShape(S.roundRect, {
    x: x - 0.02, y: y - 0.02, w: w + 0.04, h: h + 0.04, rectRadius: radiusIn + 0.02,
    fill: { color: C.background1 }, line: { color: frame, width: 1 },
    shadow: { type: "outer", color: "000000", opacity: 0.12, blur: 14, offset: 4, angle: 90 },
    objectName: name("Screenshot frame"),
  });
  slide.addImage({ data: "image/png;base64," + rounded.toString("base64"), x, y, w, h, altText: alt, objectName: name("Screenshot") });
  return { w, h };
}

function prodLink(slide, x, y, { color, mutedColor, w = 6 }) {
  text(slide, "Live", { x, y, w: 0.7, h: 0.32, fontSize: 13, color: mutedColor, valign: "middle" });
  if (PROD_URL) {
    text(slide, PROD_URL, { x: x + 0.75, y, w: w - 0.75, h: 0.32, fontSize: 13, bold: true, color, valign: "middle" });
  } else {
    slide.addShape(S.roundRect, { x: x + 0.75, y, w: 3.75, h: 0.32, rectRadius: 0.08, fill: { color: C.accent5 }, line: { color: C.accent6, width: 1, dashType: "dash" }, objectName: name("Production URL placeholder") });
    text(slide, "ADD PRODUCTION URL BEFORE SUBMITTING", { x: x + 0.75, y, w: 3.75, h: 0.32, fontSize: 10, bold: true, color: C.accent6, align: "center", valign: "middle" });
  }
  text(slide, "Code", { x, y: y + 0.42, w: 0.7, h: 0.32, fontSize: 13, color: mutedColor, valign: "middle" });
  text(slide, REPO, { x: x + 0.75, y: y + 0.42, w: w - 0.75, h: 0.32, fontSize: 13, bold: true, color, valign: "middle" });
}

// ---------------------------------------------------------------- slides
async function build() {
  // 1 — cover
  pres.addSection({ title: "Problem" });
  {
    const s = pres.addSlide({ masterName: "COVER", sectionTitle: "Problem" });
    s.addImage({ data: await icon(fi.FiCheckCircle, HEX.lt2), x: MX, y: 0.62, w: 0.36, h: 0.36, objectName: "Logo mark" });
    text(s, "Covered", { x: MX + 0.48, y: 0.6, w: 3, h: 0.4, fontSize: 20, bold: true, color: C.background2, valign: "middle" });
    text(s, "Know what’s covered\nbefore you spend", { x: MX, y: 2.05, w: 5.9, h: 1.5, fontSize: 38, bold: true, color: C.background1, objectName: "Title" });
    text(s, "A bill planner for working adults in the US. It shows what is already spoken for, what is left, and what a purchase would do to the plan.", {
      x: MX, y: 3.75, w: 5.6, h: 1.15, fontSize: 16, color: C.accent3, lineSpacingMultiple: 1.15,
    });
    prodLink(s, MX, 5.35, { color: C.background1, mutedColor: C.accent3, w: 5.9 });
    text(s, "Business Cup 2.0  ·  Track: Money  ·  FractureTeam", { x: MX, y: 6.78, w: 6, h: 0.3, fontSize: 11, color: C.accent3 });
    await shot(s, "landing.png", { x: 6.75, y: 1.72, w: 5.98, alt: "Covered landing page: a sample plan with $300 available to spend", frame: HEX.dk2 });
    s.addNotes("0:00. Covered answers one question for a working adult in the US: of the money in my account, how much is actually mine to spend? I will show the product live, then what we sell and what we have and have not proven.");
  }

  // 2 — problem
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Problem" });
    kicker(s, "THE PROBLEM");
    s.addText("Money in the bank is not money to spend", { placeholder: "title" });
    box(s, { x: MX, y: TOP, w: 6.9, h: 2.85, fill: { color: C.background2 }, line: { color: C.background2, width: 0 } });
    tag(s, "HYPOTHESIS", MX + 0.35, TOP + 0.32);
    text(s, "“There’s money in my account, but I don’t know how much of it is already needed for bills — or what happens if I buy this now.”", {
      x: MX + 0.35, y: TOP + 0.78, w: 6.2, h: 1.25, fontSize: 20, italic: true, color: C.text1, lineSpacingMultiple: 1.12,
    });
    text(s, "Our statement of the pain. Not yet a quote from an interview.", { x: MX + 0.35, y: TOP + 2.3, w: 6.2, h: 0.3, fontSize: 12, color: C.text2 });
    await iconCircle(s, fi.FiUser, MX, 5.25);
    text(s, [
      { text: "Starting segment. ", options: { bold: true } },
      { text: "A working adult in the US, 25–45: a regular paycheck, several fixed bills, tried a budgeting app and stopped keeping it up." },
    ], { x: MX + 0.8, y: 5.22, w: 6.1, h: 1.0, fontSize: 14, color: C.text1, lineSpacingMultiple: 1.15 });

    const x = 7.9, w = W - MX - 7.9;
    box(s, { x, y: TOP, w, h: 4.45, fill: { color: C.background1 }, line: { color: C.accent3, width: 1 } });
    tag(s, "FACT", x + 0.4, TOP + 0.32);
    text(s, "37%", { x: x + 0.4, y: TOP + 0.7, w: w - 0.8, h: 1.2, fontSize: 72, bold: true, color: C.text1, valign: "middle" });
    text(s, "of US adults would not cover a $400 emergency expense with cash or its equivalent", { x: x + 0.4, y: TOP + 1.9, w: w - 0.8, h: 0.95, fontSize: 16, color: C.text1, lineSpacingMultiple: 1.12 });
    text(s, "A $400 decision is not small. It is the exact check our demo runs.", { x: x + 0.4, y: TOP + 3.05, w: w - 0.8, h: 0.6, fontSize: 14, bold: true, color: C.accent1, lineSpacingMultiple: 1.12 });
    text(s, "Source: Federal Reserve, Economic Well-Being of U.S. Households in 2025 (63% would cover it).", { x: x + 0.4, y: TOP + 3.85, w: w - 0.8, h: 0.4, fontSize: 10, color: C.text2 });
    s.addNotes("0:20. The person: a regular paycheck, rent, insurance, internet, a phone bill. The balance looks fine, but part of it is already promised. The Fed's 2025 survey: 37% of adults would not cover a $400 surprise from cash. So 'can I afford $400' is a real question. The quote and the segment are our hypothesis; interviews come next.");
  }

  // 3 — alternatives
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Problem" });
    kicker(s, "ALTERNATIVES");
    s.addText("Budget apps exist. Keeping one up is hard", { placeholder: "title" });
    const cols = [MX + 0.3, 3.2, 8.05];
    const widths = [2.4, 4.55, 4.4];
    text(s, "Today’s option", { x: cols[0], y: TOP, w: widths[0], h: 0.3, fontSize: 12, bold: true, color: C.text2, valign: "middle" });
    text(s, "What it already does", { x: cols[1], y: TOP, w: 2.1, h: 0.3, fontSize: 12, bold: true, color: C.text2, valign: "middle" });
    tag(s, "FACT", cols[1] + 2.0, TOP + 0.01);
    text(s, "Where Covered focuses", { x: cols[2], y: TOP, w: 2.2, h: 0.3, fontSize: 12, bold: true, color: C.text2, valign: "middle" });
    tag(s, "HYPOTHESIS", cols[2] + 2.15, TOP + 0.01);
    const rows = [
      ["YNAB", "$14.99 a month", "Auto-Assign spreads money across targets and scheduled transactions", "Start by confirming bills, not by building categories"],
      ["PocketGuard", "$12.99 a month", "“Leftover” shows what remains after bills, goals and debt", "Every number opens down to the transactions behind it"],
      ["Monarch", "$14.99 a month", "AI assistant, explanations and a weekly review", "A sentence becomes a before/after draft you confirm"],
      ["Spreadsheet", "free", "Whatever the template allows", "Import, suggestions and recalculation in one flow"],
    ];
    rows.forEach((r, i) => {
      const y = TOP + 0.45 + i * 0.84;
      box(s, { x: MX, y, w: CW, h: 0.74, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.background2, width: 0 } });
      text(s, r[0], { x: cols[0], y: y + 0.1, w: widths[0], h: 0.3, fontSize: 16, bold: true, color: C.text1 });
      text(s, r[1], { x: cols[0], y: y + 0.41, w: widths[0], h: 0.25, fontSize: 11, color: C.text2 });
      text(s, r[2], { x: cols[1], y, w: widths[1], h: 0.74, fontSize: 14, color: C.text2, valign: "middle" });
      text(s, r[3], { x: cols[2], y, w: widths[2], h: 0.74, fontSize: 14, bold: true, color: C.text1, valign: "middle" });
    });
    text(s, "In one line: one sentence checks a purchase or changes a bill, and you see before and after ahead of saving.", { x: MX, y: 5.9, w: CW, h: 0.35, fontSize: 15, bold: true, color: C.accent1 });
    text(s, "Features: YNAB, PocketGuard and Monarch help pages. Prices: list prices reported in November 2026 (PocketGuard from its own site; YNAB and Monarch from review sites).", { x: MX, y: 6.38, w: CW, h: 0.3, fontSize: 10, color: C.text2 });
    s.addNotes("0:40. These tools are good and they already compute a leftover. People still quit them because of upkeep. Our bet is the whole flow: import, confirm, ask, update. That it is faster and clearer than the alternatives is a hypothesis we test on the same task after the hackathon.");
  }

  // 4 — product
  pres.addSection({ title: "Product" });
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Product" });
    kicker(s, "THE PRODUCT");
    s.addText("Import. Confirm. See what is yours", { placeholder: "title" });
    const steps = [
      ["Import a bank CSV", "Read in your browser, never uploaded."],
      ["Confirm the bills we found", "Nothing enters the plan until you confirm it."],
      ["See what is left", "After bills, daily spending and your reserve."],
    ];
    steps.forEach((st, i) => {
      const y = TOP + 0.05 + i * 1.08;
      numberCircle(s, i + 1, MX, y);
      text(s, st[0], { x: MX + 0.8, y: y - 0.02, w: 4.6, h: 0.35, fontSize: 18, bold: true, color: C.text1 });
      text(s, st[1], { x: MX + 0.8, y: y + 0.38, w: 4.6, h: 0.3, fontSize: 14, color: C.text2 });
    });
    box(s, { x: MX, y: 5.25, w: 5.2, h: 1.1, fill: { color: C.background2 }, line: { color: C.background2, width: 0 } });
    text(s, "$2,200 − $1,300 − $350 − $250 = $300", { x: MX + 0.3, y: 5.4, w: 4.6, h: 0.4, fontSize: 17, bold: true, color: C.text1, valign: "middle" });
    text(s, "balance − bills − everyday spending − reserve = available", { x: MX + 0.3, y: 5.85, w: 4.6, h: 0.3, fontSize: 11, color: C.text2, valign: "middle" });
    await shot(s, "overview.png", { x: 6.2, y: TOP + 0.1, w: W - MX - 6.2, alt: "Covered overview: $300 available to spend, upcoming bills and a purchase check" });
    s.addNotes("1:00 — switch to the live product here. Try sample data, continue to setup, confirm the bills (point at the savings transfer it flagged), build the plan. $2,200 in the account, $300 actually free.");
  }

  // 5 — demo
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Product" });
    kicker(s, "LIVE DEMO");
    s.addText("Ask before you spend. Confirm to save", { placeholder: "title" });
    const imgY = TOP + 0.42, imgH = 3.95;
    text(s, "1   Check a purchase", { x: MX, y: TOP - 0.02, w: 4.5, h: 0.3, fontSize: 14, bold: true, color: C.text1 });
    const a = await shot(s, "dlg-purchase.png", { crop: { left: 30, top: 975, width: 800, height: 655 }, x: MX, y: imgY, h: imgH, radiusPx: 24, alt: "Assistant answer: a $400 purchase leaves you $100 below your $250 reserve; bills and everyday spending are still covered" });
    const bx = MX + a.w + 0.4;
    text(s, "2   Change a bill", { x: bx, y: TOP - 0.02, w: 3, h: 0.3, fontSize: 14, bold: true, color: C.text1 });
    const b = await shot(s, "assistant-proposal.png", { crop: { left: 1700, top: 184, width: 812, height: 1046 }, x: bx, y: imgY, h: imgH, radiusPx: 24, alt: "Assistant draft: car insurance from $150 to $180, available from $300 to $270, with a Confirm change button" });
    const tx = bx + b.w + 0.45, tw = W - MX - tx;
    text(s, "The right warning", { x: tx, y: imgY, w: tw, h: 0.35, fontSize: 16, bold: true, color: C.text1 });
    text(s, "$100 below the reserve. Bills and everyday spending stay covered. It does not say you cannot pay rent.", { x: tx, y: imgY + 0.42, w: tw, h: 1.3, fontSize: 14, color: C.text2, lineSpacingMultiple: 1.15 });
    text(s, "A draft, not a write", { x: tx, y: imgY + 1.95, w: tw, h: 0.35, fontSize: 16, bold: true, color: C.text1 });
    text(s, "Before and after, side by side. Nothing is saved until you press Confirm.", { x: tx, y: imgY + 2.37, w: tw, h: 1.0, fontSize: 14, color: C.text2, lineSpacingMultiple: 1.15 });
    text(s, "Screens from the product with its sample data.", { x: tx, y: imgY + imgH - 0.45, w: tw, h: 0.45, fontSize: 11, color: C.text2, valign: "bottom" });
    s.addNotes("1:40, still live. Ask: can I afford $400 this weekend? The answer is precise: $100 below the reserve, bills still covered. Then: my car insurance went up by $30. A draft with before and after appears; press Confirm, the plan moves from $300 to $270. Then update the balance to $950 and tick rent as paid: still $270, nothing counted twice. Backup: recorded video.");
  }

  // 6 — how it works
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Product" });
    kicker(s, "HOW IT WORKS");
    s.addText("The model never does the math", { placeholder: "title" });
    const flow = [
      ["You", "Ask in plain English"],
      ["The model", "Picks 1 of 4 functions"],
      ["Tested code", "Computes every dollar"],
      ["You", "Confirm to save"],
    ];
    const fw = 2.62, gap = (CW - 4 * fw) / 3;
    for (let i = 0; i < flow.length; i++) {
      const x = MX + i * (fw + gap);
      const dark = i === 2;
      box(s, { x, y: TOP, w: fw, h: 1.2, fill: { color: dark ? C.text1 : C.background2 }, line: { color: dark ? C.text1 : C.background2, width: 0 } });
      text(s, flow[i][0], { x: x + 0.25, y: TOP + 0.2, w: fw - 0.5, h: 0.28, fontSize: 11, bold: true, charSpacing: 1, color: dark ? C.accent3 : C.text2 });
      text(s, flow[i][1], { x: x + 0.25, y: TOP + 0.55, w: fw - 0.5, h: 0.45, fontSize: 15, bold: true, color: dark ? C.background1 : C.text1 });
      if (i < flow.length - 1) s.addImage({ data: await icon(fi.FiArrowRight, HEX.dk2), x: x + fw + (gap - 0.3) / 2, y: TOP + 0.45, w: 0.3, h: 0.3, objectName: name("Arrow") });
    }
    const cards = [
      [fi.FiDollarSign, "Amounts are checked", "A dollar figure in the model’s text that does not match a computed value is replaced before you see it."],
      [fi.FiEdit3, "Drafts, not writes", "The server stores nothing. A change applies only after Confirm, and only to the plan version it was drafted for."],
      [fi.FiLock, "Private by default", "The CSV is parsed in the browser. The assistant is off until you agree, and account numbers and emails are removed."],
    ];
    const cw = (CW - 0.6) / 3;
    for (let i = 0; i < cards.length; i++) {
      const x = MX + i * (cw + 0.3), y = TOP + 1.6;
      box(s, { x, y, w: cw, h: 2.45, fill: { color: C.background1 }, line: { color: C.accent3, width: 1 } });
      await iconCircle(s, cards[i][0], x + 0.3, y + 0.3);
      text(s, cards[i][1], { x: x + 1.02, y: y + 0.3, w: cw - 1.3, h: 0.56, fontSize: 16, bold: true, color: C.text1, valign: "middle" });
      text(s, cards[i][2], { x: x + 0.3, y: y + 1.05, w: cw - 0.6, h: 1.25, fontSize: 14, color: C.text2, lineSpacingMultiple: 1.15 });
    }
    text(s, "If the model guesses between two similar bills or invents a due date, the server rejects the draft and the model asks instead.", { x: MX, y: 6.38, w: CW, h: 0.3, fontSize: 11, color: C.text2 });
    s.addNotes("3:00. Why you can trust the numbers. The model only understands the sentence and chooses one of four server functions: plan summary, purchase check, bill change, new bill. The money is computed by code covered with tests. If the model writes a figure that does not match, it is replaced. If it guesses which bill you meant, the server refuses and it asks. Nothing is saved on the server; the CSV never leaves the browser.");
  }

  // 7 — what we sell
  pres.addSection({ title: "Business" });
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Business" });
    kicker(s, "WHAT WE SELL");
    s.addText("What we sell: a plan that stays true", { placeholder: "title" });
    const pw = 4.5;
    box(s, { x: MX, y: TOP, w: pw, h: 4.45, fill: { color: C.text1 }, line: { color: C.text1, width: 0 } });
    tag(s, "HYPOTHESIS", MX + 0.4, TOP + 0.35);
    text(s, [
      { text: "$10", options: { fontSize: 66, bold: true, color: C.background1 } },
      { text: "  a month", options: { fontSize: 18, color: C.accent3 } },
    ], { x: MX + 0.4, y: TOP + 0.8, w: pw - 0.8, h: 1.15, valign: "middle" });
    text(s, "A subscription for the assistant and for keeping the plan current.", { x: MX + 0.4, y: TOP + 2.1, w: pw - 0.8, h: 0.75, fontSize: 15, color: C.background1, lineSpacingMultiple: 1.15 });
    text(s, "Below YNAB ($14.99), Monarch ($14.99) and PocketGuard ($12.99) a month.", { x: MX + 0.4, y: TOP + 3.05, w: pw - 0.8, h: 0.6, fontSize: 13, color: C.accent3, lineSpacingMultiple: 1.15 });
    text(s, "List prices reported in November 2026.", { x: MX + 0.4, y: TOP + 3.85, w: pw - 0.8, h: 0.3, fontSize: 10, color: C.accent3 });

    const rx = MX + pw + 0.55, rw = W - MX - rx;
    text(s, "Why they come back", { x: rx, y: TOP, w: rw, h: 0.4, fontSize: 18, bold: true, color: C.text1 });
    const loop = [
      [fi.FiRefreshCw, "Every payday", "A calendar reminder brings you back: new balance, paid bills, what changed."],
      [fi.FiEdit3, "When a bill changes", "Say it in one sentence, check before and after, confirm."],
      [fi.FiShoppingBag, "Before a purchase", "Ask first. The answer names what is affected: the reserve, everyday spending or bills."],
    ];
    for (let i = 0; i < loop.length; i++) {
      const y = TOP + 0.7 + i * 1.12;
      await iconCircle(s, loop[i][0], rx, y);
      text(s, loop[i][1], { x: rx + 0.8, y: y - 0.03, w: rw - 0.8, h: 0.32, fontSize: 16, bold: true, color: C.text1 });
      text(s, loop[i][2], { x: rx + 0.8, y: y + 0.33, w: rw - 0.8, h: 0.6, fontSize: 14, color: C.text2, lineSpacingMultiple: 1.12 });
    }
    const tw = tag(s, "TARGET", rx, 6.14);
    text(s, "First plan in 5 minutes, weekly update in 2. To be measured in walkthroughs.", { x: rx + tw + 0.15, y: 6.14, w: rw - tw - 0.15, h: 0.28, fontSize: 12, color: C.text2, valign: "middle" });
    s.addNotes("3:30. What the user pays for: not charts, but not having to keep a budget by hand. $10 a month is a hypothesis, set below the main alternatives. The reason to return is built into life: payday, a bill that changes, a purchase you are unsure about.");
  }

  // 8 — business potential
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Business" });
    kicker(s, "BUSINESS POTENTIAL");
    s.addText("$100M ARR is under 1% of the segment", { placeholder: "title" });
    const stats = [["10,000", "$1.2M"], ["100,000", "$12M"], ["834,000", "$100M"]];
    const cw = (CW - 0.6) / 3;
    stats.forEach((st, i) => {
      const x = MX + i * (cw + 0.3), dark = i === 2;
      box(s, { x, y: TOP, w: cw, h: 1.85, fill: { color: dark ? C.text1 : C.background2 }, line: { color: dark ? C.text1 : C.background2, width: 0 } });
      text(s, "paying users", { x: x + 0.35, y: TOP + 0.2, w: cw - 0.7, h: 0.28, fontSize: 12, color: dark ? C.accent3 : C.text2 });
      text(s, st[0], { x: x + 0.35, y: TOP + 0.45, w: cw - 0.7, h: 0.7, fontSize: 36, bold: true, color: dark ? C.background1 : C.text1, valign: "middle" });
      text(s, [
        { text: st[1], options: { bold: true, color: dark ? C.background1 : C.text1 } },
        { text: "  a year", options: { color: dark ? C.accent3 : C.text2 } },
      ], { x: x + 0.35, y: TOP + 1.22, w: cw - 0.7, h: 0.4, fontSize: 18, valign: "middle" });
    });
    const y2 = TOP + 2.15, h2 = 1.9, lw = 5.75;
    box(s, { x: MX, y: y2, w: lw, h: h2, fill: { color: C.background1 }, line: { color: C.accent3, width: 1 } });
    text(s, "0.9%", { x: MX + 0.35, y: y2 + 0.25, w: 1.9, h: 0.8, fontSize: 40, bold: true, color: C.text1, valign: "middle" });
    text(s, "834,000 subscribers is about 0.9% of roughly 89 million US adults aged 25–44.", { x: MX + 2.3, y: y2 + 0.25, w: lw - 2.6, h: 0.95, fontSize: 14, color: C.text1, lineSpacingMultiple: 1.15 });
    text(s, "Population: US Census Bureau estimates, 2024 (approximate).", { x: MX + 0.35, y: y2 + 1.35, w: lw - 0.7, h: 0.28, fontSize: 10, color: C.text2 });

    const rx = MX + lw + 0.3, rw = CW - lw - 0.3;
    box(s, { x: rx, y: y2, w: rw, h: h2, fill: { color: C.background1 }, line: { color: C.accent3, width: 1 } });
    text(s, "Unit economics so far", { x: rx + 0.35, y: y2 + 0.22, w: 3.2, h: 0.35, fontSize: 16, bold: true, color: C.text1, valign: "middle" });
    tag(s, "FACT", rx + rw - 0.72 - 0.35, y2 + 0.25);
    text(s, [
      { text: "AI costs $0.0003 per task, measured on gpt-6-luna: 100 tasks a month is 3 cents", options: { bullet: true, breakLine: true } },
      { text: "LTV and CAC: from the pilot, not guessed", options: { bullet: true } },
    ], { x: rx + 0.35, y: y2 + 0.7, w: rw - 0.7, h: 1.0, fontSize: 14, color: C.text2, paraSpaceAfter: 5 });
    text(s, "Yearly revenue = users × $10 × 12, before discounts, churn and fees. Scale arithmetic at a hypothetical price, not a demand forecast.", { x: MX, y: 6.38, w: CW, h: 0.3, fontSize: 10, color: C.text2 });
    s.addNotes("4:00. This is arithmetic, not a forecast: at $10 a month, $100M a year needs 834,000 subscribers, under 1% of US adults aged 25 to 44. The AI costs three hundredths of a cent per task, measured on the real model, so the margin does not depend on it. LTV and CAC we will measure in a pilot.");
  }

  // 9 — evidence
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Business" });
    kicker(s, "EVIDENCE");
    s.addText("Verified today, and still a bet", { placeholder: "title" });
    const h = 4.45, lw = 4.95, mw = 4.4;
    box(s, { x: MX, y: TOP, w: lw, h, fill: { color: C.background1 }, line: { color: C.accent3, width: 1 } });
    tag(s, "FACT", MX + 0.4, TOP + 0.35);
    text(s, "Verified", { x: MX + 0.4, y: TOP + 0.78, w: lw - 0.8, h: 0.4, fontSize: 20, bold: true, color: C.text1 });
    text(s, [
      { text: "123 automated unit tests: money math, CSV import, quotas, assistant guards", options: { bullet: true, breakLine: true } },
      { text: "25 of 25 assistant scenarios pass on the real model (gpt-6-luna), twice in a row", options: { bullet: true, breakLine: true } },
      { text: "Browser walkthroughs on desktop and phone sizes on every pull request", options: { bullet: true, breakLine: true } },
      { text: "Works without the AI: every action also has a form", options: { bullet: true } },
    ], { x: MX + 0.4, y: TOP + 1.35, w: lw - 0.8, h: 2.9, fontSize: 14, color: C.text1, paraSpaceAfter: 9 });

    const mx = MX + lw + 0.3;
    box(s, { x: mx, y: TOP, w: mw, h, fill: { color: C.background2 }, line: { color: C.background2, width: 0 } });
    tag(s, "HYPOTHESIS", mx + 0.4, TOP + 0.35);
    text(s, "Still a bet", { x: mx + 0.4, y: TOP + 0.78, w: mw - 0.8, h: 0.4, fontSize: 20, bold: true, color: C.text1 });
    text(s, [
      { text: "How common this pain is in our US segment", options: { bullet: true, breakLine: true } },
      { text: "Willingness to pay $10 a month", options: { bullet: true, breakLine: true } },
      { text: "Weekly return, and 2 minutes to keep the plan current", options: { bullet: true, breakLine: true } },
      { text: "CSV export as the first step; a bank connection may be needed sooner", options: { bullet: true } },
    ], { x: mx + 0.4, y: TOP + 1.35, w: mw - 0.8, h: 2.9, fontSize: 14, color: C.text1, paraSpaceAfter: 9 });

    const px = mx + mw + 0.45;
    await shot(s, "mobile-overview.png", { x: px, y: TOP, h, radiusPx: 60, alt: "Covered on a phone: $300 available to spend" });
    s.addNotes("4:20. What is proven is the engineering: tests on the money math, all 25 assistant scenarios on the real model including prompt injection, browser walkthroughs on desktop and phone on every change. What is not proven is demand and price. We say so plainly.");
  }

  // 10 — next steps
  {
    const s = pres.addSlide({ masterName: "CONTENT_DARK", sectionTitle: "Business" });
    kicker(s, "NEXT STEP", C.accent3);
    s.addText("Next: prove the pain, then the price", { placeholder: "title" });
    const steps = [
      ["Weeks 1–2", "Talk and compare", "10–15 interviews in the US segment. The same task in Covered and in the alternatives: time, errors, preference."],
      ["Weeks 3–6", "Pilot with payment", "Accounts and sync, four weeks of use, day-7 and day-30 retention, and a real $10 subscription offer."],
      ["After the pilot", "Bank connection", "An official bank data API replaces the CSV step, the main manual effort at the start."],
    ];
    const cw = (CW - 0.6) / 3;
    steps.forEach((st, i) => {
      const x = MX + i * (cw + 0.3);
      box(s, { x, y: TOP, w: cw, h: 2.85, fill: { color: C.background1, transparency: 92 }, line: { color: C.text2, width: 1 } });
      text(s, st[0].toUpperCase(), { x: x + 0.35, y: TOP + 0.3, w: cw - 0.7, h: 0.28, fontSize: 11, bold: true, charSpacing: 1, color: C.accent3 });
      text(s, st[1], { x: x + 0.35, y: TOP + 0.65, w: cw - 0.7, h: 0.4, fontSize: 20, bold: true, color: C.background1 });
      text(s, st[2], { x: x + 0.35, y: TOP + 1.2, w: cw - 0.7, h: 1.45, fontSize: 14, color: C.accent3, lineSpacingMultiple: 1.15 });
    });
    text(s, "Covered: know what’s covered before you spend.", { x: MX, y: 5.2, w: CW, h: 0.5, fontSize: 22, bold: true, color: C.background2, valign: "middle" });
    prodLink(s, MX, 5.9, { color: C.background1, mutedColor: C.accent3, w: 7 });
    s.addNotes("4:35. Next two weeks: 10 to 15 interviews with people in the US segment and a head-to-head task against the alternatives. Then a four-week pilot with a real $10 offer. Then a bank connection instead of CSV. Covered: know what's covered before you spend.");
  }

  await pres.writeFile({ fileName: OUT });
  if (process.env.APPLY_THEME) {
    const { applyTheme } = require(process.env.APPLY_THEME);
    await applyTheme(OUT, THEME);
  }
  console.log("written", OUT, PROD_URL ? `(production URL: ${PROD_URL})` : "(production URL placeholder)");
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
