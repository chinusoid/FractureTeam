import { useApp } from "./context";
import { BRAND } from "./brand";
import { Button, downloadText, Gauge } from "./UI";
import { Icon } from "./Icon";
import { useState } from "react";
import { generateSampleCsv, money } from "@/lib/client/model";
import { HERO_PRESETS, checkHeroPurchase, heroPlanSummary, parseHeroAmount } from "@/lib/demo/heroPlan";

const PLAN = heroPlanSummary();
/** The plan as one line of arithmetic: sign, amount, what it is. */
const MATH_TERMS: [string, number, string][] = [
  ["", PLAN.balanceCents, "in your bank account"],
  ["−", PLAN.billsCents, "bills due before payday"],
  ["−", PLAN.everydayCents, "everyday spending"],
  ["−", PLAN.reserveCents, "your reserve"],
  ["=", PLAN.availableCents, "yours to spend"],
];

/** "Can I afford it?" on the sample plan above: computed in the page, nothing stored or sent. */
function HeroCheck({ tryOwn }: { tryOwn: () => void }) {
  const [amountCents, setAmountCents] = useState<number | null>(HERO_PRESETS[1].amountCents),
    [typed, setTyped] = useState("");
  const result = checkHeroPurchase(amountCents);
  return (
    <div className="hero-check">
      <div className="hero-check-head">
        <strong id="hero-check-title">Can I afford it?</strong>
        <span className="small muted">Ask the sample plan</span>
      </div>
      <div className="hero-check-presets" role="group" aria-labelledby="hero-check-title">
        {HERO_PRESETS.map((p) => (
          <button
            type="button"
            key={p.label}
            className={`hero-chip ${!typed && amountCents === p.amountCents ? "active" : ""}`}
            aria-pressed={!typed && amountCents === p.amountCents}
            onClick={() => {
              setTyped("");
              setAmountCents(p.amountCents);
            }}
          >
            {p.label}
          </button>
        ))}
        <form
          className="hero-check-form"
          onSubmit={(e) => {
            e.preventDefault();
            setAmountCents(parseHeroAmount(typed));
          }}
        >
          <label className="sr-only" htmlFor="hero-check-amount">
            Another purchase amount in dollars
          </label>
          <div className="money-input">
            <span>$</span>
            <input
              id="hero-check-amount"
              inputMode="decimal"
              autoComplete="off"
              maxLength={14}
              placeholder="Other"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setAmountCents(parseHeroAmount(e.target.value));
              }}
            />
          </div>
        </form>
      </div>
      <div
        className={`hero-check-answer ${result.ok ? result.status : "invalid"}`}
        role="status"
        aria-live="polite"
        data-testid="hero-check-answer"
      >
        {result.ok && (
          <span className="pill">
            <span className="status-dot" />
            {result.label}
          </span>
        )}
        <p>
          {result.ok && <strong>{money(result.amountCents)}: </strong>}
          {result.message}
        </p>
      </div>
      <button type="button" className="text-button" onClick={tryOwn}>
        Try it on your own numbers
        <Icon name="arrow" size={13} />
      </button>
    </div>
  );
}

export function Landing() {
  const { sample, navigate } = useApp();
  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="hero-copy">
          <span className="intro-label">
            <span className="status-dot" />
            For people paid on a schedule, with bills due in between
          </span>
          <h1>
            Know what’s covered
            <br />
            before you spend.
          </h1>
          <p>
            {BRAND.name} turns your bank balance into one honest number: what
            is left after your bills, everyday spending and a reserve. Then
            ask it about any purchase.
          </p>
          <div className="hero-actions">
            <Button onClick={() => sample("A")}>
              Try sample data
              <Icon name="arrow" size={17} />
            </Button>
            <Button
              kind="secondary"
              icon="upload"
              onClick={() => navigate("/setup/import")}
            >
              Import transactions
            </Button>
          </div>
          <span className="hero-footnote">
            <Icon name="shield" size={14} />
            No sign-up. No bank connection. Just clarity.
          </span>
          <span className="hero-by-hand">
            No file?
            <button className="text-button" onClick={() => navigate("/setup/interview")}>
              Answer five questions
            </button>
            or
            <button className="text-button" onClick={() => navigate("/setup/plan")}>
              enter your numbers by hand
            </button>
          </span>
        </div>
        <div className="hero-side">
        <div className="hero-preview">
          <div className="preview-top">
            <span>
              <span className="status-dot" />
              Your plan is covered
            </span>
            <span className="pill">Sample plan</span>
          </div>
          <div className="hero-preview-amount">
            <span>Available to spend</span>
            <strong>
              {money(PLAN.availableCents)}<span>.00</span>
            </strong>
            <p>After the things that matter.</p>
          </div>
          <div className="preview-gauge">
            <Gauge percent={PLAN.allocatedPercent} />
            <div>
              <strong>{money(PLAN.balanceCents)}</strong>
              <span>Starting balance</span>
            </div>
          </div>
          <div className="preview-breakdown">
            <div>
              <span>
                <Icon name="bill" size={15} />
                Upcoming bills
              </span>
              <strong>{money(PLAN.billsCents)}</strong>
            </div>
            <div>
              <span>
                <Icon name="bag" size={15} />
                Everyday spending
              </span>
              <strong>{money(PLAN.everydayCents)}</strong>
            </div>
            <div>
              <span>
                <Icon name="shield" size={15} />A little breathing room
              </span>
              <strong>{money(PLAN.reserveCents)}</strong>
            </div>
          </div>
        </div>
        <HeroCheck tryOwn={() => sample("A")} />
        </div>
      </section>
      <section className="landing-math" id="how-it-works" aria-labelledby="math-title">
        <h2 id="math-title">One number, and where it comes from.</h2>
        <p className="sr-only">
          {money(PLAN.balanceCents)} in your bank account, minus {money(PLAN.billsCents)} in bills
          due before payday, minus {money(PLAN.everydayCents)} for everyday spending, minus{" "}
          {money(PLAN.reserveCents)} kept in reserve, leaves {money(PLAN.availableCents)} to spend.
        </p>
        <div className="math-line" aria-hidden="true">
          {MATH_TERMS.map(([sign, cents, label]) => (
            <div key={label} className={`math-term ${sign === "=" ? "result" : ""}`}>
              <span className="math-sign">{sign}</span>
              <strong>{money(cents)}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <p>
          Tested code does this arithmetic on the bills you confirm. The
          assistant explains the plan and drafts changes; it never does the math.
        </p>
      </section>
      <section className="landing-features">
        {[
          [
            "bill",
            "See what’s spoken for.",
            "Bring a CSV. Review the recurring bills we find, and add anything we missed.",
          ],
          [
            "bag",
            "Give your ‘what if’ an answer.",
            "Check a purchase and see how it affects your plan before spending a dollar.",
          ],
          [
            "refresh",
            "Keep up with real life.",
            "Update your balance, check off paid bills, and see what’s changed. A calendar reminder brings you back on payday.",
          ],
          [
            "shield",
            "AI that stays on your device.",
            "Private mode runs our own Covered model in your browser. Nothing is sent, and it keeps working offline.",
          ],
          [
            "clock",
            "Ready for a late paycheck.",
            "See which bills would land before a delayed payday, and how many days your plan can take.",
          ],
          [
            "down",
            "Lower a bill yourself.",
            "What to try and what to say for each bill, with your own numbers. No middleman takes a cut.",
          ],
        ].map(([icon, title, text]) => (
          <article key={title}>
            <span className="feature-icon">
              <Icon name={icon} size={23} />
            </span>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <section className="landing-pricing" id="pricing" aria-labelledby="pricing-title">
        <div className="pricing-intro">
          <span className="intro-label">
            <span className="status-dot" />
            Simple pricing
          </span>
          <h2 id="pricing-title">
            Free to get clear.
            <br />
            $10 a month to stay clear.
          </h2>
          <p>
            Made for people paid on a schedule, with bills due in between.
            Everything is free during early access: no card, no sign-up.
          </p>
        </div>
        <div className="pricing-grid">
          <article className="price-card">
            <h3>Starter</h3>
            <p className="price">
              <strong>$0</strong>
            </p>
            <ul>
              {[
                "Import a bank CSV and confirm your bills",
                "See what’s left after bills, everyday spending and your reserve",
                "Check a purchase with the form",
                "Payday reminders and a recap of what changed",
                "5 cloud assistant questions a day",
                "Private mode: our model on your device, no daily limit",
              ].map((line) => (
                <li key={line}>
                  <Icon name="check" size={13} />
                  {line}
                </li>
              ))}
            </ul>
            <Button kind="secondary" onClick={() => sample("A")}>
              See a sample plan
            </Button>
          </article>
          <article className="price-card featured">
            <span className="pill">Free during early access</span>
            <h3>Covered Plus</h3>
            <p className="price">
              <strong>$10</strong>
              <span>a month, planned</span>
            </p>
            <ul>
              {[
                "Everything in Starter",
                "Up to 60 cloud assistant questions a day, instead of 5",
                "Our model plus OpenAI for anything it is unsure about",
                "Coming with the pilot: bank sync instead of a CSV",
              ].map((line) => (
                <li key={line}>
                  <Icon name="check" size={13} />
                  {line}
                </li>
              ))}
            </ul>
            <Button onClick={() => navigate("/setup/import")}>
              Start with my own CSV
              <Icon name="arrow" size={15} />
            </Button>
          </article>
        </div>
      </section>
      <section className="privacy-strip" id="privacy">
        <span className="feature-icon">
          <Icon name="shield" size={26} />
        </span>
        <div>
          <h2>Your money is personal. Your data should be too.</h2>
          <p>
            Your CSV is processed in this browser and stays on this device. The
            optional AI assistant works only after your consent; it receives
            your messages, plan details, bill names, amounts and dates, and
            limited cleaned descriptions during setup. In private mode the
            assistant runs in this browser and sends nothing at all.
          </p>
        </div>
        <span className="pill">You’re in control</span>
      </section>
      <footer className="landing-footer">
        <p>Curious? Start with a synthetic example.</p>
        <div>
          <button
            className="text-button"
            onClick={() =>
              downloadText(
                "covered-sample-A.csv",
                generateSampleCsv("A"),
                "text/csv",
              )
            }
          >
            Download sample A<Icon name="download" size={14} />
          </button>
          <button
            className="text-button"
            onClick={() =>
              downloadText(
                "covered-sample-B.csv",
                generateSampleCsv("B"),
                "text/csv",
              )
            }
          >
            Download sample B<Icon name="download" size={14} />
          </button>
          <button className="text-button" onClick={() => sample("B")}>
            Try sample B<Icon name="arrow" size={14} />
          </button>
        </div>
      </footer>
    </div>
  );
}
