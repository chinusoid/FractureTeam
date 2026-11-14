"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AppState, emptyState, localToday } from "../lib/finance";
import { loadState, saveState } from "../lib/storage/local";
import { useRoute, type Route } from "../lib/client/router";
import { APP_NAME } from "./brand";
import { AppContext, type AppCtx, type ChatMessage, type PendingImport } from "./context";
import { Button, Modal, Notice } from "./ui";
import { Landing } from "./screens/Landing";
import { ImportScreen } from "./screens/ImportScreen";
import { PlanSetup } from "./screens/PlanSetup";
import { Home } from "./screens/Home";
import { Bills } from "./screens/Bills";
import { UpdateBalance } from "./screens/UpdateBalance";
import { Settings } from "./screens/Settings";
import { AssistantPanel, useAssistantChat } from "./AssistantPanel";
import { AI_DATA_NOT_SENT, AI_DATA_SENT } from "./aiData";

const NAV: { to: Route; label: string }[] = [
  { to: "/app", label: "Plan" },
  { to: "/app/bills", label: "Bills" },
  { to: "/app/update", label: "Update" },
  { to: "/app/settings", label: "Settings" },
];

export default function ClientApp() {
  const { route, navigate } = useRoute();
  const [state, setState] = useState<AppState | null>(null);
  const stateRef = useRef<AppState | null>(null);
  const [loadNotice, setLoadNotice] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [consentAsk, setConsentAsk] = useState<((ok: boolean) => void) | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const today = useMemo(() => localToday(), []);

  const loadedOnce = useRef(false);
  useEffect(() => {
    // Load once: StrictMode runs effects twice, and a second read would hide the "data reset" notice.
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    const loaded = loadState();
    stateRef.current = loaded.state;
    setState(loaded.state);
    setLoadNotice(loaded.notice);
  }, []);

  const commit = useCallback((next: AppState) => {
    stateRef.current = next;
    setState(next);
    setSaveFailed(!saveState(next));
  }, []);
  const getState = useCallback(() => stateRef.current ?? emptyState(), []);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 3500);
  }, []);

  const requestConsent = useCallback((): Promise<boolean> => {
    const current = stateRef.current;
    if (current?.consent.aiEnabled) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setConsentAsk(() => resolve));
  }, []);

  const chat = useAssistantChat({ getState, commit, today, requestConsent, messages, setMessages });

  const ask = useCallback(
    (text: string) => {
      setAssistantOpen(true);
      void chat.send(text);
    },
    [chat],
  );

  if (!state || !route) {
    return (
      <div className="boot" aria-busy="true">
        <span className="brand-mark" aria-hidden="true" />
        Loading your plan…
      </div>
    );
  }

  const ctx: AppCtx = {
    state,
    getState,
    commit,
    today,
    route,
    navigate,
    pending,
    setPending,
    assistantOpen,
    setAssistantOpen,
    ask,
    requestConsent,
    flash,
  };

  const hasPlan = !!(state.plan && state.account && state.plan.confirmed);
  const inApp = route.startsWith("/app");
  const panelVisible = assistantOpen && (inApp || route === "/setup/plan");

  let screen;
  switch (route) {
    case "/":
      screen = <Landing />;
      break;
    case "/setup/import":
      screen = <ImportScreen />;
      break;
    case "/setup/plan":
      screen = <PlanSetup />;
      break;
    case "/app":
      screen = <Home />;
      break;
    case "/app/bills":
      screen = <Bills />;
      break;
    case "/app/update":
      screen = <UpdateBalance />;
      break;
    case "/app/settings":
      screen = <Settings />;
      break;
  }

  return (
    <AppContext.Provider value={ctx}>
      <div className={`shell${panelVisible ? " with-panel" : ""}`}>
        <header className="topbar">
          <div className="topbar-inner">
            <a
              className="brand"
              href={hasPlan ? "/app" : "/"}
              onClick={(e: { preventDefault: () => void }) => {
                e.preventDefault();
                navigate(hasPlan ? "/app" : "/");
              }}
            >
              <span className="brand-mark" aria-hidden="true" />
              {APP_NAME}
            </a>
            {hasPlan && (
              <nav className="nav" aria-label="Main">
                {NAV.map((n) => (
                  <a
                    key={n.to}
                    href={n.to}
                    className={`nav-link${route === n.to ? " active" : ""}`}
                    aria-current={route === n.to ? "page" : undefined}
                    onClick={(e: { preventDefault: () => void }) => {
                      e.preventDefault();
                      navigate(n.to);
                    }}
                  >
                    {n.label}
                  </a>
                ))}
              </nav>
            )}
            {(inApp || route === "/setup/plan") && hasPlan && (
              <Button variant={assistantOpen ? "secondary" : "primary"} small onClick={() => setAssistantOpen(!assistantOpen)} testId="assistant-toggle">
                {assistantOpen ? "Close assistant" : "Assistant"}
              </Button>
            )}
          </div>
        </header>

        <div className="layout">
          <main className="main" id="main">
            {loadNotice && (
              <Notice tone="warn" title="Saved data reset" action={<Button small variant="ghost" onClick={() => setLoadNotice(null)}>Dismiss</Button>}>
                {loadNotice}
              </Notice>
            )}
            {saveFailed && (
              <Notice tone="danger" title="Your last change was not saved in this browser" testId="save-error">
                Storage is full or blocked (private mode can do this). Export your data from Settings, free up space, then try again.
              </Notice>
            )}
            {screen}
          </main>
          {panelVisible && (
            <AssistantPanel chat={chat} onClose={() => setAssistantOpen(false)} />
          )}
        </div>
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
        {consentAsk && (
          <ConsentModal
            onAnswer={(ok) => {
              if (ok) {
                const s = stateRef.current ?? emptyState();
                commit({ ...s, consent: { aiEnabled: true, acceptedAt: new Date().toISOString(), policyVersion: 1 } });
              }
              consentAsk(ok);
              setConsentAsk(null);
            }}
          />
        )}
      </div>
    </AppContext.Provider>
  );
}

function ConsentModal(props: { onAnswer: (ok: boolean) => void }) {
  return (
    <Modal
      title="Turn on the AI assistant?"
      onClose={() => props.onAnswer(false)}
      testId="consent-modal"
      actions={
        <>
          <Button variant="secondary" onClick={() => props.onAnswer(false)}>
            Not now
          </Button>
          <Button onClick={() => props.onAnswer(true)} testId="consent-accept">
            Turn on
          </Button>
        </>
      }
    >
      <p>The assistant sends a small part of your data to an AI provider to answer. It never saves changes by itself — you confirm every change.</p>
      <p className="muted small-title">Sent with each request</p>
      <ul className="tight">
        {AI_DATA_SENT.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <p className="muted small-title">Never sent</p>
      <ul className="tight">
        {AI_DATA_NOT_SENT.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <p className="muted">You can turn this off any time in Settings. Every calculation also works without the assistant.</p>
    </Modal>
  );
}
