/** Small line icons for the POS, drawn in the text colour, so buttons look the same on every device (no emoji). */
const PATHS = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V20h5v-6h4v6h5V9.5",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0",
  dine: "M7 3v8m-2-8v4a2 2 0 0 0 4 0V3M7 11v10m10-18c-1.7 0-3 2-3 5s1.3 4 3 4m0-9v18",
  bag: "M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2",
  list: "M4 6h16M4 12h16M4 18h16",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 3-4.3-4.3",
  print: "M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7v-7Z",
  check: "m5 12.5 4.5 4.5L19 7.5",
  cash: "M3 7h18v10H3V7Zm9 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6 10v.01M18 14v.01",
  pause: "M9 5v14M15 5v14",
  x: "M6 6l12 12M18 6 6 18",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  trash: "M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3",
  pencil: "M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6.5 6.5 0 0 1 3.5 6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
