import { useState } from "react";
import {
  applyConfirmedProposal,
  computePlan,
  dateLabel,
  money,
  previewProposal,
  simulatePurchase,
} from "@/lib/client/model";
import {
  activatePlus,
  PlusRequiredError,
  requestAssistant,
  type AssistantResponse,
} from "@/lib/client/assistant";
import { useApp } from "./context";
import { Button, Modal, Notice } from "./UI";
import { Icon } from "./Icon";

export function Assistant({
  close,
  setup,
}: {
  close: () => void;
  setup: boolean;
}) {
  const { state, change, navigate, toast } = useApp();
  const [message, setMessage] = useState(""),
    [messages, setMessages] = useState<
      { question: string; response?: AssistantResponse; error?: string; plusOffer?: boolean; preview?: ReturnType<typeof previewProposal> }[]
    >([]),
    [busy, setBusy] = useState(false),
    [applying, setApplying] = useState<string | null>(null);
  async function send(text: string) {
    if (!text.trim() || busy || !state.aiConsent) return;
    setMessage("");
    setBusy(true);
    setMessages((m) => [...m, { question: text }]);
    try {
      const history = messages.flatMap((m) => [
        { role: "user" as const, text: m.question },
        ...(m.response
          ? [{ role: "assistant" as const, text: m.response.message }]
          : []),
      ]);
      const response = await requestAssistant(
        state,
        text,
        setup ? "setup" : "plan",
        history,
      );
      const preview = response.proposal ? previewProposal(state, response.proposal) : null;
      setMessages((m) => [...m.slice(0, -1), { question: text, response, preview }]);
    } catch (e) {
      setMessages((m) => [
        ...m.slice(0, -1),
        e instanceof PlusRequiredError
          ? { question: text, error: e.message, plusOffer: true }
          : { question: text, error: (e as Error).message },
      ]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="A little help with your plan" close={close} drawer>
      <div className="assistant-content">
        {!state.aiConsent ? (
          <div className="consent">
            <span className="assistant-symbol">
              <Icon name="spark" size={32} />
            </span>
            <h2>Your plan. Your permission.</h2>
            <p>
              The assistant can explain your plan and suggest changes. Before it
              replies, it needs permission to process:
            </p>
            <ul>
              <li>The messages you send</li>
              <li>
                Your plan’s balance, dates, everyday spending, and reserve
              </li>
              <li>Bill names, amounts, and due dates</li>
              <li>
                During setup, a limited set of cleaned transaction descriptions
                and their amounts and dates
              </li>
            </ul>
            <Notice>
              This context goes to our assistant server and its AI provider.
              Your full CSV stays in this browser. Suggestions only change your
              plan after you confirm them.
            </Notice>
            <p className="small muted">
              You can turn this off in Settings. Manual forms work without AI.
            </p>
            <Button
              icon="check"
              onClick={() =>
                change((s) => ({
                  ...s,
                  stateVersion: s.stateVersion + 1,
                  aiConsent: true,
                }))
              }
            >
              I agree, enable assistant
            </Button>
            <Button kind="ghost" onClick={close}>
              Continue without assistant
            </Button>
          </div>
        ) : (
          <>
            <div className="assistant-intro">
              <span className="assistant-symbol">
                <Icon name="spark" size={28} />
              </span>
              <h3>More clarity, one question at a time.</h3>
              <p>
                Check a purchase, talk through a bill, or understand your plan.
              </p>
            </div>
            <div className="suggestions">
              {(setup
                ? [
                    "Review the recurring bills in my import",
                    "What should I check before building my plan?",
                  ]
                : [
                    "Can I afford $400 this weekend?",
                    "My car insurance went up by $30",
                    "Explain my plan",
                  ]
              ).map((s) => (
                <button disabled={busy} key={s} onClick={() => void send(s)}>
                  {s}
                  <Icon name="up" size={14} />
                </button>
              ))}
            </div>
            <div className="chat-messages" aria-live="polite">
              {messages.map((item, i) => (
                <div key={i}>
                  <div className="user-message">{item.question}</div>
                  {item.error && item.plusOffer && (
                    <div className="assistant-message">
                      <div className="proposal-card plus-offer">
                        <span className="pill">Free during early access</span>
                        <h3>Keep asking with Covered Plus</h3>
                        <p>{item.error}</p>
                        <ul>
                          <li>Up to 60 assistant questions a day</li>
                          <li>Planned price: $10 a month. No card and no sign-up today.</li>
                        </ul>
                        <Button
                          disabled={busy}
                          onClick={() => {
                            void activatePlus().then(() => {
                              toast("Covered Plus is on for this browser.");
                              // The offer is answered: drop it and ask the same question again.
                              setMessages((m) => m.filter((x) => x !== item));
                              void send(item.question);
                            });
                          }}
                        >
                          Get Plus free
                        </Button>
                        <Button
                          kind="ghost"
                          onClick={() => {
                            navigate(setup ? "/setup/plan" : "/app/bills");
                            close();
                          }}
                        >
                          Not now, use the forms
                        </Button>
                      </div>
                    </div>
                  )}
                  {item.error && !item.plusOffer && (
                    <div className="assistant-message">
                      <Notice error>{item.error}</Notice>
                      <Button kind="ghost" disabled={busy} onClick={() => void send(item.question)}>
                        Try again
                      </Button>
                      <Button
                        kind="secondary"
                        onClick={() => {
                          navigate(setup ? "/setup/plan" : "/app/bills");
                          close();
                        }}
                      >
                        Use the form instead
                      </Button>
                    </div>
                  )}
                  {item.response && (
                    <div className="assistant-message">
                      <span className="assistant-avatar">
                        <Icon name="spark" size={15} />
                      </span>
                      <p>{item.response.message}</p>
                      {item.response.servedBy && (
                        <span className="served-by">
                          {item.response.servedBy === "own"
                            ? "Answered by the Covered model, trained by our team and running on our server"
                            : item.response.servedBy === "local"
                              ? "Answered by our fine-tuned Qwen model"
                              : item.response.servedBy === "mock"
                                ? "Answered by the test model"
                                : "Answered by OpenAI"}
                        </span>
                      )}
                      {item.response.setupReview?.items.map((review) => (
                        <div className="setup-review" key={review.candidateId}>
                          <strong>{review.name}</strong>
                          <p>{review.reason}</p>
                          {review.question && (
                            <p className="muted">{review.question}</p>
                          )}
                          <small>
                            Review and confirm the bill in your setup form.
                          </small>
                        </div>
                      ))}
                      {item.response.simulation &&
                        (() => {
                          const sim = simulatePurchase(
                            state,
                            item.response.simulation.amountCents,
                            item.response.simulation.purchaseDate,
                          );
                          return "error" in sim ? (
                            <Notice error>{sim.error}</Notice>
                          ) : (
                            <div className="purchase-result">
                              <div>
                                <span>Your plan</span>
                                <strong>
                                  {money(computePlan(state).remainderCents)}
                                </strong>
                              </div>
                              <div>
                                <span>With this purchase</span>
                                <strong>{money(sim.remainderCents!)}</strong>
                              </div>
                              <p>{sim.message}</p>
                              <small>
                                Calculated on your device. No change to your
                                balance.
                              </small>
                            </div>
                          );
                        })()}
                      {item.response.proposal &&
                        (() => {
                          const proposal = item.response.proposal,
                            preview = item.preview,
                            applied = state.appliedProposalIds.includes(
                              proposal.id,
                            ),
                            stale =
                              proposal.stateVersion !== state.stateVersion;
                          return (
                            <div className="proposal-card">
                              <h3>
                                {preview?.updated.name ?? "Bill change"}
                              </h3>
                              {preview && (
                                <>
                                  <table className="proposal-comparison" aria-label="Bill change preview">
                                    <thead><tr><th scope="col">Bill</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
                                    <tbody>
                                      <tr><th scope="row">Name</th><td>{preview.target?.name ?? "No bill yet"}</td><td>{preview.updated.name}</td></tr>
                                      <tr><th scope="row">Amount</th><td>{preview.target ? money(preview.target.amountCents) : "—"}</td><td>{money(preview.updated.amountCents)}</td></tr>
                                      <tr><th scope="row">Due date</th><td>{preview.target ? dateLabel(preview.target.dueDate, true) : "—"}</td><td>{dateLabel(preview.updated.dueDate, true)}</td></tr>
                                      <tr><th scope="row">Available</th><td>{money(preview.before.remainderCents)}</td><td>{money(preview.after.remainderCents)}</td></tr>
                                    </tbody>
                                  </table>
                                  <p className="small muted">{preview.target ? "Review the change before saving." : "This adds one confirmed bill. You can set it to repeat in Bills."}</p>
                                </>
                              )}
                              {!preview && (
                                <>
                                  <Notice error>This suggestion is invalid. Use the bill form instead.</Notice>
                                  <Button kind="secondary" onClick={() => { navigate("/app/bills"); close(); }}>Open Bills</Button>
                                </>
                              )}
                              {stale && !applied && (
                                <>
                                  <Notice error>Your plan has changed since this suggestion. Ask for a fresh proposal.</Notice>
                                  <Button kind="secondary" disabled={busy} onClick={() => void send(item.question)}>Refresh suggestion</Button>
                                </>
                              )}
                              {applied && <Notice>Saved to your plan.</Notice>}
                              <Button
                                disabled={
                                  !preview ||
                                  applied ||
                                  stale ||
                                  applying === proposal.id
                                }
                                onClick={() => {
                                  setApplying(proposal.id);
                                  change((current) => {
                                    const result = applyConfirmedProposal(
                                      current,
                                      proposal,
                                    );
                                    if (result.status !== "applied")
                                      toast(
                                        result.status === "stale"
                                          ? "Your plan changed. Request a new suggestion."
                                          : result.status === "already_applied"
                                            ? "This change was already applied."
                                            : "This change could not be applied. Use the form.",
                                      );
                                    return result.state;
                                  });
                                  setApplying(null);
                                }}
                              >
                                {applied ? "Applied" : "Confirm change"}
                              </Button>
                            </div>
                          );
                        })()}
                    </div>
                  )}
                </div>
              ))}
              {busy && (
                <div className="thinking" role="status">
                  <span />
                  <span />
                  <span />
                  Looking at your plan…
                </div>
              )}
            </div>
            <form
              className="assistant-form"
              onSubmit={(e) => {
                e.preventDefault();
                void send(message);
              }}
            >
              <label className="sr-only" htmlFor="assistant-message">
                Message your assistant
              </label>
              <textarea
                id="assistant-message"
                maxLength={500}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Ask about your plan…"
                disabled={busy}
              />
              <button
                className="icon-button send-button"
                type="submit"
                disabled={busy || !message.trim()}
                aria-label="Send message"
              >
                <Icon name="arrow" size={19} />
              </button>
            </form>
            <p className="assistant-disclaimer">
              Suggestions need your confirmation. Check important details.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
