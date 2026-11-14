import { useApp } from "./context";
import { BRAND } from "./brand";
import { Button, downloadText, Gauge } from "./UI";
import { Icon } from "./Icon";
import { generateSampleCsv } from "@/lib/client/model";

export function Landing() {
  const { sample, navigate } = useApp();
  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="hero-copy">
          <span className="intro-label">
            <span className="status-dot" />A little clarity for your money
          </span>
          <h1>
            Money in the bank.
            <br />
            Peace of mind
            <br />
            in your plan.
          </h1>
          <p>
            {BRAND.tagline} See your bills, set a little aside, and find out
            what’s actually yours to spend.
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
        </div>
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
              $300<span>.00</span>
            </strong>
            <p>After the things that matter.</p>
          </div>
          <div className="preview-gauge">
            <Gauge percent={86} />
            <div>
              <strong>$2,200</strong>
              <span>Starting balance</span>
            </div>
          </div>
          <div className="preview-breakdown">
            <div>
              <span>
                <Icon name="bill" size={15} />
                Upcoming bills
              </span>
              <strong>$1,300</strong>
            </div>
            <div>
              <span>
                <Icon name="bag" size={15} />
                Everyday spending
              </span>
              <strong>$350</strong>
            </div>
            <div>
              <span>
                <Icon name="shield" size={15} />A little breathing room
              </span>
              <strong>$250</strong>
            </div>
          </div>
          <div className="preview-bottom">
            <span>Every dollar has a place.</span>
            <Icon name="check" size={17} />
          </div>
        </div>
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
      <section className="landing-pricing" aria-labelledby="pricing-title">
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
                "5 assistant questions a day",
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
                "Up to 60 assistant questions a day",
                "Change a bill in one sentence, with a before and after",
                "Payday reminders and a recap of what changed",
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
      <section className="privacy-strip">
        <span className="feature-icon">
          <Icon name="shield" size={26} />
        </span>
        <div>
          <h2>Your money is personal. Your data should be too.</h2>
          <p>
            Your CSV is processed in this browser and stays on this device. The
            optional AI assistant works only after your consent; it receives
            your messages, plan details, bill names, amounts and dates, and
            limited cleaned descriptions during setup.
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
