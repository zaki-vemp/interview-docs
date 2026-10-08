export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/`/g, '')
      .replace(/&[a-z]+;/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'item'
  );
}
