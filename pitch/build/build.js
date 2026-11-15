// Builds the Covered pitch deck (10 slides, 16:9). Screenshots come from capture.mjs.
//   npm install pptxgenjs sharp react react-dom react-icons      (in the folder you run this from)
//   PROD_URL=https://your-site.vercel.app APPLY_THEME=./apply_theme.js node build.js <screenshots dir> <output.pptx>
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
pres.subject = "Business Cup 2.0, track Money. Covered: a bill planner for working adults in the US. Live: covered-fracture.vercel.app";
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
  ESTIMATE: { fill: C.accent5, color: C.accent6, w: 1.14 },
  SCENARIO: { fill: C.accent5, color: C.accent6, w: 1.14 },
  ASSUMPTION: { fill: C.accent5, color: C.accent6, w: 1.4 },
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
async function shot(slide, file, { crop, pad = 0, x, y, w, h, radiusPx = 36, alt, frame = HEX.accent3 }) {
  let img = sharp(path.join(SHOTS, file));
  if (crop) img = img.extract(crop);
  let raw = await img.png().toBuffer();
  // An element captured edge to edge gets a white margin, so its text does not touch the frame.
  if (pad) raw = await sharp(raw).extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#ffffff" }).png().toBuffer();
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
    text(slide, [{ text: PROD_URL, options: { hyperlink: { url: "https://" + PROD_URL, tooltip: "Open the live product" }, color } }], { x: x + 0.75, y, w: w - 0.75, h: 0.32, fontSize: 13, bold: true, color, valign: "middle" });
  } else {
    slide.addShape(S.roundRect, { x: x + 0.75, y, w: 3.75, h: 0.32, rectRadius: 0.08, fill: { color: C.accent5 }, line: { color: C.accent6, width: 1, dashType: "dash" }, objectName: name("Production URL placeholder") });
    text(slide, "ADD PRODUCTION URL BEFORE SUBMITTING", { x: x + 0.75, y, w: 3.75, h: 0.32, fontSize: 10, bold: true, color: C.accent6, align: "center", valign: "middle" });
  }
  text(slide, "Code", { x, y: y + 0.42, w: 0.7, h: 0.32, fontSize: 13, color: mutedColor, valign: "middle" });
  text(slide, [{ text: REPO, options: { hyperlink: { url: "https://" + REPO, tooltip: "Open the repository" }, color } }], { x: x + 0.75, y: y + 0.42, w: w - 0.75, h: 0.32, fontSize: 13, bold: true, color, valign: "middle" });
}

// ---------------------------------------------------------------- slides
async function build() {
  const FOOT = 10.5; // nothing on a slide is set smaller than this

  // 1 — cover
  pres.addSection({ title: "Problem" });
  {
    const s = pres.addSlide({ masterName: "COVER", sectionTitle: "Problem" });
    s.addImage({ data: await icon(fi.FiCheckCircle, HEX.lt2), x: MX, y: 0.62, w: 0.36, h: 0.36, objectName: "Logo mark" });
    text(s, "Covered", { x: MX + 0.48, y: 0.6, w: 3, h: 0.4, fontSize: 20, bold: true, color: C.background2, valign: "middle" });
    text(s, "Know what’s covered\nbefore you spend", { x: MX, y: 1.75, w: 6.9, h: 1.55, fontSize: 40, bold: true, color: C.background1, objectName: "Title" });
    text(s, "For working adults in the US: how much you can spend until your next paycheck, with your bills and a reserve set aside. No bank login.", {
      x: MX, y: 3.55, w: 6.3, h: 1.4, fontSize: 16, color: C.accent3, lineSpacingMultiple: 1.15,
    });
    prodLink(s, MX, 5.2, { color: C.background1, mutedColor: C.accent3, w: 5.9 });
    text(s, "Open the link and press “Try sample data”: one minute, no sign-up.", { x: MX, y: 6.08, w: 6.3, h: 0.3, fontSize: 12, color: C.accent3 });
    text(s, "Business Cup 2.0  ·  Track: Money  ·  FractureTeam", { x: MX, y: 6.78, w: 6, h: 0.3, fontSize: 11, color: C.accent3 });
    await shot(s, "cover.png", { x: 8.25, y: 0.62, h: 6.26, alt: "Covered: a sample plan with $300 available to spend, and a purchase check that answers $400 is $100 below the $250 reserve while bills and everyday spending stay covered", frame: HEX.dk2 });
    s.addNotes("0:00. Covered answers one question for a working adult in the US: of the money in my account, how much is actually mine to spend? I will show the product live, then what we sell and what we have and have not proven.");
  }

  // 2 — problem
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Problem" });
    kicker(s, "WHO DO WE SELL TO? · THE PROBLEM");
    s.addText("$2,200 in the bank. Only $300 is yours to spend", { placeholder: "title" });
    box(s, { x: MX, y: TOP, w: 5.6, h: 2.95, fill: { color: C.background2 }, line: { color: C.background2, width: 0 } });
    text(s, "Ten days to payday. $2,200 in the account. Rent, insurance and internet have not gone out yet.", {
      x: MX + 0.35, y: TOP + 0.33, w: 4.9, h: 0.85, fontSize: 15, color: C.text2, lineSpacingMultiple: 1.15,
    });
    text(s, "“Can I buy $400 sneakers?”", { x: MX + 0.35, y: TOP + 1.25, w: 4.9, h: 0.6, fontSize: 26, bold: true, color: C.text1, valign: "middle" });
    text(s, "The balance says yes. The honest answer depends on the bills that have not gone out yet.", {
      x: MX + 0.35, y: TOP + 2.0, w: 4.9, h: 0.7, fontSize: 15, color: C.text1, lineSpacingMultiple: 1.15,
    });
    await iconCircle(s, fi.FiUser, MX, 5.3);
    text(s, [
      { text: "Who we build for. ", options: { bold: true } },
      { text: "Working adults in the US, 25–45, paid every two weeks, with bills due between paychecks, who do not want to connect their bank to one more app." },
    ], { x: MX + 0.8, y: 5.27, w: 4.8, h: 1.2, fontSize: 14, color: C.text1, lineSpacingMultiple: 1.15 });

    const x = 6.5, w = W - MX - 6.5;
    box(s, { x, y: TOP, w, h: 4.65, fill: { color: C.background1 }, line: { color: C.accent3, width: 1 } });
    tag(s, "FACT", x + 0.4, TOP + 0.28);
    text(s, "The segment, in public data", { x: x + 0.4 + 0.72 + 0.15, y: TOP + 0.28, w: w - 1.7, h: 0.28, fontSize: 13, bold: true, color: C.text1, valign: "middle" });
    const facts = [
      ["63%", "of Americans live paycheck to paycheck; 90% of them have under $500 left each month", "CNBC | SurveyMonkey Quarterly Money Survey, July 2026"],
      ["43%", "of US private establishments pay every two weeks: the most common pay schedule", "BLS, Length of pay periods in the Current Employment Statistics survey, February 2023"],
      ["24%", "of consumers are uncomfortable sharing bank credentials with third-party apps", "PYMNTS and MX, Convenience Versus Security, 2021 (2,368 consumers)"],
    ];
    facts.forEach((f, i) => {
      const y = TOP + 0.8 + i * 1.27;
      if (i > 0) s.addShape(S.line, { x: x + 0.4, y: y - 0.12, w: w - 0.8, h: 0, line: { color: C.accent3, width: 1 }, objectName: name("Divider") });
      text(s, f[0], { x: x + 0.4, y, w: 2.0, h: 1.0, fontSize: 34, bold: true, color: C.text1, valign: "middle" });
      text(s, f[1], { x: x + 2.15, y, w: w - 2.5, h: 0.56, fontSize: 12.5, color: C.text1, lineSpacingMultiple: 1.08 });
      text(s, f[2], { x: x + 2.15, y: y + 0.6, w: w - 2.5, h: 0.4, fontSize: FOOT, color: C.text2 });
    });
    s.addNotes("0:20. The person: paid every two weeks, with rent, insurance, internet and a phone bill landing between paychecks. The balance looks fine, but part of it is already promised. Three public numbers: 63% of Americans live paycheck to paycheck; every two weeks is the most common pay schedule, 43% of private establishments; and a quarter of consumers are uncomfortable handing their bank login to an app. So we start with people paid every two weeks who do not want to connect a bank. We have not interviewed this segment yet; that is the first step after today.");
  }

  // 3 — product
  pres.addSection({ title: "Product" });
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Product" });
    kicker(s, "DOES IT WORK? · THE PRODUCT");
    s.addText("Set up once. Confirm. See what is yours", { placeholder: "title" });
    const steps = [
      ["Set up once", "Upload your bank’s CSV (read in your browser), answer five questions in your own words, or type the numbers in."],
      ["Confirm each number and bill", "Edit, dismiss or add. Nothing enters the plan until you confirm it."],
      ["See what you can spend until payday", "After bills, everyday spending and your reserve."],
    ];
    steps.forEach((st, i) => {
      const y = TOP + 0.05 + i * 1.08;
      numberCircle(s, i + 1, MX, y);
      text(s, st[0], { x: MX + 0.8, y: y - 0.02, w: 4.6, h: 0.35, fontSize: 18, bold: true, color: C.text1 });
      text(s, st[1], { x: MX + 0.8, y: y + 0.38, w: 4.6, h: 0.55, fontSize: 13, color: C.text2, lineSpacingMultiple: 1.1 });
    });
    box(s, { x: MX, y: 5.25, w: 5.2, h: 1.1, fill: { color: C.background2 }, line: { color: C.background2, width: 0 } });
    text(s, "$2,200 − $1,300 − $350 − $250 = $300", { x: MX + 0.3, y: 5.4, w: 4.6, h: 0.4, fontSize: 17, bold: true, color: C.text1, valign: "middle" });
    text(s, "balance − bills − everyday spending − reserve = available", { x: MX + 0.3, y: 5.85, w: 4.6, h: 0.3, fontSize: 11, color: C.text2, valign: "middle" });
    await shot(s, "plan.png", { x: 6.2, y: TOP + 0.1, w: W - MX - 6.2, radiusPx: 28, alt: "Covered overview: $300 available to spend, $1,300 of upcoming bills, $350 of everyday spending, three bills coming up and a purchase check" });
    s.addNotes("0:45 — switch to the live product here. Three ways in: a bank CSV, five questions answered in plain words, or the numbers typed by hand; whichever you pick, you confirm every bill before the plan exists. For the demo: Try sample data, continue to setup, confirm the bills (point at the savings transfer it flagged), build the plan. $2,200 in the account, $300 actually free. The decision this gives me: how much I can spend until payday without touching rent, groceries or the reserve.");
  }

  // 4 — in the product
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Product" });
    kicker(s, "DOES IT WORK? · IN THE LIVE PRODUCT");
    s.addText("Ask first. Nothing changes until you confirm", { placeholder: "title" });
    const imgY = TOP + 0.4;
    text(s, "1   Check a purchase", { x: MX, y: TOP - 0.02, w: 3, h: 0.3, fontSize: 14, bold: true, color: C.text1 });
    const a = await shot(s, "purchase.png", { pad: 24, x: MX, y: imgY, w: 3.3, radiusPx: 24, alt: "Assistant answer: a $400 purchase leaves you $100 below your $250 reserve; bills and everyday spending are still covered" });
    text(s, "Real screens from the live product, with its sample data.", { x: MX, y: imgY + a.h + 0.2, w: 3.3, h: 0.45, fontSize: 11, color: C.text2 });
    const bx = MX + a.w + 0.4;
    text(s, "2   Change a bill", { x: bx, y: TOP - 0.02, w: 3, h: 0.3, fontSize: 14, bold: true, color: C.text1 });
    const b = await shot(s, "proposal.png", { pad: 24, x: bx, y: imgY, w: 2.63, radiusPx: 24, alt: "Assistant draft: car insurance from $150 to $180, available from $300 to $270, with a Confirm change button" });
    const tx = bx + b.w + 0.5, tw = W - MX - tx;
    const points = [
      ["It names what the purchase touches", "$100 below your reserve, while bills and everyday spending stay covered. Not just a yes or a no."],
      ["Before and after, then you confirm", "A bill change shows before and after side by side. The plan moves only when you press Confirm."],
    ];
    points.forEach((p, i) => {
      const y = imgY + i * 1.5;
      text(s, p[0], { x: tx, y, w: tw, h: 0.35, fontSize: 16, bold: true, color: C.text1 });
      text(s, p[1], { x: tx, y: y + 0.4, w: tw, h: 0.8, fontSize: 14, color: C.text2, lineSpacingMultiple: 1.15 });
    });
    if (PROD_URL) {
      box(s, { x: tx, y: 6.02, w: tw, h: 0.6, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.background2, width: 0 } });
      text(s, [
        { text: "Try it, no sign-up:  ", options: { color: C.text2 } },
        { text: PROD_URL, options: { bold: true, color: C.text1, hyperlink: { url: "https://" + PROD_URL, tooltip: "Open the live product" } } },
      ], { x: tx + 0.25, y: 6.02, w: tw - 0.5, h: 0.6, fontSize: 13, valign: "middle" });
    }
    s.addNotes("1:25, still live, one story. A purchase: can I afford $400 this weekend? The answer is precise: $100 below the reserve, bills still covered. So I can buy it and dip into the reserve, spend $300 instead, or wait for payday. A late paycheck: three days late is covered with $35 of the reserve, and I see which payments land before the money, so I decide what to move before it happens. A change: my car insurance went up by $30. A draft with before and after appears; press Confirm, the plan moves from $300 to $270. A bill is paid: rent goes out, I update the balance to $950 and tick rent: still $270, nothing counted twice, so I keep spending as planned. Backup: recorded video.");
  }

  // 5 — how it works
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Product" });
    kicker(s, "DOES IT WORK? · OUR OWN AI");
    s.addText("Our own model listens. Code does the math", { placeholder: "title" });
    const flow = [
      ["You", "Ask in plain English, or by voice"],
      ["Covered model", "Ours. Works out what you asked"],
      ["Tested code", "Computes every dollar"],
      ["You", "Confirm before anything changes"],
    ];
    const fw = 2.62, gap = (CW - 4 * fw) / 3;
    for (let i = 0; i < flow.length; i++) {
      const x = MX + i * (fw + gap);
      const dark = i === 2;
      box(s, { x, y: TOP, w: fw, h: 1.2, fill: { color: dark ? C.text1 : C.background2 }, line: { color: dark ? C.text1 : C.background2, width: 0 } });
      text(s, flow[i][0], { x: x + 0.25, y: TOP + 0.2, w: fw - 0.5, h: 0.28, fontSize: 11, bold: true, charSpacing: 1, color: dark ? C.accent3 : C.text2 });
      text(s, flow[i][1], { x: x + 0.25, y: TOP + 0.55, w: fw - 0.5, h: 0.5, fontSize: 15, bold: true, color: dark ? C.background1 : C.text1 });
      if (i < flow.length - 1) s.addImage({ data: await icon(fi.FiArrowRight, HEX.dk2), x: x + fw + (gap - 0.3) / 2, y: TOP + 0.45, w: 0.3, h: 0.3, objectName: name("Arrow") });
    }
    const cards = [
      [fi.FiCpu, "Our own model", "A small model we trained ourselves: about 2 ms and $0 per question. covered-nlu-1, 254K parameters, 7,672 synthetic examples."],
      [fi.FiDollarSign, "Amounts are checked", "A dollar figure in any model’s text that does not match a computed value is replaced before you see it."],
      [fi.FiShield, "We store no financial data", "Your plan lives in your browser. A change applies only after you press Confirm."],
    ];
    const cw = (CW - 0.6) / 3;
    for (let i = 0; i < cards.length; i++) {
      const x = MX + i * (cw + 0.3), y = TOP + 1.6;
      box(s, { x, y, w: cw, h: 2.3, fill: { color: C.background1 }, line: { color: C.accent3, width: 1 } });
      await iconCircle(s, cards[i][0], x + 0.3, y + 0.3);
      text(s, cards[i][1], { x: x + 1.02, y: y + 0.3, w: cw - 1.3, h: 0.56, fontSize: 16, bold: true, color: C.text1, valign: "middle" });
      text(s, cards[i][2], { x: x + 0.3, y: y + 1.05, w: cw - 0.6, h: 1.1, fontSize: 14, color: C.text2, lineSpacingMultiple: 1.15 });
    }
    text(s, [
      { text: "Unsure? ", options: { bold: true, color: C.text1 } },
      { text: "When our model is under 50% sure, OpenAI answers instead, and the app says which model replied. In private mode our model runs on your device and nothing is sent." },
    ], { x: MX, y: 6.08, w: CW, h: 0.65, fontSize: 12, color: C.text2, lineSpacingMultiple: 1.12 });
    s.addNotes("2:15. Covered has its own AI. We trained a small model, covered-nlu-1, 254 thousand parameters, on 7,672 examples we generated ourselves. It runs inside our own server: about two milliseconds, zero cost, no data sent to anyone. It understands the request and picks one of four functions; it also recognises bill types, which is how 'rent' finds 'Oakwood Apartments' and how it spots subscriptions. When it is less than 50% sure, OpenAI answers instead, and the app says which model replied. In both cases the money is computed by tested code and nothing is saved until you press Confirm.");
  }

  // 6 — alternatives
  pres.addSection({ title: "Difference" });
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Difference" });
    kicker(s, "IS IT NEW? · ALTERNATIVES");
    s.addText("Others show what’s left. We show what breaks", { placeholder: "title" });
    const cols = [MX + 0.3, 3.2, 8.05];
    const widths = [2.4, 4.55, 4.4];
    text(s, "Today’s option", { x: cols[0], y: TOP, w: widths[0], h: 0.3, fontSize: 12, bold: true, color: C.text2, valign: "middle" });
    text(s, "What it already does", { x: cols[1], y: TOP, w: 2.1, h: 0.3, fontSize: 12, bold: true, color: C.text2, valign: "middle" });
    tag(s, "FACT", cols[1] + 2.0, TOP + 0.01);
    text(s, "What Covered does", { x: cols[2], y: TOP, w: 3, h: 0.3, fontSize: 12, bold: true, color: C.text2, valign: "middle" });
    const rows = [
      ["YNAB", "$14.99 a month", "Auto-Assign spreads money across targets and scheduled transactions", "No account and no bank login: a plan from a CSV, five questions or by hand"],
      ["PocketGuard", "$12.99 a month", "“Leftover” shows what remains after bills, goals and debt", "Names what a purchase breaks: your reserve, everyday spending or a bill"],
      ["Monarch", "$14.99 a month", "AI assistant, explanations and a weekly review", "AI never invents a number: tested code computes every dollar"],
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
    text(s, "Features: YNAB, PocketGuard and Monarch help pages. Prices: list prices reported in November 2026 (PocketGuard from its own site; YNAB and Monarch from review sites).", { x: MX, y: 5.95, w: CW, h: 0.3, fontSize: FOOT, color: C.text2 });
    s.addNotes("2:45. Now the alternatives. These tools are good and they already compute a leftover. People still quit them because of upkeep. What is new here: no account to start, the plan is built in the browser, and the answer to 'can I afford it' names what breaks: the reserve, everyday spending or a bill. Whether that is faster and clearer than the alternatives is what we test on the same task after the hackathon.");
  }

  // 7 — only in Covered
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Difference" });
    kicker(s, "IS IT NEW? · ONLY IN COVERED");
    s.addText("Three things only Covered does", { placeholder: "title" });
    const cols = [
      { file: "private.png", crop: { left: 0, top: 0, width: 764, height: 372 }, pad: 20, title: "AI that stays on your device", body: "Our own model runs in the browser. Nothing is sent, and it works offline.", alt: "Private mode: the assistant answers a purchase check on the device; the caption says nothing was sent" },
      { file: "late-pay.png", crop: { left: 20, top: 436, width: 492, height: 640 }, pad: 0, title: "What if payday is late?", body: "Which bills land before a late paycheck, and how many days the plan holds.", alt: "Stress test, a week late: three bills land first and $227.74 of the reserve is used" },
      { file: "lower-bill.png", crop: { left: 0, top: 868, width: 848, height: 500 }, pad: 20, title: "Lower a bill yourself", body: "What to say, with your own numbers, and a due date moved past payday.", alt: "Lower a bill: a script to read to the insurer, with a copy button" },
    ];
    const cw = (CW - 0.6) / 3, zone = 2.5, maxW = cw - 0.5;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i], x = MX + i * (cw + 0.3);
      box(s, { x, y: TOP, w: cw, h: 4.05, fill: { color: C.background2 }, line: { color: C.background2, width: 0 } });
      const ratio = (c.crop.width + 2 * c.pad) / (c.crop.height + 2 * c.pad);
      const iw = Math.min(maxW, zone * ratio), ih = iw / ratio;
      await shot(s, c.file, { crop: c.crop, pad: c.pad, x: x + (cw - iw) / 2, y: TOP + 0.25 + (zone - ih) / 2, w: iw, radiusPx: 22, alt: c.alt });
      text(s, c.title, { x: x + 0.3, y: TOP + 2.95, w: cw - 0.6, h: 0.35, fontSize: 16, bold: true, color: C.text1 });
      text(s, c.body, { x: x + 0.3, y: TOP + 3.33, w: cw - 0.6, h: 0.6, fontSize: 12, color: C.text2, lineSpacingMultiple: 1.1 });
    }
    tag(s, "FACT", MX, 6.24);
    text(s, "Rocket Money keeps 35–60% of the first year’s savings when it negotiates a bill. With Covered you keep all of it.", { x: MX + 0.85, y: 6.2, w: CW - 0.85, h: 0.36, fontSize: 13, bold: true, color: C.accent1, valign: "middle" });
    text(s, "Source: Rocket Money help center, “Bill Negotiation savings process”, November 2026.", { x: MX, y: 6.58, w: CW, h: 0.27, fontSize: FOOT, color: C.text2 });
    s.addNotes("3:05, back in the product. Three things only Covered does. One: private mode. Switch it on, turn off Wi-Fi, ask again: our own model answers inside the browser and the app says nothing was sent. Two: what if payday is late. A week late, three bills land first and you would use part of your reserve; the card says how many days the plan holds. Three: Lower it. A script with your own numbers and a due date moved past payday. Rocket Money keeps 35 to 60% of the first year's savings for that; here you keep all of it.");
  }

  // 8 — what we sell
  pres.addSection({ title: "Business" });
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Business" });
    kicker(s, "WHAT DO WE SELL?");
    s.addText("Free to get your number. $10 a month to keep it right", { placeholder: "title" });
    // Two tiers, split by the user's job rather than by the number of AI questions.
    const tw = 2.85, th = 3.3;
    const tiers = [
      { x: MX, dark: false, label: "FREE", title: "Get your number", sub: "No card, no sign-up", items: ["Build the first plan", "See what you can spend until payday", "Check a purchase before you make it", "Update your balance until payday"] },
      { x: MX + tw + 0.2, dark: true, label: "COVERED PLUS", title: "Keep it right", sub: "$10 a month, being tested", items: ["Carry the plan from paycheck to paycheck", "See what changed, and why", "Save and compare what-ifs", "A payday reminder and recap"] },
    ];
    for (const t of tiers) {
      box(s, { x: t.x, y: TOP, w: tw, h: th, fill: { color: t.dark ? C.text1 : C.background2 }, line: { color: t.dark ? C.text1 : C.background2, width: 0 } });
      text(s, t.label, { x: t.x + 0.25, y: TOP + 0.24, w: tw - 0.5, h: 0.26, fontSize: 10.5, bold: true, charSpacing: 1, color: t.dark ? C.accent3 : C.accent2 });
      text(s, t.title, { x: t.x + 0.25, y: TOP + 0.56, w: tw - 0.5, h: 0.4, fontSize: 19, bold: true, color: t.dark ? C.background1 : C.text1 });
      text(s, t.sub, { x: t.x + 0.25, y: TOP + 0.98, w: tw - 0.5, h: 0.26, fontSize: 11, color: t.dark ? C.accent3 : C.text2 });
      text(s, t.items.map((v, k) => ({ text: v, options: { bullet: true, breakLine: k < t.items.length - 1 } })), { x: t.x + 0.25, y: TOP + 1.4, w: tw - 0.5, h: th - 1.5, fontSize: 12, color: t.dark ? C.background1 : C.text1, paraSpaceAfter: 4 });
    }
    const ix = MX + 2 * tw + 0.5, iw = W - MX - ix;
    // The panel down to its last saved row, at the height of the tier cards.
    const crop = { left: 0, top: 0, width: 1364, height: 816 };
    const picW = Math.min(iw, th * (crop.width / crop.height));
    await shot(s, "whatifs.png", { crop, x: ix + (iw - picW) / 2, y: TOP, w: picW, radiusPx: 26, alt: "Your what-ifs in the product: the plan today leaves $300; $400 sneakers leave you $100 below the reserve; a paycheck a week late uses the reserve; a $120 vet bill is covered" });

    // The way back in: a few fields, not a new import.
    const ly = TOP + th + 0.22, lh = 0.6;
    const loop = ["Open the reminder", "Enter your balance", "Tick what was paid", "See the new number"];
    text(s, "Coming back on payday", { x: MX, y: ly, w: 2.1, h: lh, fontSize: 14, bold: true, color: C.text1, valign: "middle" });
    const lx = MX + 2.2, lw = 2.15, gap = 0.42;
    for (let i = 0; i < loop.length; i++) {
      const x = lx + i * (lw + gap);
      box(s, { x, y: ly, w: lw, h: lh, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.background2, width: 0 } });
      text(s, loop[i], { x: x + 0.1, y: ly, w: lw - 0.2, h: lh, fontSize: 13, bold: true, color: C.text1, align: "center", valign: "middle" });
      if (i < loop.length - 1) s.addImage({ data: await icon(fi.FiArrowRight, HEX.dk2), x: x + lw + (gap - 0.26) / 2, y: ly + (lh - 0.26) / 2, w: 0.26, h: 0.26, objectName: name("Arrow") });
    }
    text(s, [
      { text: "Nothing is imported again. Measured: 1 field, 3 ticks, 2 clicks, and 0.2 s of the product's own time. Not measured yet: how long people take. " },
      { text: "How we test the price. ", options: { bold: true, color: C.text1 } },
      { text: "Carrying the plan over, or saving a what-if, shows the Plus offer, and we count who takes it. A click is interest; the proof is a real purchase in a paid pilot. Payment is not connected yet." },
    ], { x: MX, y: ly + lh + 0.14, w: CW, h: 0.5, fontSize: 11.5, color: C.text2, lineSpacingMultiple: 1.1 });
    s.addNotes("3:35. What we sell is the recurring job, not AI questions. Getting your number is free: the first plan, what you can spend until payday, a purchase check, the math explained on your device. Plus is keeping it right: the plan carries over from paycheck to paycheck, you see what changed and why, your what-ifs are saved and compared, and a reminder brings you back. Coming back is four steps and no new import. We measured it in the product: one field, three ticks and two clicks, and the product itself answers in a fifth of a second. How long a person takes we have not measured yet. Ten dollars a month is the price we are testing: the offer is live and counted, but a click is only interest. The proof is a real purchase in a paid pilot.");
  }

  // 9 — business potential
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Business" });
    kicker(s, "WHY DOES IT MAKE MONEY?");
    s.addText("$100M ARR is 834,000 subscribers at $10 a month", { placeholder: "title" });

    // scale strip
    box(s, { x: MX, y: TOP, w: CW, h: 0.8, fill: { color: C.text1 }, line: { color: C.text1, width: 0 } });
    text(s, [
      { text: "834,000", options: { bold: true, color: C.background1 } },
      { text: "  subscribers × $10 × 12 = ", options: { color: C.accent3 } },
      { text: "$100M a year", options: { bold: true, color: C.background1 } },
    ], { x: MX + 0.4, y: TOP, w: 6.6, h: 0.8, fontSize: 20, valign: "middle" });
    text(s, "About 0.9% of ~89 million US adults aged 25–44, the closest Census band to our 25–45 (2024).", { x: MX + 7.1, y: TOP, w: CW - 7.5, h: 0.8, fontSize: 12, color: C.accent3, valign: "middle", lineSpacingMultiple: 1.1 });

    // LTV scenarios
    const y1 = TOP + 1.0;
    const tw = tag(s, "SCENARIO", MX, y1);
    text(s, "LTV: what one subscriber pays us, $9.38 a month × months they stay. CAC: the cost to win one; keep it under LTV ÷ 3.", { x: MX + tw + 0.15, y: y1, w: CW - tw - 0.15, h: 0.28, fontSize: 13, bold: true, color: C.text1, valign: "middle" });
    const sc = [["4 months  ·  base scenario", "$38", "$13"], ["6 months", "$56", "$19"], ["12 months", "$113", "$38"]];
    const cw = (CW - 0.6) / 3, y2 = y1 + 0.42, ch = 1.3;
    sc.forEach((c, i) => {
      const x = MX + i * (cw + 0.3), base = i === 0;
      box(s, { x, y: y2, w: cw, h: ch, fill: { color: base ? C.accent4 : C.background2 }, line: { color: base ? C.accent2 : C.background2, width: base ? 1 : 0 } });
      text(s, "stays " + c[0], { x: x + 0.35, y: y2 + 0.13, w: cw - 0.7, h: 0.26, fontSize: 12, bold: base, color: base ? C.accent1 : C.text2 });
      text(s, [
        { text: "LTV " + c[1], options: { fontSize: 28, bold: true, color: C.text1 } },
      ], { x: x + 0.35, y: y2 + 0.38, w: cw - 0.7, h: 0.5, valign: "middle" });
      text(s, [
        { text: "winning one must cost under ", options: { color: C.text2 } },
        { text: c[2], options: { bold: true, color: C.accent1 } },
      ], { x: x + 0.35, y: y2 + 0.9, w: cw - 0.7, h: 0.3, fontSize: 13, valign: "middle" });
    });

    // facts behind the estimate
    const y3 = y2 + ch + 0.18, h3 = 1.26, lw = (CW - 0.3) / 2;
    box(s, { x: MX, y: y3, w: lw, h: h3, fill: { color: C.background1 }, line: { color: C.accent3, width: 1 } });
    tag(s, "FACT", MX + 0.3, y3 + 0.18);
    text(s, "We keep about $9.38 of every $10", { x: MX + 1.15, y: y3 + 0.18, w: lw - 1.4, h: 0.28, fontSize: 13, bold: true, color: C.text1, valign: "middle" });
    text(s, "Card fee $0.59 (Stripe 2.9% + 30¢). AI: $0 when our model answers, about 3¢ for 100 questions on OpenAI, at most 54¢ at the 60-a-day cap.", { x: MX + 0.3, y: y3 + 0.55, w: lw - 0.6, h: 0.65, fontSize: 11, color: C.text2, lineSpacingMultiple: 1.1 });
    const rx = MX + lw + 0.3;
    box(s, { x: rx, y: y3, w: lw, h: h3, fill: { color: C.background1 }, line: { color: C.accent3, width: 1 } });
    tag(s, "ASSUMPTION", rx + 0.3, y3 + 0.18);
    text(s, "About 4 paid months per subscriber", { x: rx + 1.83, y: y3 + 0.18, w: lw - 2.08, h: 0.28, fontSize: 13, bold: true, color: C.text1, valign: "middle" });
    text(s, "54–57% renew after month one (RevenueCat, 2026). We assume 82% a month after that: 1 + 0.55 ÷ 0.18 ≈ 4 months.", { x: rx + 0.3, y: y3 + 0.55, w: lw - 0.6, h: 0.65, fontSize: 11, color: C.text2, lineSpacingMultiple: 1.1 });

    text(s, "These are scenarios with assumptions, not forecasts: nobody has paid yet. A CAC under $13 rules out paid ads at first, so the first channel is the free, no-sign-up purchase check. The pilot measures CAC and months retained.", { x: MX, y: 6.36, w: CW, h: 0.45, fontSize: 11, color: C.text2, lineSpacingMultiple: 1.1 });
    s.addNotes("4:00. Scale first: at $10 a month, $100M a year is 834,000 subscribers, under 1% of US adults aged 25 to 44. Unit economics: after the card fee and the AI, we keep about $9.38 a month; the AI is about three cents, measured. So LTV is decided by how long people stay, and the benchmark is hard: only 54 to 57% of monthly subscribers in comparable app categories renew after the first month. These are scenarios with assumptions, not forecasts: nobody has paid yet. The base scenario assumes 82% a month after that, about four paid months: LTV $38, so a subscriber must cost under $13 to acquire. That rules out paid ads at first, which is why the entry point is the free purchase check, with no sign-up. The pilot measures CAC and months retained.");
  }

  // 10 — evidence and next steps (the case allows ten slides)
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Business" });
    kicker(s, "EVIDENCE · NEXT STEP");
    s.addText("Proven today. Tested next", { placeholder: "title" });
    const h = 3.75, cw = (CW - 0.6) / 3;
    const cols = [
      {
        label: "FACT", title: "Proven today", dark: false, fill: C.background1, line: C.accent3,
        items: [
          "Live in production, no sign-up needed",
          "Our own model alone: 24 of 25 test questions, 77% on new wordings",
          "With OpenAI as backup: 25 of 25 test questions, 34 of 34 setup answers",
          "202 automated tests on the money math, import and AI guards",
        ],
      },
      {
        label: "NOT PROVEN YET · WEEKS 1–2", title: "The pain and the habit", dark: false, fill: C.background2, line: C.background2,
        items: [
          "10–15 interviews with people paid every two weeks",
          "The payday update, timed with people, not only by a script",
          "A pass: they describe this moment unprompted, and come back after their next paycheck",
        ],
      },
      {
        label: "NOT PROVEN YET · WEEKS 3–6", title: "The price", dark: true, fill: C.text1, line: C.text1,
        items: [
          "A paid pilot: a real $10 charge, not a click",
          "Day-7 and day-30 return; the base scenario needs 4 paid months",
          "If the free purchase check is enough for people, we change the model",
          "A bank connection only after that: it changes the privacy promise",
        ],
      },
    ];
    cols.forEach((c, i) => {
      const x = MX + i * (cw + 0.3);
      box(s, { x, y: TOP, w: cw, h, fill: { color: c.fill }, line: { color: c.line, width: c.dark ? 0 : 1 } });
      if (c.label === "FACT") tag(s, "FACT", x + 0.35, TOP + 0.3);
      else text(s, c.label, { x: x + 0.35, y: TOP + 0.32, w: cw - 0.7, h: 0.28, fontSize: 11, bold: true, charSpacing: 1.5, color: c.dark ? C.accent3 : C.accent2 });
      text(s, c.title, { x: x + 0.35, y: TOP + 0.72, w: cw - 0.7, h: 0.4, fontSize: 20, bold: true, color: c.dark ? C.background1 : C.text1 });
      text(s, c.items.map((t, k) => ({ text: t, options: { bullet: true, breakLine: k < c.items.length - 1 } })), { x: x + 0.35, y: TOP + 1.25, w: cw - 0.7, h: h - 1.4, fontSize: 12.5, color: c.dark ? C.background2 : C.text1, paraSpaceAfter: 6 });
    });
    text(s, "$2,200 in the bank. $300 is yours. The $400 sneakers? $100 below your reserve.", { x: MX, y: TOP + h + 0.1, w: 6.6, h: 0.68, fontSize: 16, bold: true, color: C.text1, valign: "middle" });
    text(s, [
      { text: "Proof for every number: ", options: { color: C.text2 } },
      { text: "docs/evidence.md", options: { bold: true, color: C.text1, hyperlink: { url: "https://" + REPO + "/blob/main/docs/evidence.md", tooltip: "Every claim in this deck, with how to check it" } } },
      { text: " in the repo", options: { color: C.text2 } },
    ], { x: MX, y: TOP + h + 0.8, w: 6.6, h: 0.3, fontSize: 12.5, valign: "middle" });
    prodLink(s, MX + 6.9, TOP + h + 0.1, { color: C.text1, mutedColor: C.text2, w: CW - 6.9 });
    s.addNotes("4:25. What is proven is the engineering: the product is live, our own model passes 24 of 25 test questions by itself and 77% on wordings it has never seen; with OpenAI as backup all 25 pass, including prompt injection. Tests cover the money math, and browser walkthroughs run on desktop and phone on every change. What is not proven is demand, the habit and the price, and we know how we test each. First two weeks: 10 to 15 interviews with people paid every two weeks, and the payday update timed with them, because so far only a script has timed it. Then a paid pilot with a real ten-dollar charge, because a click on an offer is not a purchase. If the free purchase check turns out to be enough for people, we change the model. Covered: $2,200 in the bank, $300 is yours.");
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
