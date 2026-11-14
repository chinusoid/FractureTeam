import { AppStateSchema, emptyState, type AppState } from "../client/model";
const KEY = "covered:v1";
export function loadState(): {
  state: AppState;
  notice?: string;
  storageError?: boolean;
} {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { state: emptyState() };
    try {
      return { state: AppStateSchema.parse(JSON.parse(raw)) };
    } catch {
      try {
        localStorage.setItem(`${KEY}:backup:${Date.now()}`, raw);
        localStorage.removeItem(KEY);
      } catch {
        return {
          state: emptyState(),
          notice:
            "Saved data could not be read or backed up. Export your current work before closing this tab.",
          storageError: true,
        };
      }
      return {
        state: emptyState(),
        notice:
          "Saved data was damaged. A backup was kept in this browser; a fresh plan is ready.",
      };
    }
  } catch {
    return {
      state: emptyState(),
      notice:
        "Browser storage is unavailable. Your changes will last only for this visit. Enable storage or export your data.",
      storageError: true,
    };
  }
}
export function saveState(state: AppState): string | null {
  try {
    AppStateSchema.parse(state);
    localStorage.setItem(KEY, JSON.stringify(state));
    return null;
  } catch {
    return "Your changes could not be saved. Enable browser storage, free some space, or export your data before leaving.";
  }
}
export function clearState(): boolean {
  try {
    for (const key of Object.keys(localStorage).filter((key) =>
      key.startsWith("covered:"),
    ))
      localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
