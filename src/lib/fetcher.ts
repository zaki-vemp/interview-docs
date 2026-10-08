import { parseDoc } from './parseDoc';
import type { ParsedDoc } from './types';

const BASE = `${import.meta.env.BASE_URL}resources/`;

export const MANIFEST_URL = `${BASE}manifest.json`;
export const PROFILE_URL = `${BASE}profile.json`;
export const docUrl = (slug: string) => `${BASE}docs/${slug}.md`;

export class FetchError extends Error {
  status: number;
  constructor(url: string, status: number) {
    super(`Request for ${url} failed with HTTP ${status}`);
    this.name = 'FetchError';
    this.status = status;
  }
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new FetchError(url, res.status);
  // Vite's dev server answers unknown paths with index.html (SPA fallback)
  if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new FetchError(url, 404);
  return res;
}

export const jsonFetcher = async <T,>(url: string): Promise<T> => (await get(url)).json() as Promise<T>;

/** SWR fetcher for a doc URL: downloads the markdown and parses it into sections/questions. */
export const docFetcher = async (url: string): Promise<ParsedDoc> => {
  const slug = url.slice(url.lastIndexOf('/') + 1).replace(/\.md$/, '');
  const text = await (await get(url)).text();
  return parseDoc(text, slug);
};
