import { useEffect, useRef, useState } from "react";
import { dateLabel, money } from "@/lib/client/model";
import {
  applyAnswer,
  draftToState,
  emptyDraft,
  nextStep,
  sendAnswer,
  stepNumber,
  type InterviewDraft,
} from "@/lib/client/intake";
import { INTAKE_QUESTIONS, INTAKE_STEPS, type IntakeStep } from "@/lib/schemas/intake";
import { useApp } from "./context";
import { Button, Notice, PageHeading } from "./UI";
import { Icon } from "./Icon";

interface Turn {
  step: IntakeStep;
  answer: string;
  reply?: string;
  error?: string;
}

/**
 * Setup as an interview: five fixed questions, answered in the person's own words.
 * Nothing becomes a plan here. The answers open the setup screen, where every number and bill
 * can be confirmed, edited, dismissed or added to before "Build my plan".
 */
export function InterviewScreen() {
  const { state, change, navigate } = useApp();
  const [draft, setDraft] = useState<InterviewDraft>(emptyDraft),
    [turns, setTurns] = useState<Turn[]>([]),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    /** A bill answer that was missing an amount or a date: the next answer is read together with it. */
    [carry, setCarry] = useState("");
  const step = nextStep(draft);
  const input = useRef<HTMLTextAreaElement>(null),
    end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
    if (!busy) input.current?.focus({ preventScroll: true });
  }, [turns, busy, step]);

  async function send(answer: string) {
    if (!step || busy || !answer.trim()) return;
    setText("");
    setBusy(true);
    setTurns((t) => [...t, { step, answer }]);
    try {
      const full = step === "bills" && carry ? `${carry}. ${answer}`.slice(0, 500) : answer;
      const r = await sendAnswer(step, full, draft);
      setCarry(step === "bills" && !r.done && /I still need/.test(r.message) ? full.slice(0, 300) : "");
      setDraft((d) => applyAnswer(d, r));
      setTurns((t) => [...t.slice(0, -1), { step, answer, reply: r.message }]);
    } catch (e) {
      setTurns((t) => [...t.slice(0, -1), { step, answer, error: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }
  function review() {
    change((s) => draftToState(s, draft));
    navigate("/setup/plan");
  }
  const started = draft.balanceCents !== null;

  return (
    <>
      <PageHeading
        title="Five questions, then your plan."
        description="Answer in your own words. You check every number before anything is built."
      />
      {!state.aiConsent ? (
        <section className="panel interview-consent">
          <span className="assistant-symbol">
            <Icon name="spark" size={30} />
          </span>
          <h2>The assistant reads your answers.</h2>
          <p>
            Each answer you type here goes to our assistant server and its AI provider, which turn it into a number, a
            date or a bill. Nothing else is sent, nothing is stored there, and the interview does not use up your free
            assistant questions.
          </p>
          <div className="inline-actions">
            <Button
              icon="check"
              onClick={() => change((s) => ({ ...s, stateVersion: s.stateVersion + 1, aiConsent: true }))}
            >
              I agree, start the interview
            </Button>
            <Button kind="ghost" onClick={() => navigate("/setup/plan")}>
              Use the form instead
            </Button>
          </div>
        </section>
      ) : (
        <div className="setup-layout interview-layout">
          <section className="panel interview-chat" aria-label="Interview">
            <div className="section-heading">
              <h2>{step ? `Question ${stepNumber(step)} of ${INTAKE_STEPS.length}` : "All five answered"}</h2>
              <span className="pill">
                <Icon name="spark" size={12} /> Free interview
              </span>
            </div>
            <div className="chat-messages" aria-live="polite">
              {turns.map((t, i) => (
                <div key={i}>
                  {(i === 0 || turns[i - 1].step !== t.step) && (
                    <div className="assistant-message">
                      <p>{INTAKE_QUESTIONS[t.step]}</p>
                    </div>
                  )}
                  <div className="user-message">{t.answer}</div>
                  {t.reply && (
                    <div className="assistant-message">
                      <p>{t.reply}</p>
                    </div>
                  )}
                  {t.error && (
                    <div className="assistant-message">
                      <Notice error>{t.error}</Notice>
                      <div className="inline-actions">
                        <Button kind="ghost" disabled={busy} onClick={() => void send(t.answer)}>
                          Try again
                        </Button>
                        <Button kind="secondary" onClick={review}>
                          Continue in the form
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {step && !busy && (turns.length === 0 || turns[turns.length - 1].step !== step) && (
                <div className="assistant-message">
                  <p>{INTAKE_QUESTIONS[step]}</p>
                </div>
              )}
              {busy && (
                <div className="thinking" role="status">
                  <span />
                  <span />
                  <span />
                  Reading your answer…
                </div>
              )}
              {!step && (
                <div className="assistant-message">
                  <p>
                    That’s everything. On the next screen you check it: confirm, edit or dismiss each bill, change any
                    number, add what is missing.
                  </p>
                  <Button onClick={review}>
                    Check my answers
                    <Icon name="arrow" size={16} />
                  </Button>
                </div>
              )}
              <div ref={end} />
            </div>
            {step && (
              <form
                className="assistant-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(text);
                }}
              >
                <label className="sr-only" htmlFor="interview-answer">
                  Your answer
                </label>
                <textarea
                  id="interview-answer"
                  ref={input}
                  maxLength={500}
                  value={text}
                  disabled={busy}
                  placeholder="Type your answer…"
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send(text);
                    }
                  }}
                />
                <button
                  className="icon-button send-button"
                  type="submit"
                  disabled={busy || !text.trim()}
                  aria-label="Send answer"
                >
                  <Icon name="arrow" size={19} />
                </button>
              </form>
            )}
          </section>
          <section className="panel interview-summary" aria-label="What I have so far">
            <div className="section-heading">
              <h2>What I have so far</h2>
            </div>
            <dl className="interview-facts">
              <div>
                <dt>In your account</dt>
                <dd data-testid="iv-balance">{draft.balanceCents === null ? "—" : money(draft.balanceCents)}</dd>
              </div>
              <div>
                <dt>Plan runs to</dt>
                <dd data-testid="iv-end">{draft.endDate ? dateLabel(draft.endDate, true) : "—"}</dd>
              </div>
              <div>
                <dt>Everyday spending</dt>
                <dd data-testid="iv-everyday">{draft.everydayCents === null ? "—" : money(draft.everydayCents)}</dd>
              </div>
              <div>
                <dt>Reserve</dt>
                <dd data-testid="iv-reserve">{draft.reserveCents === null ? "—" : money(draft.reserveCents)}</dd>
              </div>
            </dl>
            <h3 className="interview-bills-title">
              Bills <span className="count">{draft.bills.length}</span>
            </h3>
            {draft.bills.length === 0 ? (
              <p className="small muted">{draft.billsDone ? "None before the end of the plan." : "None yet."}</p>
            ) : (
              <ul className="interview-bills">
                {draft.bills.map((b) => (
                  <li key={b.name}>
                    <span>
                      {b.name}
                      <small>due {dateLabel(b.dueDate)}</small>
                    </span>
                    <strong>{money(b.amountCents)}</strong>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${b.name}`}
                      onClick={() => setDraft((d) => ({ ...d, bills: d.bills.filter((x) => x.name !== b.name) }))}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="small muted interview-note">
              Nothing is final here. You confirm, edit or remove everything on the next screen.
            </p>
            {started && step && (
              <Button kind="ghost" onClick={review}>
                Finish in the form
              </Button>
            )}
          </section>
        </div>
      )}
    </>
  );
}
