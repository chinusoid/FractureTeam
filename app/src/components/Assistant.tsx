import { useEffect, useRef, useState } from "react";
import {
  addDays,
  today,
  applyConfirmedProposal,
  computePlan,
  dateLabel,
  money,
  previewProposal,
  simulatePurchase,
} from "@/lib/client/model";
import {
  activatePlus,
  buildAssistantRequest,
  describeShared,
  PlusRequiredError,
  requestAssistant,
  ServerUnreachableError,
  type AssistantResponse,
} from "@/lib/client/assistant";
import {
  aiWhere,
  answerOnDevice,
  onAiWhereChange,
  setAiWhere,
  type AiWhere,
  type DeviceReason,
} from "@/lib/client/onDevice";
import { useApp } from "./context";
import { Button, Modal, Notice } from "./UI";
import { Icon } from "./Icon";

export function Assistant({
  close,
  setup,
  byHand = false,
}: {
  close: () => void;
  setup: boolean;
  /** Setup without a file: the assistant turns a typed sentence into a bill draft to confirm. */
  byHand?: boolean;
}) {
  const { state, change, navigate, toast } = useApp();
  const [message, setMessage] = useState(""),
    [messages, setMessages] = useState<
      {
        question: string;
        response?: AssistantResponse;
        error?: string;
        plusOffer?: boolean;
        preview?: ReturnType<typeof previewProposal>;
        /** Set when the Covered model answered in this browser, and why. */
        device?: DeviceReason;
        /** What this request shared with the server (cloud answers only). */
        shared?: ReturnType<typeof describeShared>;
      }[]
    >([]),
    [busy, setBusy] = useState(false),
    [applying, setApplying] = useState<string | null>(null);
  // Voice input (Web Speech API, where the browser has it). Speech is written into the message box and is
  // never sent by itself: listening stops on a second tap or after VOICE_SILENCE_MS of silence, and the
  // user sends the text (or edits it first).
  const [voice, setVoice] = useState(false),
    [listening, setListening] = useState(false);
  const recognition = useRef<{ stop: () => void } | null>(null);
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cloud (our server) or private mode (the Covered model in this browser). Read after mount: no storage on the server render.
  const [where, setWhere] = useState<AiWhere>("cloud");
  useEffect(() => {
    setWhere(aiWhere());
    return onAiWhereChange(setWhere);
  }, []);
  const canAsk = state.aiConsent || where === "device";
  function choose(next: AiWhere) {
    setAiWhere(next);
    setWhere(next);
  }
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    setVoice(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => {
      if (silence.current) clearTimeout(silence.current);
      recognition.current?.stop();
    };
  }, []);
  function listen() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const w = window as unknown as Record<string, new () => SpeechLike>;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true; // a pause in speech does not end the session; the silence timer does
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const typed = message.trim();
    const stopAfterSilence = () => {
      if (silence.current) clearTimeout(silence.current);
      silence.current = setTimeout(() => rec.stop(), VOICE_SILENCE_MS);
    };
    rec.onresult = (e) => {
      const spoken = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      setMessage([typed, spoken].filter(Boolean).join(" ").slice(0, 500));
      stopAfterSilence();
    };
    const finish = () => {
      if (silence.current) clearTimeout(silence.current);
      silence.current = null;
      setListening(false);
      recognition.current = null;
      document.getElementById("assistant-message")?.focus();
    };
    rec.onerror = finish;
    rec.onend = finish;
    recognition.current = rec;
    setListening(true);
    rec.start();
    stopAfterSilence();
  }

  async function send(text: string, forceWhere?: AiWhere) {
    const runOn = forceWhere ?? where;
    if (!text.trim() || busy || !(state.aiConsent || runOn === "device")) return;
    setMessage("");
    setBusy(true);
    setMessages((m) => [...m, { question: text }]);
    try {
      // Turns answered in private mode stay on this device: they are never sent to the cloud as history.
      const history = messages
        .filter((m) => runOn === "device" || !m.device)
        .flatMap((m) => [
        { role: "user" as const, text: m.question },
        ...(m.response
          ? [{ role: "assistant" as const, text: m.response.message }]
          : []),
      ]);
      const mode = setup ? "setup" : "plan";
      let response: AssistantResponse,
        device: DeviceReason | undefined,
        shared: ReturnType<typeof describeShared> | undefined;
      if (runOn === "device") {
        response = await answerOnDevice(state, text, mode, history);
        device = "chosen";
      } else {
        try {
          response = await requestAssistant(state, text, mode, history);
          shared = describeShared(
            buildAssistantRequest(state, text, mode, history),
            state.transactions.length,
          );
        } catch (e) {
          // No network or no assistant server: the Covered model still answers, on this device.
          if (!(e instanceof ServerUnreachableError)) throw e;
          response = await answerOnDevice(state, text, mode, history);
          device = "offline";
        }
      }
      const preview = response.proposal ? previewProposal(state, response.proposal) : null;
      setMessages((m) => [...m.slice(0, -1), { question: text, response, preview, device, shared }]);
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
        {!canAsk ? (
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
            <div className="private-option">
              <h3>
                <Icon name="shield" size={16} />
                Or keep everything on this device
              </h3>
              <p>
                Our own Covered model can answer right here in your browser.
                Nothing is sent, it works offline, and it’s free with no daily
                limit. It understands fewer kinds of questions than the cloud.
              </p>
              <Button kind="secondary" onClick={() => choose("device")}>
                Use private mode
              </Button>
            </div>
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
              <h3>{byHand ? "Tell me a bill, I’ll write it down." : "More clarity, one question at a time."}</h3>
              <p>
                {byHand
                  ? "Type a name, an amount and a due date. You confirm each bill before it is added."
                  : "Check a purchase, talk through a bill, or understand your plan."}
              </p>
              <div className="where-toggle" role="group" aria-label="Where the assistant runs">
                <button
                  type="button"
                  aria-pressed={where === "cloud"}
                  className={where === "cloud" ? "active" : ""}
                  onClick={() => choose("cloud")}
                  disabled={busy}
                >
                  <Icon name="spark" size={13} />
                  Cloud
                </button>
                <button
                  type="button"
                  aria-pressed={where === "device"}
                  className={where === "device" ? "active" : ""}
                  onClick={() => choose("device")}
                  disabled={busy}
                >
                  <Icon name="shield" size={13} />
                  Private, on this device
                </button>
              </div>
              <p className="where-note" data-testid="where-note">
                {where === "device"
                  ? "The Covered model runs in this browser. Nothing leaves your device, and it works offline."
                  : "Our server answers and can pass harder questions to a larger model. Under each answer you can see exactly what was shared."}
              </p>
            </div>
            <div className="suggestions">
              {(byHand
                ? [
                    `Add rent, $1,100, due ${dateLabel(addDays(today(), 5), true)}`,
                    `Add my phone bill, $65, due ${dateLabel(addDays(today(), 9), true)}`,
                  ]
                : setup
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
                          <li>Private mode stays free with no limit: it runs on your device.</li>
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
                          kind="secondary"
                          disabled={busy}
                          onClick={() => {
                            choose("device");
                            setMessages((m) => m.filter((x) => x !== item));
                            void send(item.question, "device");
                          }}
                        >
                          Ask on this device instead
                        </Button>
                        <Button
                          kind="ghost"
                          onClick={() => {
                            navigate(setup || byHand ? "/setup/plan" : "/app/bills");
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
                          navigate(setup || byHand ? "/setup/plan" : "/app/bills");
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
                      {item.response.servedBy === "device" ? (
                        <span className="served-by on-device" data-testid="served-on-device">
                          <Icon name="shield" size={12} />
                          {item.device === "offline"
                            ? "Our server is out of reach, so the Covered model answered on this device. Nothing was sent."
                            : "Answered on this device by the Covered model. Nothing was sent."}
                        </span>
                      ) : item.response.servedBy && (
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
                      {item.shared && (
                        <details className="shared-details">
                          <summary>What was shared</summary>
                          <div>
                            <strong>Sent for this answer</strong>
                            <ul>
                              {item.shared.sent.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                            <strong>Stayed on this device</strong>
                            <ul>
                              {item.shared.kept.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        </details>
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
                  {where === "device" ? "Thinking on your device…" : "Looking at your plan…"}
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
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter starts a new line; not while an input method is composing.
                  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (!busy && message.trim()) void send(message);
                }}
                placeholder={byHand ? "Internet, $50, due on the 22nd…" : "Ask about your plan…"}
                disabled={busy}
              />
              {voice && (
                <button
                  className={`icon-button mic-button ${listening ? "listening" : ""}`}
                  type="button"
                  onClick={listen}
                  disabled={busy}
                  aria-pressed={listening}
                  aria-label={listening ? "Stop listening" : "Ask by voice"}
                  title={listening ? "Listening… tap to stop. Nothing is sent until you press Send" : "Ask by voice"}
                >
                  <Icon name="mic" size={18} />
                </button>
              )}
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
            {!state.aiConsent && where === "device" && (
              <p className="assistant-disclaimer">
                Want the cloud too?{" "}
                <button className="text-button" onClick={() => choose("cloud")}>
                  Review what it shares
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** Listening stops after this much silence; the text stays in the box, unsent. */
const VOICE_SILENCE_MS = 5000;

interface SpeechLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
