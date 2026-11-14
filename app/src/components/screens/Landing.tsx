import { generateSampleCsvA, generateSampleCsvB } from "../../lib/demo/sample";
import { APP_NAME, TAGLINE } from "../brand";
import { useApp } from "../context";
import { downloadText } from "../format";
import { Button, Card } from "../ui";

export function Landing() {
  const { navigate, setPending, today, state } = useApp();
  const hasPlan = !!(state.plan?.confirmed && state.account);

  const trySample = () => {
    setPending({ fileName: "sample-bank-a.csv", text: generateSampleCsvA(today), isSample: true });
    navigate("/setup/import");
  };

  return (
    <div className="landing">
      <section className="hero">
        <p className="eyebrow">{APP_NAME}</p>
        <h1>{TAGLINE}</h1>
        <p className="lead">
          Money in your account isn&apos;t all yours to spend. {APP_NAME} turns your recent transactions into a plan you can check:
          which bills are covered, what&apos;s left until payday, and what a purchase would change — before you make it.
        </p>
        <div className="row-actions">
          <Button onClick={trySample} testId="try-sample">
            Try sample data
          </Button>
          <Button variant="secondary" onClick={() => { setPending(null); navigate("/setup/import"); }} testId="import-own">
            Import transactions
          </Button>
          {hasPlan && (
            <Button variant="ghost" onClick={() => navigate("/app")}>
              Open my plan
            </Button>
          )}
        </div>
        <p className="muted small">
          No account needed. Prefer typing?{" "}
          <a
            href="/setup/plan"
            onClick={(e: { preventDefault: () => void }) => {
              e.preventDefault();
              navigate("/setup/plan");
            }}
          >
            Start without a file
          </a>
          .
        </p>
      </section>

      <div className="grid-3">
        <Card title="1. Import">
          <p>Upload a CSV export from your bank. It is read in your browser — the file is never uploaded.</p>
        </Card>
        <Card title="2. Confirm">
          <p>We suggest bills that repeat. Nothing counts until you confirm the amount and date.</p>
        </Card>
        <Card title="3. Check">
          <p>See what&apos;s free to spend, ask “can I afford this?”, and update a bill in one sentence.</p>
        </Card>
      </div>

      <Card title="Example" className="example">
        <table className="formula-table">
          <tbody>
            <tr>
              <td>Balance today</td>
              <td className="num">$2,200</td>
            </tr>
            <tr>
              <td>− Bills due before payday</td>
              <td className="num">$1,300</td>
            </tr>
            <tr>
              <td>− Everyday spending until payday</td>
              <td className="num">$350</td>
            </tr>
            <tr>
              <td>− Reserve you chose</td>
              <td className="num">$250</td>
            </tr>
            <tr className="total">
              <td>= Free to spend</td>
              <td className="num">$300</td>
            </tr>
          </tbody>
        </table>
        <p className="muted small">A $400 purchase would leave bills and everyday spending covered, but put you $100 below your reserve. Illustrative numbers, not financial advice.</p>
      </Card>

      <Card title="Your data">
        <ul className="tight">
          <li>Your CSV is parsed on this device and your plan is stored in this browser only.</li>
          <li>The AI assistant is optional. It is used only after you allow it, and only receives your plan, bill names, amounts and dates — never the file or account numbers.</li>
          <li>You can export or delete everything from Settings.</li>
        </ul>
        <p className="small">
          Test files:{" "}
          <button type="button" className="linklike" onClick={() => downloadText("sample-bank-a.csv", generateSampleCsvA(today))}>
            sample bank A (amount column)
          </button>{" "}
          ·{" "}
          <button type="button" className="linklike" onClick={() => downloadText("sample-bank-b.csv", generateSampleCsvB(today))}>
            sample bank B (debit/credit columns)
          </button>
        </p>
      </Card>
    </div>
  );
}
