import type { SVGProps } from "react";

export type IconName =
  | "admin"
  | "alert"
  | "arrowRight"
  | "chart"
  | "check"
  | "close"
  | "home"
  | "info"
  | "logout"
  | "menu"
  | "play"
  | "plus"
  | "refresh"
  | "settings"
  | "tools"
  | "training"
  | "upload"
  | "user";

const paths: Record<IconName, React.ReactNode> = {
  admin: <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 5V3h8v2M8 10h8M8 14h5"/></>,
  alert: <><path d="M12 3 2.8 19h18.4z"/><path d="M12 9v4m0 3v.01"/></>,
  arrowRight: <><path d="M5 12h14m-5-5 5 5-5 5"/></>,
  chart: <><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/></>,
  logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4m4-4H9"/></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  play: <path d="m8 5 11 7-11 7z"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  refresh: <><path d="M20 7v5h-5"/><path d="M18.5 9A7 7 0 1 0 19 15"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.8-1.8l.9-1.9-2.2-2.2-1.9.9a7 7 0 0 0-1.8-.8L10.5 2h-3l-.7 2a7 7 0 0 0-1.8.8l-1.9-.9L.9 6.1 1.8 8a7 7 0 0 0-.8 1.8l-2 .7v3l2 .7a7 7 0 0 0 .8 1.8l-.9 1.9 2.2 2.2 1.9-.9a7 7 0 0 0 1.8.8l.7 2h3l.7-2a7 7 0 0 0 1.8-.8l1.9.9 2.2-2.2-.9-1.9a7 7 0 0 0 .8-1.8z" transform="translate(3 0) scale(.75)"/></>,
  tools: <><path d="m14 7 3-3 3 3-3 3M4 20l8.5-8.5"/><path d="M13 5.5A5 5 0 0 0 6.5 12L3 15.5 6.5 19l3.5-3.5A5 5 0 0 0 16.5 9"/></>,
  training: <><path d="M4 5h16v11H4z"/><path d="M8 20h8M12 16v4m-3-9 2 2 4-5"/></>,
  upload: <><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M4 14v6h16v-6"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{paths[name]}</svg>;
}
