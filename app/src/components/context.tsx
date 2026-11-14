import { createContext, useContext } from "react";
import type { AppState } from "@/lib/client/model";
export type AppContextValue = {
  state: AppState;
  change: (updater: (state: AppState) => AppState) => void;
  navigate: (path: string) => void;
  toast: (text: string) => void;
  openAssistant: () => void;
  sample: (variant: "A" | "B") => void;
};
export const AppContext = createContext<AppContextValue>(null!);
export const useApp = () => useContext(AppContext);
