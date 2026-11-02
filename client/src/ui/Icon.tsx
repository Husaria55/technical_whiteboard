import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  select: <path d="M5 3l14 8-6 1.5L10 19z" />,
  hand: (
    <path d="M8 12V5.5a1.5 1.5 0 013 0V11m0-6.5a1.5 1.5 0 013 0V11m0-5a1.5 1.5 0 013 0v6m-9 0V8.5a1.5 1.5 0 00-3 0V14a7 7 0 0014 0v-3a1.5 1.5 0 00-3 0" />
  ),
  pen: <path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" />,
  highlighter: <path d="M9 15l-3 5h6l1-2M9 15l8-11 4 3-8 11zM9 15l4 3" />,
  eraser: <path d="M7 20h12M5 15l9-10 6 6-9 9H9zM9 11l6 6" />,
  line: <path d="M5 19L19 5" />,
  arrow: <path d="M5 19L19 5M10 5h9v9" />,
  rect: <rect x="4" y="6" width="16" height="12" rx="1" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />,
  triangle: <path d="M12 4l9 16H3z" />,
  polygon: <path d="M5 8l6-4 8 5-2 10H7z" />,
  ngon: <path d="M12 3l8 4.6v8.8L12 21l-8-4.6V7.6z" />,
  arc: <path d="M4 18a8 8 0 0116 0M12 18V18" />,
  compass: <path d="M12 3v3M12 6l-6 15M12 6l6 15M8 15h8" />,
  text: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  math: <path d="M4 5h8l-5 7 5 7H4M15 9l5 6M20 9l-5 6" />,
  graph: <path d="M4 3v18h17M7 16c3-9 6-9 8-4s3 3 5-3" />,
  measure: <path d="M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2" />,
  ruler: <path d="M3 8h18v8H3zM7 8v4M11 8v3M15 8v4M19 8v3" />,
  protractor: <path d="M3 17a9 9 0 0118 0zM12 17l5-6M12 17V13" />,
  square45: <path d="M5 4v15h15zM9 11v4h4" />,
  square60: <path d="M5 8v11h15zM8 15v1h1" />,
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 16l5-5 4 4 3-3 6 6" />
      <circle cx="16" cy="9" r="1.5" />
    </>
  ),
  pdf: <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h4" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 017.5-2" />
    </>
  ),
  share: <path d="M16 6l-8 5 8 5M18 3a3 3 0 110 6 3 3 0 010-6zM6 8.5a3 3 0 110 6 3 3 0 010-6zM18 15a3 3 0 110 6 3 3 0 010-6z" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  upload: <path d="M12 20V9M7 14l5-5 5 5M5 4h14" />,
  pages: (
    <>
      <rect x="7" y="3" width="13" height="16" rx="1" />
      <path d="M4 7v14h12" />
    </>
  ),
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 015 0c0 2-2.5 2-2.5 4M12 17v.5" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  theme: <path d="M12 3a9 9 0 100 18 7 7 0 010-18z" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  shapes: (
    <>
      <rect x="3" y="11" width="9" height="9" rx="1" />
      <circle cx="16" cy="8" r="5" />
    </>
  ),
  instruments: <path d="M3 17L17 3l4 4L7 21zM12 8l2 2" />,
  touch: <path d="M9 11V5.5a1.5 1.5 0 013 0V12m0-2a1.5 1.5 0 013 0v2m0-1a1.5 1.5 0 013 0v4a6 6 0 01-6 6h-1a6 6 0 01-5-3l-2-4a1.5 1.5 0 012.5-1.5L9 15" />,
  style: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="8.5" cy="10" r="1.2" />
      <circle cx="12" cy="7.5" r="1.2" />
      <circle cx="15.5" cy="10" r="1.2" />
    </>
  ),
};

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.help}
    </svg>
  );
}
