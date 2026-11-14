import { useCallback, useEffect, useState } from "react";

export const ROUTES = ["/", "/setup/import", "/setup/plan", "/app", "/app/bills", "/app/update", "/app/settings"] as const;
export type Route = (typeof ROUTES)[number];

export function normalizePath(pathname: string): Route {
  const clean = pathname.replace(/\/+$/, "") || "/";
  return (ROUTES as readonly string[]).includes(clean) ? (clean as Route) : "/";
}

/** Tiny client router on the History API, so the same screens run in Next.js and in the test harness. */
export function useRoute(): { route: Route | null; navigate: (to: Route, opts?: { replace?: boolean }) => void } {
  const [route, setRoute] = useState<Route | null>(null);
  useEffect(() => {
    const sync = () => setRoute(normalizePath(window.location.pathname));
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const navigate = useCallback((to: Route, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState(null, "", to);
    else if (window.location.pathname !== to) window.history.pushState(null, "", to);
    setRoute(to);
    window.scrollTo(0, 0);
  }, []);
  return { route, navigate };
}
