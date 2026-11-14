import { createContext, useContext } from "react";
import type { AppState, ISODate } from "../lib/finance";
import type { Route } from "../lib/client/router";
import type { AssistantResponse } from "../lib/schemas/assistant";
import type { ClientErrorCode } from "../lib/client/assistant";

export interface PendingImport {
  fileName: string;
  text: string;
  isSample: boolean;
}

export type ProposalUiStatus = "pending" | "applied" | "already_applied" | "stale" | "invalid" | "discarded";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  response?: AssistantResponse;
  error?: { code: ClientErrorCode; title: string; action: string };
  proposalStatus?: ProposalUiStatus;
  proposalNote?: string;
}

export interface AppCtx {
  state: AppState;
  getState: () => AppState;
  commit: (next: AppState) => void;
  today: ISODate;
  route: Route;
  navigate: (to: Route) => void;
  pending: PendingImport | null;
  setPending: (p: PendingImport | null) => void;
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  ask: (text: string) => void;
  requestConsent: () => Promise<boolean>;
  flash: (message: string) => void;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext missing");
  return ctx;
}
