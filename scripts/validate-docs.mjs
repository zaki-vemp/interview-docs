#!/usr/bin/env node
/**
 * Validates every doc listed in public/resources/manifest.json:
 *   - the markdown file exists, fences are balanced, there are questions
 *   - every ```js / ```ts code block actually runs (same runtime as the playground)
 *     and every test() inside it passes
 *
 * Usage:
 *   node scripts/validate-docs.mjs                 # validate all docs
 *   node scripts/validate-docs.mjs machine-coding  # only some docs
 *   node scripts/validate-docs.mjs --write         # also write question counts into the manifest
 *   node scripts/validate-docs.mjs --show js-output-questions   # print console output of each block
 *
 * A block containing the comment "@skip-validate" is not executed.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { transform } from 'sucrase';
import {
  createConsole,
  createTestApi,
  createTimerTracker,
  describeError,
  dsaHelpers,
  stripModuleSyntax,
  userLine,
} from '../src/playground/runtimeCore.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resDir = path.join(root, 'public', 'resources');
const manifestPath = path.join(resDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const SHOW = args.includes('--show');
const only = args.filter((a) => !a.startsWith('--'));

const RUNNABLE = { js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts' };

let pendingAsyncErrors = [];
process.on('unhandledRejection', (r) => pendingAsyncErrors.push(`Unhandled rejection: ${describeError(r)}`));
process.on('uncaughtException', (e) => pendingAsyncErrors.push(`Uncaught: ${describeError(e)}`));

function scan(markdown) {
  const lines = markdown.split('\n');
  let fence = null;
  let fenceStart = 0;
  let lang = '';
  let buf = [];
  const blocks = [];
  let questions = 0;
  let hot = 0;
  let sections = 0;
  lines.forEach((line, i) => {
    const m = line.match(/^\s*(```+|~~~+)\s*([\w-]*)/);
    if (m) {
      if (!fence) {
        fence = m[1];
        fenceStart = i + 1;
        lang = (m[2] || '').toLowerCase();
        buf = [];
        return;
      }
      if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, '') === '') {
        blocks.push({ lang, code: buf.join('\n'), line: fenceStart });
        fence = null;
        return;
      }
    }
    if (fence) {
      buf.push(line);
      return;
    }
    if (/^###\s+/.test(line)) {
      questions++;
      if (/🔥\s*$/.test(line)) hot++;
    } else if (/^##\s+/.test(line)) sections++;
  });
  return { blocks, questions, hot, sections, unclosedFence: fence ? fenceStart : null, words: markdown.split(/\s+/).length };
}

async function runBlock(code, lang) {
  const out = [];
  const errors = [];
  const tests = [];
  let js = code;
  if (lang === 'ts') js = transform(code, { transforms: ['typescript'], disableESTransforms: true }).code;
  js = stripModuleSyntax(js).code;

  const timers = createTimerTracker({ setTimeout, clearTimeout, setInterval, clearInterval });
  const api = createTestApi();
  const sandbox = {
    console: createConsole((e) => {
      if (e.kind === 'log') out.push(`${'  '.repeat(e.group)}${e.level === 'log' ? '' : `[${e.level}] `}${e.text}`);
      else if (e.kind === 'table') out.push(`[table] ${e.head.join(' | ')}\n${e.rows.map((r) => '        ' + r.join(' | ')).join('\n')}`);
    }, () => performance.now()),
    ...timers.wrapped,
    ...dsaHelpers,
    test: api.test,
    it: api.it,
    describe: api.describe,
    beforeEach: api.beforeEach,
    afterEach: api.afterEach,
    expect: api.expect,
    assert: api.assert,
    jest: { fn: api.fn },
    vi: { fn: api.fn },
    queueMicrotask,
    structuredClone,
    performance,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    EventTarget,
    Event,
    Blob,
    crypto: globalThis.crypto,
    atob,
    btoa,
    fetch: async () => {
      throw new Error('fetch is disabled in the validator');
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('globalThis.window = globalThis; globalThis.global = globalThis; globalThis.self = globalThis;', ctx);

  pendingAsyncErrors = [];
  let offset = 0;
  try {
    let script;
    try {
      script = new vm.Script(js, { filename: 'user-code.js' });
    } catch (err) {
      // same strategy as the playground worker: fall back to an async body (top-level await)
      try {
        script = new vm.Script(`(async () => {\n${js}\n})()`, { filename: 'user-code.js' });
        offset = 1;
      } catch {
        throw err;
      }
    }
    const result = script.runInContext(ctx, { timeout: 5000 });
    if (offset) await result;
    for (let round = 0; round < 20; round++) {
      await api.runPending((r) => tests.push(r), (e) => userLine(e, offset));
      const t0 = Date.now();
      while ((timers.pendingCount() > 0) && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 10));
      if (timers.pendingCount() > 0) {
        errors.push('timers still pending after 8s');
        break;
      }
      if (tests.length >= api.count()) break;
    }
    await new Promise((r) => setTimeout(r, 0));
  } catch (err) {
    const line = userLine(err, offset);
    errors.push(`${describeError(err)}${line ? ` (block line ${line})` : ''}`);
  }
  errors.push(...pendingAsyncErrors);
  return { out, errors, tests };
}

const counts = {};
let failures = 0;
let blocksRun = 0;
let testsRun = 0;

for (const cat of manifest.categories) {
  for (const doc of cat.docs) {
    if (only.length && !only.includes(doc.slug)) continue;
    const file = path.join(resDir, 'docs', `${doc.slug}.md`);
    if (!fs.existsSync(file)) {
      console.log(`✗ ${doc.slug}: missing file`);
      failures++;
      continue;
    }
    const md = fs.readFileSync(file, 'utf8');
    const info = scan(md);
    counts[doc.slug] = info;
    const problems = [];
    if (info.unclosedFence) problems.push(`unclosed code fence opened at line ${info.unclosedFence}`);
    if (!info.questions) problems.push('no ### questions found');

    for (const b of info.blocks) {
      const lang = RUNNABLE[b.lang];
      if (!lang || b.code.includes('@skip-validate')) continue;
      blocksRun++;
      const { out, errors, tests } = await runBlock(b.code, lang);
      testsRun += tests.length;
      const failed = tests.filter((t) => t.status === 'fail');
      if (SHOW) {
        console.log(`\n--- ${doc.slug}.md:${b.line} (${lang}) ---`);
        console.log(out.join('\n'));
        tests.forEach((t) => console.log(`  ${t.status === 'pass' ? '✓' : t.status === 'fail' ? '✗' : '○'} ${t.name}${t.error ? `\n      ${t.error.split('\n').join('\n      ')}` : ''}`));
      }
      for (const e of errors) problems.push(`code block at line ${b.line}: ${e}`);
      for (const t of failed) problems.push(`code block at line ${b.line}: test "${t.name}" failed: ${t.error?.split('\n').slice(0, 4).join(' | ')}`);
    }

    if (problems.length) {
      failures += problems.length;
      console.log(`✗ ${doc.slug} (${info.questions} questions)`);
      problems.forEach((p) => console.log(`    - ${p}`));
    } else {
      console.log(`✓ ${doc.slug}: ${info.sections} sections, ${info.questions} questions (${info.hot} hot), ${info.words} words`);
    }
  }
}

if (WRITE) {
  for (const cat of manifest.categories) {
    for (const doc of cat.docs) {
      const c = counts[doc.slug];
      if (!c) continue;
      doc.questions = c.questions;
      doc.hot = c.hot;
      doc.minutes = Math.max(5, Math.round(c.words / 180 / 5) * 5);
    }
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('manifest.json updated with question counts');
}

const totalQ = Object.values(counts).reduce((n, c) => n + c.questions, 0);
const totalW = Object.values(counts).reduce((n, c) => n + c.words, 0);
console.log(`\n${Object.keys(counts).length} docs · ${totalQ} questions · ${totalW} words · ${blocksRun} code blocks run · ${testsRun} tests`);
if (failures) {
  console.log(`${failures} problem(s) found`);
  process.exit(1);
}
