// Unified inline-SVG icon set. The workspace previously relied on Unicode
// symbols (▦ ◇ ↥ ⚙ …), which render inconsistently across platforms and
// fonts; these stroke-based glyphs stay crisp and share one visual language.
import type { CSSProperties } from 'react';

export type IconName =
  | 'grid' | 'list' | 'models' | 'data' | 'settings' | 'search' | 'plus' | 'minus'
  | 'close' | 'star' | 'starFilled' | 'duplicate' | 'export' | 'image' | 'branch'
  | 'tree' | 'up' | 'down' | 'left' | 'sparkle' | 'box' | 'edit' | 'download' | 'gallery' | 'extract'
  | 'sun' | 'moon' | 'sliders' | 'logs' | 'eye' | 'eyeOff' | 'github' | 'trash' | 'background';

const paths: Record<IconName, React.ReactNode> = {
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.8" cy="6" r="1.1" fill="currentColor" stroke="none" /><circle cx="4.8" cy="12" r="1.1" fill="currentColor" stroke="none" /><circle cx="4.8" cy="18" r="1.1" fill="currentColor" stroke="none" /></>,
  models: <><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="M12 12 20 7.5M12 12v9M12 12 4 7.5" /></>,
  data: <><path d="M12 3v11" /><path d="m7.5 9.5 4.5 4.5 4.5-4.5" /><path d="M4.5 17v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2" /></>,
  settings: <><circle cx="12" cy="12" r="3.1" /><path d="M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  star: <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8L12 3.6Z" />,
  starFilled: <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8L12 3.6Z" fill="currentColor" stroke="none" />,
  duplicate: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5" /></>,
  export: <><path d="M12 14V3.5" /><path d="m7.5 8 4.5-4.5L16.5 8" /><path d="M4.5 16v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3" /></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4.8 17.5 4-4.2 2.6 2.7 3.4-3.5 5 5" /></>,
  branch: <path d="M6.5 3.5v10a3 3 0 0 0 3 3h8m0 0-3-3m3 3-3 3" />,
  tree: <><circle cx="12" cy="5" r="2.2" /><circle cx="5.5" cy="18.5" r="2.2" /><circle cx="18.5" cy="18.5" r="2.2" /><path d="M12 7.2v3.3m0 0c0 2.4-4.7 2.6-5.9 5m5.9-5c0 2.4 4.7 2.6 5.9 5" /></>,
  up: <path d="M12 19V6m0 0-5.5 5.5M12 6l5.5 5.5" />,
  down: <path d="M12 5v13m0 0 5.5-5.5M12 18l-5.5-5.5" />,
  left: <path d="M19 12H6m0 0 5.5-5.5M6 12l5.5 5.5" />,
  sparkle: <path d="M12 4c.6 3.8 2 5.6 6 6.5-4 .9-5.4 2.7-6 6.5-.6-3.8-2-5.6-6-6.5 4-.9 5.4-2.7 6-6.5Z" />,
  box: <path d="M4.5 4.5h15v15h-15z" strokeDasharray="3.5 2.5" />,
  edit: <><path d="M4 20h4.2L19.6 8.6a1.9 1.9 0 0 0-2.7-2.7L5.5 17.3 4 20Z" /><path d="m14.5 8 2.5 2.5" /></>,
  download: <><path d="M12 3.5V14" /><path d="m7.5 9.5 4.5 4.5 4.5-4.5" /><path d="M4.5 17v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2" /></>,
  gallery: <><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><circle cx="9" cy="9" r="1.8" /><path d="m4.8 16.5 3.7-3.8 2.6 2.7 3.2-3.3 5 5" /></>,
  extract: <><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8.2 7.6 20 19M8.2 16.4 20 5M13 12l2 2" /></>,
  trash: <><path d="M4.5 7h15" /><path d="M9 7V4.5h6V7M7 7l.8 13h8.4L17 7" /><path d="M10 10.5v6M14 10.5v6" /></>,
  background: <><circle cx="12" cy="8" r="3" /><path d="M6.5 20c.4-4 2.2-6 5.5-6s5.1 2 5.5 6" /><path d="M4 7V4h3M17 4h3v3M4 17v3h3M17 20h3v-3" strokeDasharray="2.5 2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.2 5.2l1.9 1.9M16.9 16.9l1.9 1.9M18.8 5.2l-1.9 1.9M7.1 16.9l-1.9 1.9" /></>,
  moon: <path d="M20 13.2A8.2 8.2 0 0 1 10.8 4a8.2 8.2 0 1 0 9.2 9.2Z" />,
  sliders: <><path d="M5 21v-7M5 10V3M12 21v-9M12 8V3M19 21v-5M19 12V3" /><path d="M2.5 14h5M9.5 8h5M16.5 16h5" /></>,
  logs: <><path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5Z" /><path d="m6.5 14 2.7-3 2.4 2.1 3.2-4.1 2.7 2.2" /><path d="M7 17h10" /></>,
  eye: <><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.6" /></>,
  eyeOff: <><path d="m3.5 3.5 17 17" /><path d="M10.3 6.2A10.4 10.4 0 0 1 12 6c6.1 0 9.5 6 9.5 6a15.2 15.2 0 0 1-2.4 3.1M6.1 7.1A15.4 15.4 0 0 0 2.5 12s3.4 6 9.5 6a10 10 0 0 0 3-.5" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  github: <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" fill="currentColor" stroke="none" />,
};

export function Icon({ name, size = 16, strokeWidth = 1.7, style, className }: { name: IconName; size?: number; strokeWidth?: number; style?: CSSProperties; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flex: '0 0 auto', ...style }}
    >
      {paths[name]}
    </svg>
  );
}
