// Unified inline-SVG icon set. The workspace previously relied on Unicode
// symbols (▦ ◇ ↥ ⚙ …), which render inconsistently across platforms and
// fonts; these stroke-based glyphs stay crisp and share one visual language.
import type { CSSProperties } from 'react';

export type IconName =
  | 'grid' | 'list' | 'models' | 'data' | 'settings' | 'search' | 'plus' | 'minus'
  | 'close' | 'star' | 'starFilled' | 'duplicate' | 'export' | 'image' | 'branch'
  | 'tree' | 'up' | 'down' | 'left' | 'sparkle' | 'box' | 'edit' | 'download' | 'gallery';

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
