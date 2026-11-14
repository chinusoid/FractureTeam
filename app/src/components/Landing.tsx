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
            "Update your balance, check off paid bills, and see what’s changed.",
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
