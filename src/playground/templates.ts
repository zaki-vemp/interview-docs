import type { PgLang } from '../lib/playgroundStore';

export interface Template {
  name: string;
  lang: PgLang;
  code: string;
}

export const TEMPLATES: Template[] = [
  {
    name: 'Blank (JavaScript)',
    lang: 'js',
    code: `// Write JavaScript here. Ctrl/Cmd + Enter runs it.\n\n`,
  },
  {
    name: 'Blank (TypeScript)',
    lang: 'ts',
    code: `// TypeScript is transpiled with sucrase (types are stripped, not type-checked).\n\nfunction greet(name: string): string {\n  return \`Hello, \${name}\`;\n}\n\nconsole.log(greet('interviewer'));\n`,
  },
  {
    name: 'Unit tests: test / expect',
    lang: 'js',
    code: `// Jest-style API: describe, test/it, expect, beforeEach, afterEach, jest.fn()\n\nfunction isPalindrome(s) {\n  const clean = s.toLowerCase().replace(/[^a-z0-9]/g, '');\n  let i = 0, j = clean.length - 1;\n  while (i < j) if (clean[i++] !== clean[j--]) return false;\n  return true;\n}\n\ndescribe('isPalindrome', () => {\n  test('handles punctuation and case', () => {\n    expect(isPalindrome('A man, a plan, a canal: Panama')).toBe(true);\n  });\n  test('rejects non-palindromes', () => {\n    expect(isPalindrome('race a car')).toBe(false);\n  });\n  test.each([['', true], ['a', true], ['ab', false]])('isPalindrome(%s) -> %s', (input, expected) => {\n    expect(isPalindrome(input)).toBe(expected);\n  });\n});\n\ntest('mock functions', () => {\n  const cb = jest.fn((x) => x * 2);\n  [1, 2, 3].forEach((n) => cb(n));\n  expect(cb).toHaveBeenCalledTimes(3);\n  expect(cb).toHaveBeenLastCalledWith(3);\n});\n\ntest('async code', async () => {\n  const value = await new Promise((r) => setTimeout(() => r(42), 50));\n  expect(value).toBe(42);\n  await expect(Promise.reject(new Error('boom'))).rejects.toThrow('boom');\n});\n`,
  },
  {
    name: 'Event loop: micro vs macro tasks',
    lang: 'js',
    code: `console.log('1: script start');\n\nsetTimeout(() => console.log('6: setTimeout (macrotask)'), 0);\n\nPromise.resolve()\n  .then(() => console.log('3: promise.then #1 (microtask)'))\n  .then(() => console.log('5: promise.then #2 (microtask)'));\n\nqueueMicrotask(() => console.log('4: queueMicrotask'));\n\n(async () => {\n  console.log('2: async fn body runs synchronously until the first await');\n  await null;\n  console.log('4b: after await (microtask)');\n})();\n\nconsole.log('2b: script end');\n`,
  },
  {
    name: 'DSA helpers: ListNode / TreeNode',
    lang: 'js',
    code: `// Globals: ListNode, TreeNode, arrayToList, listToArray, arrayToTree, treeToArray\n\nfunction reverseList(head) {\n  let prev = null;\n  while (head) [head.next, prev, head] = [prev, head, head.next];\n  return prev;\n}\n\nfunction invertTree(root) {\n  if (!root) return null;\n  [root.left, root.right] = [invertTree(root.right), invertTree(root.left)];\n  return root;\n}\n\ntest('reverse linked list', () => {\n  expect(listToArray(reverseList(arrayToList([1, 2, 3, 4])))).toEqual([4, 3, 2, 1]);\n});\n\ntest('invert binary tree', () => {\n  expect(treeToArray(invertTree(arrayToTree([4, 2, 7, 1, 3, 6, 9])))).toEqual([4, 7, 2, 9, 6, 3, 1]);\n});\n`,
  },
  {
    name: 'Top-level await + fetch',
    lang: 'js',
    code: `// Top-level await works (the code is wrapped in an async function automatically).\nconst sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n\nconsole.time('sleep');\nawait sleep(200);\nconsole.timeEnd('sleep');\n\ntry {\n  const res = await fetch('https://jsonplaceholder.typicode.com/todos/1');\n  console.log(res.status, await res.json());\n} catch (err) {\n  console.warn('Network request failed (offline?):', err.message);\n}\n`,
  },
  {
    name: 'TypeScript: generics & narrowing',
    lang: 'ts',
    code: `type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };\n\nfunction safeJsonParse<T = unknown>(text: string): Result<T> {\n  try {\n    return { ok: true, value: JSON.parse(text) as T };\n  } catch (e) {\n    return { ok: false, error: e as Error };\n  }\n}\n\ninterface User { id: number; name: string }\n\nconst r = safeJsonParse<User>('{"id":1,"name":"Zaki"}');\nif (r.ok) console.log('user', r.value.name);\nelse console.error(r.error.message);\n\nconst bad = safeJsonParse('{oops}');\nconsole.log(bad.ok ? 'parsed' : 'failed: ' + bad.error.name);\n\ntest('discriminated union', () => {\n  expect(safeJsonParse<number[]>('[1,2]')).toEqual({ ok: true, value: [1, 2] });\n});\n`,
  },
];
