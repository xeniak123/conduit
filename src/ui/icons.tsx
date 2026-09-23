/** Line icons at a single 1.6px weight, so nothing looks heavier than the type. */

const base = {
  width: 17,
  height: 17,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const Icon = {
  clock: () => (
    <svg {...base}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  terminal: () => (
    <svg {...base}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M7.5 9.5l3 2.5-3 2.5M12.5 15h4" />
    </svg>
  ),
  brain: () => (
    <svg {...base}>
      <path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.5A3 3 0 0 0 7 18a2.5 2.5 0 0 0 5 .5V6a1.5 1.5 0 0 0-3-1.5zM15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.5A3 3 0 0 1 17 18a2.5 2.5 0 0 1-5 .5" />
    </svg>
  ),
  plus: () => (
    <svg {...base}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  settings: () => (
    <svg {...base}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  mic: () => (
    <svg {...base}>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
    </svg>
  ),
  send: () => (
    <svg {...base} width="16" height="16">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  ),
  stop: () => (
    <svg {...base} width="15" height="15">
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  chevron: () => (
    <svg {...base} width="15" height="15">
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  close: () => (
    <svg {...base} width="16" height="16">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  minimise: () => (
    <svg {...base} width="15" height="15">
      <path d="M5 12h14" />
    </svg>
  ),
  maximise: () => (
    <svg {...base} width="14" height="14">
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
    </svg>
  ),
  trash: () => (
    <svg {...base} width="15" height="15">
      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />
    </svg>
  ),
  display: () => (
    <svg {...base}>
      <rect x="2" y="4" width="20" height="13" rx="2.5" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
  sliders: () => (
    <svg {...base}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="16" cy="18" r="2" />
    </svg>
  ),
  cpu: () => (
    <svg {...base}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </svg>
  ),
  wrench: () => (
    <svg {...base}>
      <path d="M14.7 6.3a4 4 0 0 0 5 5L21 19a2 2 0 0 1-3 3l-7.7-9.3a4 4 0 0 0-5-5L9 5 5 9 3 7a4 4 0 0 1 5.7-5.7z" />
    </svg>
  ),
  download: () => (
    <svg {...base} width="15" height="15">
      <path d="M12 3v12M7 11l5 5 5-5M4 20h16" />
    </svg>
  ),
  file: () => (
    <svg {...base} width="14" height="14">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  ),
  image: () => (
    <svg {...base} width="14" height="14">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17l5-5 4 4 2.5-2.5L20 17" />
    </svg>
  ),
  shield: () => (
    <svg {...base}>
      <path d="M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z" />
      <path d="M9.2 12.2l2 2 3.6-3.8" />
    </svg>
  ),
  folder: () => (
    <svg {...base}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2a2 2 0 0 1 1.6.8l.9 1.2h7.3A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
    </svg>
  ),
  chart: () => (
    <svg {...base}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  ),
  check: () => (
    <svg {...base} width="13" height="13" strokeWidth="2.1">
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  ),
  search: () => (
    <svg {...base} width="14" height="14">
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5L21 21" />
    </svg>
  ),
  plug: () => (
    <svg {...base}>
      <path d="M9 2v6M15 2v6" />
      <path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6z" />
      <path d="M12 17v5" />
    </svg>
  ),
  book: () => (
    <svg {...base}>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H11a2 2 0 0 1 2 2v15a1.6 1.6 0 0 0-1.6-1.6H5.5A1.5 1.5 0 0 1 4 17.9z" />
      <path d="M20 4.5A1.5 1.5 0 0 0 18.5 3H13a2 2 0 0 0-2 2v15a1.6 1.6 0 0 1 1.6-1.6h5.9a1.5 1.5 0 0 0 1.5-1.5z" />
    </svg>
  ),
  bookmark: () => (
    <svg {...base}>
      <path d="M7 3.5h10a1 1 0 0 1 1 1V21l-6-4-6 4V4.5a1 1 0 0 1 1-1z" />
    </svg>
  ),
  store: () => (
    <svg {...base}>
      <path d="M4 4h16l1 5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" />
      <path d="M5 11v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" />
      <path d="M10 20v-5h4v5" />
    </svg>
  ),
  bolt: () => (
    <svg {...base}>
      <path d="M13 2L5 13h6l-1 9 8-11h-6z" />
    </svg>
  ),
  refresh: () => (
    <svg {...base} width="15" height="15">
      <path d="M20 11a8 8 0 1 0-1.6 6" />
      <path d="M20 4v7h-7" />
    </svg>
  ),
  link: () => (
    <svg {...base} width="15" height="15">
      <path d="M10 13a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.3 1.3" />
      <path d="M14 11a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.3-1.3" />
    </svg>
  ),
  pause: () => (
    <svg {...base} width="14" height="14">
      <rect x="6.5" y="5" width="3.4" height="14" rx="1.4" fill="currentColor" stroke="none" />
      <rect x="14.1" y="5" width="3.4" height="14" rx="1.4" fill="currentColor" stroke="none" />
    </svg>
  ),
  play: () => (
    <svg {...base} width="14" height="14">
      <path d="M7 4.8l12 7.2-12 7.2z" fill="currentColor" stroke="none" />
    </svg>
  ),
  grid: () => (
    <svg {...base}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
    </svg>
  ),
  globe: () => (
    <svg {...base}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5z" />
    </svg>
  ),
  compose: () => (
    <svg {...base}>
      <path d="M12 4.5H6.5A2.5 2.5 0 0 0 4 7v10.5A2.5 2.5 0 0 0 6.5 20H17a2.5 2.5 0 0 0 2.5-2.5V12" />
      <path d="M17.6 3.9a1.9 1.9 0 0 1 2.7 2.7L12.7 14.2 9.5 15l.8-3.2z" />
    </svg>
  ),
  cloud: () => (
    <svg {...base}>
      <path d="M7 18.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.5a4.5 4.5 0 0 0 0 9z" />
    </svg>
  ),
  heart: () => (
    <svg {...base} width="13" height="13">
      <path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z" />
    </svg>
  ),
  arrowDown: () => (
    <svg {...base} width="13" height="13">
      <path d="M12 4v15M6 13l6 6 6-6" />
    </svg>
  ),
  eject: () => (
    <svg {...base} width="15" height="15">
      <path d="M12 5l7 8H5z" />
      <path d="M5 18h14" />
    </svg>
  ),
  key: () => (
    <svg {...base} width="15" height="15">
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8-8M16 7l2.5 2.5M14 9l2 2" />
    </svg>
  ),
  gauge: () => (
    <svg {...base} width="15" height="15">
      <path d="M4.5 17a8 8 0 1 1 15 0" />
      <path d="M12 13l3.5-4" />
    </svg>
  ),
  external: () => (
    <svg {...base} width="13" height="13">
      <path d="M14 4h6v6M20 4l-9 9M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </svg>
  ),
  copy: () => (
    <svg {...base} width="14" height="14">
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
    </svg>
  ),
  arrowLeft: () => (
    <svg {...base} width="15" height="15">
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  ),
  sparkle: () => (
    <svg {...base}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    </svg>
  ),
};
