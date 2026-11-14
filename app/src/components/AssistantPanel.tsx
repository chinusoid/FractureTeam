import { useEffect, useRef, useState } from "react";
import {
  type AppState,
  type ISODate,
  applyConfirmedProposal,
  newId,
  planInputFromState,
  simulatePurchase,
} from "../lib/finance";
import { ERROR_TEXT, buildAssistantRequest, callAssistant } from "../lib/client/assistant";
import type { ChatMessage, ProposalUiStatus } from "./context";
import { useApp } from "./context";
import { ProposalCard, SimulationView } from "./cards";
import { Button, Notice } from "./ui";

export const QUICK_PROMPTS = ["Can I afford $400 this weekend?", "My car insurance went up by $30", "Explain my plan"];

export interface ChatApi {
  messages: ChatMessage[];
  busy: boolean;
  send: (text: string) => Promise<void>;
  confirm: (messageId: string) => void;
  discard: (messageId: string) => void;
  clear: () => void;
}

export function useAssistantChat(deps: {
  getState: () => AppState;
  commit: (s: AppState) => void;
  today: ISODate;
  requestConsent: () => Promise<boolean>;
  messages: ChatMessage[];
  setMessages: (fn: (m: ChatMessage[]) => ChatMessage[]) => void;
}): ChatApi {
  const { getState, commit, today, requestConsent, messages, setMessages } = deps;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const push = (m: Omit<ChatMessage, "id">) => setMessages((list) => [...list, { ...m, id: newId("msg") }]);
  const setStatus = (id: string, status: ProposalUiStatus, note?: string) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, proposalStatus: status, proposalNote: note } : m)));

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busyRef.current) return;
    const history = messages.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
    push({ role: "user", text: trimmed });
    const ok = await requestConsent();
    if (!ok) {
      const e = ERROR_TEXT.no_consent;
      push({ role: "assistant", text: e.title, error: { code: "no_consent", ...e } });
      return;
    }
    const state = getState();
    if (!state.plan || !state.account) {
      push({ role: "assistant", text: "Build your plan first — then I can check purchases and bill changes against it." });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const req = buildAssistantRequest(state, today, "chat", trimmed, history);
      const res = await callAssistant(req, state.clientId);
      if (res.ok) {
        push({
          role: "assistant",
          text: res.data.message,
          response: res.data,
          proposalStatus: res.data.proposal ? "pending" : undefined,
        });
      } else {
        const e = ERROR_TEXT[res.code];
        const wait = res.retryAfterSeconds ? ` Try again in about ${Math.ceil(res.retryAfterSeconds / 60)} min.` : "";
        push({ role: "assistant", text: e.title, error: { code: res.code, title: e.title, action: e.action + wait } });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const confirm = (messageId: string) => {
    const msg = messages.find((m) => m.id === messageId);
    const proposal = msg?.response?.proposal;
    if (!msg || !proposal || msg.proposalStatus !== "pending") return;
    setStatus(messageId, "applied"); // locks the button immediately
    const result = applyConfirmedProposal(getState(), proposal, new Date().toISOString());
    if (result.kind === "applied") {
      commit(result.state);
      setStatus(messageId, "applied", "Saved. Your plan is updated.");
    } else if (result.kind === "already_applied") {
      setStatus(messageId, "already_applied", "This change was already saved; nothing was added twice.");
    } else if (result.kind === "stale") {
      setStatus(messageId, "stale", result.message);
    } else {
      setStatus(messageId, "invalid", result.errors.join(" "));
    }
  };

  const discard = (messageId: string) => setStatus(messageId, "discarded", "Discarded. Nothing changed.");

  return { messages, busy, send, confirm, discard, clear: () => setMessages(() => []) };
}

function MessageView({ m, chat }: { m: ChatMessage; chat: ChatApi }) {
  const { state, today } = useApp();
  if (m.role === "user") {
    return <div className="msg msg-user">{m.text}</div>;
  }
  if (m.error) {
    return (
      <div className="msg msg-assistant" data-testid="assistant-error">
        <Notice tone="warn" title={m.error.title}>
          {m.error.action}
        </Notice>
      </div>
    );
  }
  const r = m.response;
  const input = planInputFromState(state, today);
  // Amounts in cards are always recomputed locally from the current plan, never taken from the server.
  const sim =
    r?.simulation && input
      ? r.simulation.kind === "invalid"
        ? r.simulation
        : simulatePurchase(input, r.simulation.amountCents, r.simulation.purchaseDate)
      : null;
  return (
    <div className="msg msg-assistant" data-testid="assistant-message">
      {m.text && <p className="msg-text">{m.text}</p>}
      {sim && <SimulationView result={sim} testId="assistant-sim" />}
      {r?.proposal && (
        <ProposalCard
          proposal={r.proposal}
          status={m.proposalStatus ?? "pending"}
          note={m.proposalNote}
          onConfirm={() => chat.confirm(m.id)}
          onDiscard={() => chat.discard(m.id)}
        />
      )}
    </div>
  );
}

export function AssistantPanel({ chat, onClose }: { chat: ChatApi; onClose: () => void }) {
  const { state } = useApp();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.messages.length, chat.busy]);

  const submit = (value: string) => {
    if (!value.trim()) return;
    setText("");
    void chat.send(value);
  };

  return (
    <aside className="panel" aria-label="Assistant" data-testid="assistant-panel">
      <div className="panel-head">
        <h2>Assistant</h2>
        <div className="row-actions">
          {chat.messages.length > 0 && (
            <Button small variant="ghost" onClick={chat.clear}>
              Clear
            </Button>
          )}
          <Button small variant="secondary" onClick={onClose} testId="assistant-close">
            Close
          </Button>
        </div>
      </div>
      <div className="panel-body">
        {chat.messages.length === 0 && (
          <div className="panel-intro">
            <p>Ask about a purchase or tell me a bill changed. I prepare a change and you confirm it — nothing is saved without you.</p>
            {!state.consent.aiEnabled && (
              <p className="muted small">The assistant is off until you allow it. Your plan and all forms work without it.</p>
            )}
          </div>
        )}
        {chat.messages.map((m) => (
          <MessageView key={m.id} m={m} chat={chat} />
        ))}
        {chat.busy && (
          <div className="msg msg-assistant typing" aria-live="polite">
            Thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="panel-foot">
        <div className="chips">
          {QUICK_PROMPTS.map((p) => (
            <button key={p} type="button" className="chip" onClick={() => submit(p)} disabled={chat.busy}>
              {p}
            </button>
          ))}
        </div>
        <form
          className="panel-form"
          onSubmit={(e: { preventDefault: () => void }) => {
            e.preventDefault();
            submit(text);
          }}
        >
          <label htmlFor="assistant-input" className="sr-only">
            Message
          </label>
          <input
            id="assistant-input"
            className="input"
            value={text}
            maxLength={500}
            placeholder="e.g. Can I spend $120 on Friday?"
            onChange={(e: { target: { value: string } }) => setText(e.target.value)}
            data-testid="assistant-input"
          />
          <Button type="submit" disabled={chat.busy || !text.trim()} testId="assistant-send">
            Send
          </Button>
        </form>
      </div>
    </aside>
  );
}
