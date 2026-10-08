import { slugify } from './slugify';
import type { ParsedDoc, ParsedQuestion, ParsedSection } from './types';

const HOT = /\s*🔥\s*$/;

/**
 * Doc format (markdown):
 *   # Title                       -> doc title (optional, manifest wins)
 *   intro text                    -> doc intro
 *   ## Section                    -> section
 *   section intro                 -> section intro
 *   ### Question text 🔥          -> question (🔥 = frequently asked)
 *   answer markdown               -> question body
 * Headings inside fenced code blocks are ignored.
 */
export function parseDoc(markdown: string, slug: string): ParsedDoc {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let title = slug;
  const intro: string[] = [];
  const sections: ParsedSection[] = [];
  const usedIds = new Set<string>();
  let section: (ParsedSection & { buf: string[] }) | null = null;
  let question: (ParsedQuestion & { buf: string[] }) | null = null;
  let fence: string | null = null;

  const uniqueId = (base: string) => {
    let id = base;
    for (let i = 2; usedIds.has(id); i++) id = `${base}-${i}`;
    usedIds.add(id);
    return id;
  };

  const closeQuestion = () => {
    if (question && section) {
      question.body = question.buf.join('\n').trim();
      section.questions.push(stripBuf(question));
    }
    question = null;
  };
  const closeSection = () => {
    closeQuestion();
    if (section) {
      section.intro = section.buf.join('\n').trim();
      sections.push(stripBuf(section));
    }
    section = null;
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, '') === '') fence = null;
    }
    if (!fence && !fenceMatch) {
      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        const level = h[1].length;
        const text = h[2].trim();
        if (level === 1) {
          title = text;
          continue;
        }
        if (level === 2) {
          closeSection();
          section = { id: uniqueId(slugify(text)), title: text, intro: '', questions: [], buf: [] };
          continue;
        }
        if (level === 3) {
          closeQuestion();
          if (!section) section = { id: uniqueId('overview'), title: 'Overview', intro: '', questions: [], buf: [] };
          const hot = HOT.test(text);
          const clean = text.replace(HOT, '').trim();
          const id = uniqueId(slugify(clean));
          question = { id, key: `${slug}/${id}`, title: clean, hot, body: '', sectionId: section.id, buf: [] };
          continue;
        }
      }
    }
    if (question) (question as { buf: string[] }).buf.push(line);
    else if (section) (section as { buf: string[] }).buf.push(line);
    else intro.push(line);
  }
  closeSection();

  const questions = sections.flatMap((s) => s.questions);
  return {
    slug,
    title,
    intro: intro.join('\n').trim(),
    sections,
    questions,
    words: markdown.split(/\s+/).length,
  };
}

function stripBuf<T extends { buf: string[] }>(o: T): Omit<T, 'buf'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { buf: _buf, ...rest } = o;
  return rest;
}
