import type { CSSProperties } from "react";
const paths: Record<string, React.ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  wallet: (
    <>
      <path d="M20 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h15V8H5a3 3 0 0 1 0-6" />
      <path d="M16 12h5v5h-5a2.5 2.5 0 0 1 0-5Z" />
    </>
  ),
  bill: (
    <>
      <path d="M6 3h12v19l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6m-6 4h6m-6 4h3" />
    </>
  ),
  chart: (
    <>
      <path d="M4 3v17h17M8 15v-4m5 4V7m5 8V4" />
    </>
  ),
  settings: (
    <>
      <path d="m10 3-1 3-3 1-3 3 2 2-1 3 3 3 3-1 2 2 3-1 1-3 3-1v-4l-3-1-1-3Z" />
      <circle cx="11" cy="11" r="3" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
      <path d="m20 2 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  left: <path d="M20 12H4m6-6-6 6 6 6" />,
  up: <path d="M7 17 17 7M7 7h10v10" />,
  down: <path d="M7 7 17 17M7 17h10V7" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  plus: <path d="M12 4v16M4 12h16" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  upload: (
    <>
      <path d="M4 15v5h16v-5M12 16V3m-5 5 5-5 5 5" />
    </>
  ),
  download: (
    <>
      <path d="M4 15v5h16v-5M12 3v13m-5-5 5 5 5-5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v1" />
    </>
  ),
  home: (
    <>
      <path d="m3 10 9-7 9 7v11h-7v-7h-4v7H3V10Z" />
    </>
  ),
  car: (
    <>
      <path d="m5 7 2-4h10l2 4 2 4v7H3v-7l2-4ZM3 10h18M6 18v3m12-3v3M6 14h2m8 0h2" />
    </>
  ),
  wifi: (
    <>
      <path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0m-10 4a5 5 0 0 1 6 0" />
      <circle cx="12" cy="20" r=".7" />
    </>
  ),
  bag: (
    <>
      <path d="M4 7h16l-1 14H5L4 7Z" />
      <path d="M8 8V6a4 4 0 0 1 8 0v2" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  edit: (
    <>
      <path d="m14 4 6 6-11 11H3v-6L14 4Zm-3 3 6 6" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 3h6m-9 3 1 15h10l1-15M10 10v7m4-7v7" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M5 8a8 8 0 0 1 14-3l1 2M4 17l1 2a8 8 0 0 0 14-3" />
    </>
  ),
  logout: (
    <>
      <path d="M9 4H4v16h5m4-13 5 5-5 5m-5-5h14" />
    </>
  ),
  send: (
    <>
      <path d="m3 3 18 9-18 9 4-9-4-9ZM7 12h14" />
    </>
  ),
  dots: (
    <>
      <circle cx="12" cy="4" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="20" r="1" />
    </>
  ),
};
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {paths[name] ?? paths.bill}
    </svg>
  );
}
export const billIcon = (name: string) =>
  /rent|mortgage/i.test(name)
    ? "home"
    : /car|insurance/i.test(name)
      ? "car"
      : /internet|phone|wifi/i.test(name)
        ? "wifi"
        : "bill";
