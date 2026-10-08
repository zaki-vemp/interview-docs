# Linked Lists, Stacks, Queues & Heaps

These structures show up in interviews as both **implementation questions** ("build an LRU cache", "implement a min-heap") and **pattern problems** (valid parentheses, next greater element, top-K, merging sorted lists). The **meeting-rooms** problem at the end is a nice tie-in to your conferencing background.

> The playground provides global helpers: `ListNode`, `arrayToList([1,2,3])` and `listToArray(head)`. The solutions below define their own `ListNode` so they also work when pasted anywhere else.

## Linked lists

### Reverse a linked list, iteratively and recursively 🔥

**Iterative:** walk the list, re-pointing each `next` to the previous node, using three pointers (`prev`, `cur`, `next`). **O(n) time, O(1) space.** The recursive version uses O(n) stack space.

```js
class ListNode { constructor(val, next = null) { this.val = val; this.next = next; } }
const fromArray = (arr) => arr.reduceRight((next, val) => new ListNode(val, next), null);
const toArray = (head) => { const out = []; for (let n = head; n; n = n.next) out.push(n.val); return out; };

function reverseList(head) {
  let prev = null, cur = head;
  while (cur) {
    const next = cur.next;   // save
    cur.next = prev;         // reverse the pointer
    prev = cur;              // advance prev
    cur = next;              // advance cur
  }
  return prev;
}

function reverseListRecursive(head) {
  if (!head || !head.next) return head;
  const newHead = reverseListRecursive(head.next);
  head.next.next = head;     // the node after head now points back to head
  head.next = null;
  return newHead;
}

// Reverse only positions left..right (1-indexed)
function reverseBetween(head, left, right) {
  const dummy = new ListNode(0, head);
  let before = dummy;
  for (let i = 1; i < left; i++) before = before.next;
  let cur = before.next;
  for (let i = 0; i < right - left; i++) {           // move cur.next to the front of the sublist, repeatedly
    const moved = cur.next;
    cur.next = moved.next;
    moved.next = before.next;
    before.next = moved;
  }
  return dummy.next;
}

test('reverse', () => {
  expect(toArray(reverseList(fromArray([1, 2, 3, 4, 5])))).toEqual([5, 4, 3, 2, 1]);
  expect(toArray(reverseListRecursive(fromArray([1, 2])))).toEqual([2, 1]);
  expect(reverseList(null)).toBeNull();
  expect(toArray(reverseBetween(fromArray([1, 2, 3, 4, 5]), 2, 4))).toEqual([1, 4, 3, 2, 5]);
});
```

### Detect a cycle and find where it starts (Floyd's tortoise and hare) 🔥

- **Detect:** a `slow` pointer moves 1 step and a `fast` pointer moves 2. If there's a cycle they **must meet**; if `fast` reaches null, there's no cycle. **O(n) time, O(1) space**, compared with O(n) for a visited Set.
- **Find the start:** after they meet, reset one pointer to `head` and move both **one step at a time**. They meet again at the **cycle's entry**. Mathematically, the distance from the head to the entry equals the distance from the meeting point to the entry, modulo the cycle length.

```js
class ListNode { constructor(val, next = null) { this.val = val; this.next = next; } }

function hasCycle(head) {
  let slow = head, fast = head;
  while (fast && fast.next) {
    slow = slow.next;
    fast = fast.next.next;
    if (slow === fast) return true;
  }
  return false;
}

function detectCycleStart(head) {
  let slow = head, fast = head;
  while (fast && fast.next) {
    slow = slow.next;
    fast = fast.next.next;
    if (slow === fast) {
      let p = head;
      while (p !== slow) { p = p.next; slow = slow.next; }
      return p;
    }
  }
  return null;
}

// build 3 -> 2 -> 0 -> -4 -> (back to 2)
const nodes = [3, 2, 0, -4].map((v) => new ListNode(v));
nodes.forEach((n, i) => (n.next = nodes[i + 1] ?? null));
nodes[3].next = nodes[1];

test('cycle detection', () => {
  expect(hasCycle(nodes[0])).toBe(true);
  expect(detectCycleStart(nodes[0])).toBe(nodes[1]);
  expect(hasCycle(new ListNode(1, new ListNode(2)))).toBe(false);
  expect(detectCycleStart(null)).toBeNull();
});
```

### Merge two sorted lists, and find the middle node 🔥

- **Merge:** use a **dummy head** to avoid special cases. Repeatedly attach the smaller node, then append the remainder. **O(n + m).**
- **Middle:** slow and fast pointers. When `fast` reaches the end, `slow` is at the middle (the second middle for even lengths). Used for splitting lists in merge sort, and for palindrome checks.

```js
class ListNode { constructor(val, next = null) { this.val = val; this.next = next; } }
const fromArray = (arr) => arr.reduceRight((next, val) => new ListNode(val, next), null);
const toArray = (head) => { const out = []; for (let n = head; n; n = n.next) out.push(n.val); return out; };

function mergeTwoLists(a, b) {
  const dummy = new ListNode(0);
  let tail = dummy;
  while (a && b) {
    if (a.val <= b.val) { tail.next = a; a = a.next; } else { tail.next = b; b = b.next; }
    tail = tail.next;
  }
  tail.next = a ?? b;
  return dummy.next;
}

function middleNode(head) {
  let slow = head, fast = head;
  while (fast && fast.next) { slow = slow.next; fast = fast.next.next; }
  return slow;
}

// Sort a linked list in O(n log n): split at the middle, sort halves, merge
function sortList(head) {
  if (!head || !head.next) return head;
  let slow = head, fast = head.next;            // fast starts one ahead -> slow ends at the FIRST middle
  while (fast && fast.next) { slow = slow.next; fast = fast.next.next; }
  const right = slow.next;
  slow.next = null;
  return mergeTwoLists(sortList(head), sortList(right));
}

test('merge, middle, sort', () => {
  expect(toArray(mergeTwoLists(fromArray([1, 2, 4]), fromArray([1, 3, 4])))).toEqual([1, 1, 2, 3, 4, 4]);
  expect(middleNode(fromArray([1, 2, 3, 4, 5])).val).toBe(3);
  expect(middleNode(fromArray([1, 2, 3, 4, 5, 6])).val).toBe(4);
  expect(toArray(sortList(fromArray([4, 2, 1, 3, -1, 0])))).toEqual([-1, 0, 1, 2, 3, 4]);
});
```

### Remove the Nth node from the end in one pass

**Two pointers with a gap of n.** Move `fast` n steps ahead, then move both until `fast` reaches the last node. `slow.next` is then the node to remove. A **dummy head** handles removing the first node.

```js
class ListNode { constructor(val, next = null) { this.val = val; this.next = next; } }
const fromArray = (arr) => arr.reduceRight((next, val) => new ListNode(val, next), null);
const toArray = (head) => { const out = []; for (let n = head; n; n = n.next) out.push(n.val); return out; };

function removeNthFromEnd(head, n) {
  const dummy = new ListNode(0, head);
  let fast = dummy, slow = dummy;
  for (let i = 0; i < n; i++) fast = fast.next;
  while (fast.next) { fast = fast.next; slow = slow.next; }
  slow.next = slow.next.next;
  return dummy.next;
}

test('removeNthFromEnd', () => {
  expect(toArray(removeNthFromEnd(fromArray([1, 2, 3, 4, 5]), 2))).toEqual([1, 2, 3, 5]);
  expect(toArray(removeNthFromEnd(fromArray([1]), 1))).toEqual([]);
  expect(toArray(removeNthFromEnd(fromArray([1, 2]), 2))).toEqual([2]);
});
```

### Palindrome linked list, intersection of two lists, and add two numbers

```js
class ListNode { constructor(val, next = null) { this.val = val; this.next = next; } }
const fromArray = (arr) => arr.reduceRight((next, val) => new ListNode(val, next), null);
const toArray = (head) => { const out = []; for (let n = head; n; n = n.next) out.push(n.val); return out; };

// O(1) space palindrome: reverse the second half, compare, (optionally restore)
function isPalindromeList(head) {
  let slow = head, fast = head;
  while (fast && fast.next) { slow = slow.next; fast = fast.next.next; }
  let prev = null;
  while (slow) { const next = slow.next; slow.next = prev; prev = slow; slow = next; }
  for (let a = head, b = prev; b; a = a.next, b = b.next) if (a.val !== b.val) return false;
  return true;
}

// Two pointers switch lists at the end -> both travel lenA + lenB and meet at the intersection (or null)
function getIntersectionNode(a, b) {
  let p = a, q = b;
  while (p !== q) { p = p ? p.next : b; q = q ? q.next : a; }
  return p;
}

// Digits stored in reverse order: 342 + 465 = 807 -> [2,4,3] + [5,6,4] = [7,0,8]
function addTwoNumbers(l1, l2) {
  const dummy = new ListNode(0);
  let tail = dummy, carry = 0;
  while (l1 || l2 || carry) {
    const sum = (l1?.val ?? 0) + (l2?.val ?? 0) + carry;
    carry = Math.floor(sum / 10);
    tail = tail.next = new ListNode(sum % 10);
    l1 = l1?.next; l2 = l2?.next;
  }
  return dummy.next;
}

const shared = fromArray([8, 4, 5]);
const listA = new ListNode(4, new ListNode(1, shared));
const listB = new ListNode(5, new ListNode(6, new ListNode(1, shared)));

test('list puzzles', () => {
  expect(isPalindromeList(fromArray([1, 2, 2, 1]))).toBe(true);
  expect(isPalindromeList(fromArray([1, 2, 3]))).toBe(false);
  expect(getIntersectionNode(listA, listB)).toBe(shared);
  expect(getIntersectionNode(fromArray([1]), fromArray([2]))).toBeNull();
  expect(toArray(addTwoNumbers(fromArray([2, 4, 3]), fromArray([5, 6, 4])))).toEqual([7, 0, 8]);
  expect(toArray(addTwoNumbers(fromArray([9, 9]), fromArray([1])))).toEqual([0, 0, 1]);
});
```

### Implement an LRU cache with a hash map + doubly linked list 🔥

The classic O(1) design, which works in any language:

- a **hash map** from key to list node, for O(1) lookup
- a **doubly linked list** ordered by recency: most recent at the head, least recent at the tail, for O(1) moves and evictions
- **sentinel head and tail nodes** to remove edge cases

(In JavaScript you can also use `Map`'s insertion order; see Machine Coding. Interviewers often ask for **this** version to test pointer manipulation.)

```js
class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.map = new Map();
    this.head = { key: null, prev: null, next: null };   // sentinel: most recent side
    this.tail = { key: null, prev: this.head, next: null };
    this.head.next = this.tail;
  }
  #remove(node) { node.prev.next = node.next; node.next.prev = node.prev; }
  #addFront(node) {
    node.next = this.head.next; node.prev = this.head;
    this.head.next.prev = node; this.head.next = node;
  }
  get(key) {
    const node = this.map.get(key);
    if (!node) return -1;
    this.#remove(node); this.#addFront(node);              // mark as most recently used
    return node.value;
  }
  put(key, value) {
    if (this.map.has(key)) {
      const node = this.map.get(key);
      node.value = value;
      this.#remove(node); this.#addFront(node);
      return;
    }
    if (this.map.size === this.capacity) {
      const lru = this.tail.prev;                           // least recently used
      this.#remove(lru);
      this.map.delete(lru.key);
    }
    const node = { key, value, prev: null, next: null };
    this.#addFront(node);
    this.map.set(key, node);
  }
  keysByRecency() { const out = []; for (let n = this.head.next; n !== this.tail; n = n.next) out.push(n.key); return out; }
}

test('LRU with doubly linked list', () => {
  const c = new LRUCache(2);
  c.put(1, 1); c.put(2, 2);
  expect(c.get(1)).toBe(1);        // order: 1, 2
  c.put(3, 3);                      // evicts 2
  expect(c.get(2)).toBe(-1);
  c.put(4, 4);                      // evicts 1
  expect(c.get(1)).toBe(-1);
  expect(c.get(3)).toBe(3);
  expect(c.get(4)).toBe(4);
  expect(c.keysByRecency()).toEqual([4, 3]);
});
```

## Stacks

### Valid Parentheses 🔥

Push opening brackets onto a stack. On a closing bracket, the **top must be the matching opener**. At the end the stack must be empty. **O(n).** The same idea validates nested structures (HTML tags, JSON-like expressions).

```js
function isValid(s) {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  for (const c of s) {
    if (c === '(' || c === '[' || c === '{') stack.push(c);
    else if (stack.pop() !== pairs[c]) return false;
  }
  return stack.length === 0;
}

// Variant: minimum removals to make parentheses valid -> return one valid string
function minRemoveToMakeValid(s) {
  const chars = [...s];
  const stack = [];
  chars.forEach((c, i) => {
    if (c === '(') stack.push(i);
    else if (c === ')') { if (stack.length) stack.pop(); else chars[i] = ''; }
  });
  for (const i of stack) chars[i] = '';
  return chars.join('');
}

test('parentheses', () => {
  expect(isValid('()[]{}')).toBe(true);
  expect(isValid('([)]')).toBe(false);
  expect(isValid('{[]}')).toBe(true);
  expect(isValid('(')).toBe(false);
  expect(isValid(']')).toBe(false);
  expect(minRemoveToMakeValid('lee(t(c)o)de)')).toBe('lee(t(c)o)de');
  expect(minRemoveToMakeValid('))((')).toBe('');
});
```

### Min Stack: push, pop, top and getMin in O(1) 🔥

Store, alongside each value, **the minimum at the time it was pushed**. Popping restores the previous minimum automatically.

```js
class MinStack {
  #stack = [];
  push(x) { const min = this.#stack.length ? Math.min(x, this.getMin()) : x; this.#stack.push([x, min]); }
  pop() { return this.#stack.pop()?.[0]; }
  top() { return this.#stack.at(-1)?.[0]; }
  getMin() { return this.#stack.at(-1)?.[1]; }
}

test('MinStack', () => {
  const s = new MinStack();
  s.push(-2); s.push(0); s.push(-3);
  expect(s.getMin()).toBe(-3);
  s.pop();
  expect(s.top()).toBe(0);
  expect(s.getMin()).toBe(-2);
});
```

### Monotonic stack: Daily Temperatures and Next Greater Element 🔥

A **monotonic stack** keeps elements (usually **indices**) in increasing or decreasing order. When a new element breaks the order, pop and **resolve** the popped elements: the new element is their "next greater". Each index is pushed and popped once, so it's **O(n)** instead of O(n²).

```js
// Days until a warmer temperature
function dailyTemperatures(temps) {
  const answer = new Array(temps.length).fill(0);
  const stack = [];                                   // indices with decreasing temperatures
  temps.forEach((t, i) => {
    while (stack.length && temps[stack.at(-1)] < t) {
      const j = stack.pop();
      answer[j] = i - j;
    }
    stack.push(i);
  });
  return answer;
}

// Next greater element in a circular array
function nextGreaterCircular(nums) {
  const n = nums.length, res = new Array(n).fill(-1), stack = [];
  for (let i = 0; i < 2 * n; i++) {                   // loop twice to simulate circularity
    const x = nums[i % n];
    while (stack.length && nums[stack.at(-1)] < x) res[stack.pop()] = x;
    if (i < n) stack.push(i);
  }
  return res;
}

// Largest rectangle in a histogram (monotonic increasing stack)
function largestRectangleArea(heights) {
  const stack = [];
  let best = 0;
  for (let i = 0; i <= heights.length; i++) {
    const h = i === heights.length ? 0 : heights[i];   // sentinel 0 flushes the stack
    while (stack.length && heights[stack.at(-1)] > h) {
      const height = heights[stack.pop()];
      const width = stack.length ? i - stack.at(-1) - 1 : i;
      best = Math.max(best, height * width);
    }
    stack.push(i);
  }
  return best;
}

test('monotonic stack', () => {
  expect(dailyTemperatures([73, 74, 75, 71, 69, 72, 76, 73])).toEqual([1, 1, 4, 2, 1, 1, 0, 0]);
  expect(nextGreaterCircular([1, 2, 1])).toEqual([2, -1, 2]);
  expect(largestRectangleArea([2, 1, 5, 6, 2, 3])).toBe(10);
});
```

### Evaluate Reverse Polish Notation, and Decode String

```js
function evalRPN(tokens) {
  const stack = [];
  const ops = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => Math.trunc(a / b) };
  for (const t of tokens) {
    if (t in ops) { const b = stack.pop(), a = stack.pop(); stack.push(ops[t](a, b)); }
    else stack.push(Number(t));
  }
  return stack.pop();
}

// "3[a2[c]]" -> "accaccacc"
function decodeString(s) {
  const counts = [], strings = [];
  let current = '', k = 0;
  for (const c of s) {
    if (c >= '0' && c <= '9') k = k * 10 + Number(c);
    else if (c === '[') { counts.push(k); strings.push(current); k = 0; current = ''; }
    else if (c === ']') current = strings.pop() + current.repeat(counts.pop());
    else current += c;
  }
  return current;
}

test('stack evaluators', () => {
  expect(evalRPN(['2', '1', '+', '3', '*'])).toBe(9);
  expect(evalRPN(['4', '13', '5', '/', '+'])).toBe(6);
  expect(decodeString('3[a]2[bc]')).toBe('aaabcbc');
  expect(decodeString('3[a2[c]]')).toBe('accaccacc');
  expect(decodeString('2[abc]3[cd]ef')).toBe('abcabccdcdcdef');
});
```

## Queues & deques

### Implement a queue with O(1) operations in JavaScript (and a queue using two stacks) 🔥

`Array.prototype.shift()` is **O(n)**, so a naive array queue is O(n²) for BFS on large inputs. **Options:**

- a **head index** (lazy deletion) with occasional compaction
- a **linked list**
- a **ring buffer**
- **two stacks** (amortised O(1)), a classic interview question

```js
class Queue {
  #items = []; #head = 0;
  enqueue(x) { this.#items.push(x); }
  dequeue() {
    if (this.#head >= this.#items.length) return undefined;
    const x = this.#items[this.#head++];
    if (this.#head > 1024 && this.#head * 2 > this.#items.length) {   // compact occasionally
      this.#items = this.#items.slice(this.#head);
      this.#head = 0;
    }
    return x;
  }
  get size() { return this.#items.length - this.#head; }
}

class QueueFromStacks {
  #in = []; #out = [];
  push(x) { this.#in.push(x); }
  pop() { this.#shift(); return this.#out.pop(); }
  peek() { this.#shift(); return this.#out.at(-1); }
  #shift() { if (!this.#out.length) while (this.#in.length) this.#out.push(this.#in.pop()); }   // amortised O(1)
}

test('queues', () => {
  const q = new Queue();
  for (let i = 0; i < 5000; i++) q.enqueue(i);
  let sum = 0;
  while (q.size) sum += q.dequeue();
  expect(sum).toBe((4999 * 5000) / 2);
  const s = new QueueFromStacks();
  s.push(1); s.push(2);
  expect(s.peek()).toBe(1);
  expect(s.pop()).toBe(1);
  s.push(3);
  expect([s.pop(), s.pop()]).toEqual([2, 3]);
});
```

### Sliding Window Maximum (monotonic deque) 🔥

Keep a **deque of indices whose values are decreasing**. The front is the current window's maximum. Remove indices that fall out of the window from the front, and remove smaller values from the back before pushing. **O(n)**, compared with O(n·k) for brute force or O(n log k) with a heap.

```js
function maxSlidingWindow(nums, k) {
  const dq = [];          // indices; values decreasing (use a head pointer for an O(1) front pop)
  let head = 0;
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    if (head < dq.length && dq[head] <= i - k) head++;                 // out of window
    while (dq.length > head && nums[dq.at(-1)] <= nums[i]) dq.pop();   // smaller values are useless now
    dq.push(i);
    if (i >= k - 1) out.push(nums[dq[head]]);
  }
  return out;
}

test('maxSlidingWindow', () => {
  expect(maxSlidingWindow([1, 3, -1, -3, 5, 3, 6, 7], 3)).toEqual([3, 3, 5, 5, 6, 7]);
  expect(maxSlidingWindow([1], 1)).toEqual([1]);
  expect(maxSlidingWindow([9, 8, 7, 6], 2)).toEqual([9, 8, 7]);
});
```

## Heaps & priority queues

### Implement a binary min-heap (priority queue) 🔥

JavaScript has **no built-in priority queue**, so you may need to write one live.

- A **binary heap** is stored in an array.
- Parent of `i` is `(i − 1) >> 1`; children are `2i + 1` and `2i + 2`.
- **push:** append, then **sift up**. **O(log n).**
- **pop:** move the last element to the root, then **sift down**. **O(log n).**
- **peek:** O(1).
- **heapify** an array: O(n).

```js
class MinHeap {
  constructor(compare = (a, b) => a - b) { this.data = []; this.compare = compare; }
  get size() { return this.data.length; }
  peek() { return this.data[0]; }
  push(x) {
    const d = this.data;
    d.push(x);
    let i = d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.compare(d[i], d[p]) >= 0) break;
      [d[i], d[p]] = [d[p], d[i]];
      i = p;
    }
  }
  pop() {
    const d = this.data;
    if (!d.length) return undefined;
    const top = d[0];
    const last = d.pop();
    if (d.length) {
      d[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let smallest = i;
        if (l < d.length && this.compare(d[l], d[smallest]) < 0) smallest = l;
        if (r < d.length && this.compare(d[r], d[smallest]) < 0) smallest = r;
        if (smallest === i) break;
        [d[i], d[smallest]] = [d[smallest], d[i]];
        i = smallest;
      }
    }
    return top;
  }
}

test('MinHeap sorts and supports custom comparators', () => {
  const h = new MinHeap();
  [5, 3, 8, 1, 9, 2, 7].forEach((x) => h.push(x));
  const out = [];
  while (h.size) out.push(h.pop());
  expect(out).toEqual([1, 2, 3, 5, 7, 8, 9]);

  const maxHeap = new MinHeap((a, b) => b.priority - a.priority);   // max-heap by priority
  maxHeap.push({ task: 'send notification', priority: 1 });
  maxHeap.push({ task: 'start recording', priority: 5 });
  maxHeap.push({ task: 'update stats', priority: 3 });
  expect(maxHeap.pop().task).toBe('start recording');
});
```

### Kth Largest Element and Top K with a heap 🔥

- **Kth largest:** keep a **min-heap of size k**. Push every element, and pop whenever the size exceeds k. The root is the answer. **O(n log k) time, O(k) space.**
- **Quickselect** averages O(n) (worst case O(n²)). Mention it as an alternative.
- **Top K in a stream:** the same min-heap of size k works with unbounded input. Sorting needs all the data.

```js
class MinHeap {
  constructor(cmp = (a, b) => a - b) { this.d = []; this.cmp = cmp; }
  get size() { return this.d.length; }
  peek() { return this.d[0]; }
  push(x) { const d = this.d; d.push(x); let i = d.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.cmp(d[i], d[p]) >= 0) break; [d[i], d[p]] = [d[p], d[i]]; i = p; } }
  pop() { const d = this.d; const top = d[0]; const last = d.pop(); if (d.length) { d[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < d.length && this.cmp(d[l], d[m]) < 0) m = l; if (r < d.length && this.cmp(d[r], d[m]) < 0) m = r; if (m === i) break; [d[i], d[m]] = [d[m], d[i]]; i = m; } } return top; }
}

function findKthLargest(nums, k) {
  const heap = new MinHeap();
  for (const n of nums) {
    heap.push(n);
    if (heap.size > k) heap.pop();
  }
  return heap.peek();
}

// K closest points to the origin: a max-heap of size k by distance
function kClosest(points, k) {
  const dist = ([x, y]) => x * x + y * y;
  const heap = new MinHeap((a, b) => dist(b) - dist(a));   // max-heap
  for (const p of points) {
    heap.push(p);
    if (heap.size > k) heap.pop();
  }
  return heap.d.sort((a, b) => dist(a) - dist(b));
}

test('heap selection', () => {
  expect(findKthLargest([3, 2, 1, 5, 6, 4], 2)).toBe(5);
  expect(findKthLargest([3, 2, 3, 1, 2, 4, 5, 5, 6], 4)).toBe(4);
  expect(kClosest([[3, 3], [5, -1], [-2, 4]], 2)).toEqual([[3, 3], [-2, 4]]);
});
```

### Merge K sorted lists or arrays 🔥

Use a **min-heap of the current head of each list**: pop the smallest, then push the next element from the same list. **O(N log k)** for N total elements across k lists. (Pairwise merging also gives O(N log k); merging one by one is O(N·k).)

```js
class MinHeap {
  constructor(cmp) { this.d = []; this.cmp = cmp; }
  get size() { return this.d.length; }
  push(x) { const d = this.d; d.push(x); let i = d.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.cmp(d[i], d[p]) >= 0) break; [d[i], d[p]] = [d[p], d[i]]; i = p; } }
  pop() { const d = this.d; const top = d[0]; const last = d.pop(); if (d.length) { d[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < d.length && this.cmp(d[l], d[m]) < 0) m = l; if (r < d.length && this.cmp(d[r], d[m]) < 0) m = r; if (m === i) break; [d[i], d[m]] = [d[m], d[i]]; i = m; } } return top; }
}

function mergeKSorted(arrays) {
  const heap = new MinHeap((a, b) => a.value - b.value);
  arrays.forEach((arr, i) => arr.length && heap.push({ value: arr[0], list: i, index: 0 }));
  const out = [];
  while (heap.size) {
    const { value, list, index } = heap.pop();
    out.push(value);
    if (index + 1 < arrays[list].length) heap.push({ value: arrays[list][index + 1], list, index: index + 1 });
  }
  return out;
}

test('mergeKSorted', () => {
  expect(mergeKSorted([[1, 4, 5], [1, 3, 4], [2, 6]])).toEqual([1, 1, 2, 3, 4, 4, 5, 6]);
  expect(mergeKSorted([[], [0]])).toEqual([0]);
});
```

This is a real-world pattern: merging **time-ordered event logs** from several services (Jicofo, JVB, Jibri) into one timeline while debugging a recording failure.

### Find the median from a data stream (two heaps)

- A **max-heap** holds the lower half and a **min-heap** holds the upper half.
- Keep their sizes balanced (differing by at most 1).
- The median is the top of the larger heap, or the average of both tops.
- **addNum: O(log n). findMedian: O(1).**
- Use case: a **live median latency or bitrate** in a stats panel.

```js
class Heap {
  constructor(cmp) { this.d = []; this.cmp = cmp; }
  get size() { return this.d.length; }
  peek() { return this.d[0]; }
  push(x) { const d = this.d; d.push(x); let i = d.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.cmp(d[i], d[p]) >= 0) break; [d[i], d[p]] = [d[p], d[i]]; i = p; } }
  pop() { const d = this.d; const top = d[0]; const last = d.pop(); if (d.length) { d[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < d.length && this.cmp(d[l], d[m]) < 0) m = l; if (r < d.length && this.cmp(d[r], d[m]) < 0) m = r; if (m === i) break; [d[i], d[m]] = [d[m], d[i]]; i = m; } } return top; }
}

class MedianFinder {
  low = new Heap((a, b) => b - a);   // max-heap
  high = new Heap((a, b) => a - b);  // min-heap
  addNum(n) {
    this.low.push(n);
    this.high.push(this.low.pop());                    // move the largest of low into high
    if (this.high.size > this.low.size) this.low.push(this.high.pop());   // rebalance
  }
  findMedian() {
    return this.low.size > this.high.size ? this.low.peek() : (this.low.peek() + this.high.peek()) / 2;
  }
}

test('streaming median', () => {
  const m = new MedianFinder();
  m.addNum(1); m.addNum(2);
  expect(m.findMedian()).toBe(1.5);
  m.addNum(3);
  expect(m.findMedian()).toBe(2);
  [10, 20, 30].forEach((x) => m.addNum(x));
  expect(m.findMedian()).toBe(6.5);
});
```

### Meeting Rooms I and II (can one person attend all? how many rooms are needed?) 🔥

A perfect tie-in to your conferencing background.

- **Meeting Rooms I:** sort by start time and check whether any meeting starts before the previous one ends. **O(n log n).**
- **Meeting Rooms II** (minimum rooms, or **peak concurrent meetings**): sort by start, and keep a **min-heap of end times** for the rooms in use. If the earliest-ending room is free (`end ≤ start`), reuse it; otherwise add a room. The heap's size is the answer. **O(n log n).**
- **Alternative:** sweep separate sorted start and end arrays with two pointers.

The same question in disguise: "the maximum number of concurrent Jibri sessions needed for these scheduled recordings", or "peak concurrent participants from join/leave logs".

```js
function canAttendAll(intervals) {
  const s = [...intervals].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < s.length; i++) if (s[i][0] < s[i - 1][1]) return false;
  return true;
}

// Sweep version: count concurrent meetings with sorted starts and ends
function minMeetingRooms(intervals) {
  const starts = intervals.map((i) => i[0]).sort((a, b) => a - b);
  const ends = intervals.map((i) => i[1]).sort((a, b) => a - b);
  let rooms = 0, maxRooms = 0, e = 0;
  for (const start of starts) {
    while (e < ends.length && ends[e] <= start) { rooms--; e++; }   // free rooms whose meeting ended
    rooms++;
    maxRooms = Math.max(maxRooms, rooms);
  }
  return maxRooms;
}

// Peak concurrent participants from join/leave events (same sweep idea)
function peakConcurrent(events) {
  const points = events.flatMap(({ join, leave }) => [[join, +1], [leave, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); // leave before join at the same time
  let cur = 0, peak = 0;
  for (const [, delta] of points) peak = Math.max(peak, (cur += delta));
  return peak;
}

test('meeting rooms', () => {
  expect(canAttendAll([[0, 30], [5, 10], [15, 20]])).toBe(false);
  expect(canAttendAll([[7, 10], [2, 4]])).toBe(true);
  expect(minMeetingRooms([[0, 30], [5, 10], [15, 20]])).toBe(2);
  expect(minMeetingRooms([[7, 10], [2, 4]])).toBe(1);
  expect(minMeetingRooms([[1, 5], [2, 6], [3, 7], [5, 8]])).toBe(3);
  expect(peakConcurrent([{ join: 0, leave: 10 }, { join: 5, leave: 15 }, { join: 10, leave: 20 }])).toBe(2);
});
```
