import useSWR, { preload, useSWRConfig } from 'swr';
import useSWRImmutable from 'swr/immutable';
import { useMemo } from 'react';
import { MANIFEST_URL, PROFILE_URL, docFetcher, docUrl, jsonFetcher } from '../lib/fetcher';
import type { Category, DocMeta, Manifest, ParsedDoc, Profile } from '../lib/types';

export function useManifest() {
  return useSWR<Manifest>(MANIFEST_URL, jsonFetcher, { revalidateOnFocus: false, dedupingInterval: 60_000 });
}

export function useProfile() {
  return useSWRImmutable<Profile>(PROFILE_URL, jsonFetcher);
}

/** One parsed doc. Doc content is immutable for a session, so no revalidation. */
export function useDoc(slug: string | undefined) {
  return useSWRImmutable<ParsedDoc>(slug ? docUrl(slug) : null, docFetcher);
}

/** Warm the SWR cache when the user hovers a link. */
export const prefetchDoc = (slug: string) => {
  // best effort: a failed prefetch is retried (and reported) when the doc is actually opened
  preload(docUrl(slug), docFetcher).catch(() => {});
};

export interface FlatDoc extends DocMeta {
  category: Category;
}

export function useFlatDocs() {
  const { data } = useManifest();
  return useMemo<FlatDoc[]>(
    () => (data ? data.categories.flatMap((c) => c.docs.map((d) => ({ ...d, category: c }))) : []),
    [data],
  );
}

/**
 * Every doc at once (search, practice, bookmarks). Each parsed doc is also
 * written into its own SWR cache entry, so opening a doc afterwards is instant.
 */
export function useAllDocs() {
  const docs = useFlatDocs();
  const { mutate } = useSWRConfig();
  const key = docs.length ? ['all-docs', ...docs.map((d) => d.slug)] : null;
  return useSWRImmutable<ParsedDoc[]>(key, async ([, ...slugs]: string[]) => {
    const parsed = await Promise.all(
      slugs.map(async (slug) => {
        try {
          return await docFetcher(docUrl(slug));
        } catch {
          return null;
        }
      }),
    );
    const ok = parsed.filter((d): d is ParsedDoc => d !== null);
    ok.forEach((d) => void mutate(docUrl(d.slug), d, { revalidate: false }));
    return ok;
  });
}
