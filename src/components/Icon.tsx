import type { ReactNode, SVGProps } from 'react';

const paths = {
  book: (
    <>
      <path d="M12 7v14m0-14C9 4 5 4 2 5v14c3-1 7-1 10 2 3-3 7-3 10-2V5c-3-1-7-1-10 2Z" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="7" />
      <path d="m16 16 5 5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h6m4 0h6M4 17h10m4 0h2" />
      <circle cx="12" cy="7" r="2" />
      <circle cx="16" cy="17" r="2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  moon: <path d="M21 13A9 9 0 0 1 11 3 9 9 0 1 0 21 13Z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  external: <path d="M6 18 18 6M6 6h12v12" />,
  check: <path d="m5 12 4 4L19 6" />,
  review: <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" />,
  bookmark: <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4-6 4Z" />,
  leaf: (
    <>
      <path d="M20 3C12 3 4 5 4 12a7 7 0 0 0 7 7c7 0 9-8 9-16Z" />
      <path d="M3 21 15 9" />
    </>
  ),
  play: <path d="m8 4 12 8-12 8V4Z" />,
  code: <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </>
  ),
  cloud: <path d="M6 18a4 4 0 0 1-1-8 6 6 0 0 1 11-3 5.5 5.5 0 1 1 2 11H6Z" />,
  radio: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16M20 4a11 11 0 0 1 0 16" />
    </>
  ),
  branch: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M6 7v10m12-10a10 10 0 0 1-10 10" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
    </>
  ),
  link: (
    <>
      <path
        d="m10 14 4-4m-6 6-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"
        transform="translate(2 -2)"
      />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
const categories: Record<string, IconName> = {
  profile: 'user',
  js: 'code',
  frameworks: 'layers',
  realtime: 'radio',
  web: 'globe',
  backend: 'cloud',
  databases: 'database',
  'backend-deep': 'settings',
  dsa: 'branch',
};
export const categoryIcon = (id: string): IconName => categories[id] ?? 'book';
