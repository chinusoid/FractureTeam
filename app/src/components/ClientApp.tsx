"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  dateLabel,
  emptyState,
  generateSampleCsv,
  money,
  today,
  type AppState,
} from "@/lib/client/model";
import { loadState, saveState } from "@/lib/storage/local";
import { AppContext } from "./context";
import { Logo, Button, Notice } from "./UI";
import { Icon } from "./Icon";
import { Landing } from "./Landing";
import { ImportScreen } from "./ImportScreen";
import { SetupScreen } from "./SetupScreen";
import { Dashboard } from "./Dashboard";
import {
  BillsScreen,
  SettingsScreen,
  TransactionsScreen,
  UpdateScreen,
} from "./management";
import { Assistant } from "./Assistant";

const NAV = [
  ["/app", "grid", "Overview"],
  ["/app/bills", "bill", "Bills & payments"],
  ["/app/transactions", "chart", "Transactions"],
  ["/app/settings", "settings", "Settings"],
];
export function ClientApp() {
  const [state, setState] = useState<AppState>(emptyState),
    [mounted, setMounted] = useState(false),
    [path, setPath] = useState("/"),
    [notice, setNotice] = useState(""),
    [saveError, setSaveError] = useState(""),
    [toastText, setToastText] = useState(""),
    [assistant, setAssistant] = useState(false),
    [menu, setMenu] = useState(false),
    [initialCsv, setInitialCsv] = useState(""),
    [variant, setVariant] = useState<"A" | "B" | null>(null),
    [importKey, setImportKey] = useState(0),
    [search, setSearch] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    stateRef = useRef(state),
    initialized = useRef(false);
  const navigate = useCallback((to: string) => {
    if (window.location.pathname !== to) window.history.pushState({}, "", to);
    setPath(to);
    setMenu(false);
    // A new screen starts at its top at once; the page-wide smooth scrolling is for in-page jumps only.
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  const toast = useCallback((text: string) => {
    setToastText(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(""), 5000);
  }, []);
  const change = useCallback((updater: (s: AppState) => AppState) => {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
    const error = saveState(next);
    setSaveError(error ?? "");
  }, []);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      const loaded = loadState();
      stateRef.current = loaded.state;
      setState(loaded.state);
      setNotice(loaded.notice ?? "");
    }
    setPath(window.location.pathname);
    setMounted(true);
    const pop = () => {
      setPath(window.location.pathname);
      setMenu(false);
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  function sample(v: "A" | "B") {
    setInitialCsv(generateSampleCsv(v));
    setVariant(v);
    setImportKey((n) => n + 1);
    navigate("/setup/import");
  }
  function nav(to: string) {
    if (to === "/setup/import") {
      setInitialCsv("");
      setVariant(null);
      setImportKey((n) => n + 1);
    }
    navigate(to);
  }
  const needsPlan = path.startsWith("/app") && !state.plan.confirmed;
  const titles: Record<string, string> = {
    "/": "Your money, made clearer",
    "/setup/import": "Get started",
    "/setup/plan": "Your first plan",
    "/app": "Overview",
    "/app/bills": "Bills & payments",
    "/app/update": "Update balance",
    "/app/transactions": "Transactions",
    "/app/settings": "Settings",
  };
  const activeBills = state.bills.filter(
    (b) => b.status === "confirmed",
  ).length;
  if (!mounted)
    return (
      <div className="loading-screen" role="status">
        <Logo />
        <span className="loading-line" />
        <p>Finding a little clarity…</p>
        <a href="" className="text-button">Taking too long? Reload Covered</a>
      </div>
    );
  return (
    <AppContext.Provider
      value={{
        state,
        change,
        navigate: nav,
        toast,
        openAssistant: () => setAssistant(true),
        sample,
      }}
    >
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <div className="app-shell">
        <aside
          className={`sidebar ${menu ? "is-open" : ""}`}
          aria-label="Main navigation"
        >
          <button
            className="brand-link"
            aria-label="Covered home"
            onClick={() => nav(state.plan.confirmed ? "/app" : "/")}
          >
            <Logo />
          </button>
          <div className="workspace-label">Your workspace</div>
          <nav>
            {NAV.map(([to, icon, label]) => (
              <button
                key={to}
                className={`nav-item ${path === to ? "active" : ""}`}
                onClick={() => nav(to)}
              >
                <Icon name={icon} size={17} />
                <span>{label}</span>
                {to === "/app/bills" && activeBills > 0 && (
                  <small>{activeBills}</small>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-separator" />
          <div className="workspace-label">A little extra clarity</div>
          <button className="nav-item" onClick={() => setAssistant(true)}>
            <Icon name="spark" size={18} />
            <span>Your assistant</span>
            <span className="new-tag">AI</span>
          </button>
          <button className="nav-item" onClick={() => nav("/setup/import")}>
            <Icon name="upload" size={17} />
            <span>Import transactions</span>
          </button>
          <div className="sidebar-bottom">
            <div className="sidebar-tip">
              <span className="tip-flower">
                <Icon name="spark" size={29} />
              </span>
              <p>
                Good plans leave
                <br />
                room to live.
              </p>
              <span>
                Make a little space
                <br />
                for what matters.
              </span>
            </div>
            <div className="profile">
              <span className="avatar">Y</span>
              <div>
                <strong>Your personal space</strong>
                <small>Saved on this device</small>
              </div>
              <Icon name="shield" size={15} />
            </div>
          </div>
        </aside>
        {menu && (
          <button
            className="sidebar-backdrop"
            aria-label="Close navigation"
            onClick={() => setMenu(false)}
          />
        )}
        <div className="main-shell">
          <header className="topbar">
            <div className="topbar-left">
              <button
                className="icon-button mobile-menu"
                aria-label="Open navigation"
                onClick={() => setMenu(true)}
              >
                <Icon name="menu" />
              </button>
              <span className="breadcrumb">
                Workspace<span>/</span>
                <strong>{titles[path] ?? "Page"}</strong>
              </span>
            </div>
            <div className="topbar-actions">
              {state.plan.confirmed && (
                <form
                  className="topbar-search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    navigate("/app/transactions");
                  }}
                >
                  <Icon name="search" size={16} />
                  <input
                    aria-label="Search your transactions"
                    placeholder="Search transactions…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <kbd>↵</kbd>
                </form>
              )}
              <span className="private-note">
                <Icon name="shield" size={14} />
                Private by default
              </span>
              <button
                className="topbar-profile"
                aria-label="Open your settings"
                onClick={() => nav("/app/settings")}
              >
                <span className="avatar small-avatar">Y</span>
                <span>You</span>
                <Icon name="chevron" size={12} />
              </button>
            </div>
          </header>
          <main
            id="main-content"
            className={`main-content ${path === "/" ? "landing-content" : ""}`}
          >
            {notice && (
              <div className="dismissable-notice">
                <Notice>{notice}</Notice>
                <button
                  className="icon-button"
                  aria-label="Dismiss notice"
                  onClick={() => setNotice("")}
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
            )}
            {saveError && (
              <Notice error>
                {saveError}
                <button
                  className="text-button"
                  onClick={() => setSaveError(saveState(state) ?? "")}
                >
                  Retry save
                </button>
              </Notice>
            )}
            {needsPlan ? (
              <section className="panel empty-state">
                <span className="empty-symbol">
                  <Icon name="wallet" size={36} />
                </span>
                <h1>A little clarity starts here.</h1>
                <p>
                  {state.transactions.length
                    ? "Your transactions are ready. Review and confirm the details to build your first plan."
                    : "Bring your transactions or try a sample to see what’s covered."}
                </p>
                <div className="inline-actions">
                  {state.transactions.length > 0 ? (
                    <Button onClick={() => nav("/setup/plan")}>
                      Continue setup
                    </Button>
                  ) : (
                    <>
                      <Button onClick={() => sample("A")}>
                        Try sample data
                      </Button>
                      <Button
                        kind="secondary"
                        onClick={() => nav("/setup/import")}
                      >
                        Import transactions
                      </Button>
                    </>
                  )}
                </div>
              </section>
            ) : path === "/" ? (
              <Landing />
            ) : path === "/setup/import" ? (
              <ImportScreen
                key={importKey}
                initialText={initialCsv}
                variant={variant}
              />
            ) : path === "/setup/plan" ? (
              <SetupScreen />
            ) : path === "/app" ? (
              <Dashboard />
            ) : path === "/app/bills" ? (
              <BillsScreen />
            ) : path === "/app/update" ? (
              <UpdateScreen />
            ) : path === "/app/settings" ? (
              <SettingsScreen />
            ) : path === "/app/transactions" ? (
              <TransactionsScreen key={search} search={search} />
            ) : (
              <section className="empty-state">
                <h1>This page wandered off.</h1>
                <p>Your plan is still right where you left it.</p>
                <Button
                  onClick={() => nav(state.plan.confirmed ? "/app" : "/")}
                >
                  Back to your space
                </Button>
              </section>
            )}
          </main>
          <footer className="app-footer">
            <span>Covered. A little more peace of mind.</span>
            <span>
              {state.plan.confirmed
                ? `${money(state.plan.balanceCents)} balance · ${dateLabel(today(), true)}`
                : "Your money. Your decisions."}
            </span>
          </footer>
        </div>
      </div>
      {assistant && (
        <Assistant
          close={() => setAssistant(false)}
          setup={path === "/setup/plan"}
        />
      )}{" "}
      {toastText && (
        <div className="toast" role="status">
          <Icon name="check" size={16} />
          {toastText}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToastText("")}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </AppContext.Provider>
  );
}
