# DSA Foundations & Patterns

You're not targeting FAANG-style algorithm marathons, but **most product companies still ask one or two DSA problems** (easy to medium) in a coding round, usually in **JavaScript** for frontend roles. What matters is: **a clear approach, correct code, edge cases, and complexity analysis**. This page covers the toolkit; the next four pages apply it to the most-asked problems.

> Every JavaScript block is runnable and has tests. Practise by **hiding the solution**, writing your own in the playground, and pasting the tests from the block to check it.

## Approach & complexity

### How should you approach a coding problem in an interview? 🔥

Use a consistent process, and **talk through it**:

1. **Understand (2–3 min):** restate the problem. Ask about **input sizes**, value ranges, duplicates, negatives, empty input, sortedness, and whether to return indexes or values. Write **2–3 examples**, including edge cases.
2. **Brute force first:** state it and its complexity ("O(n²) by checking all pairs"). This shows you can solve it, and gives a baseline.
3. **Optimise:** look for the bottleneck and pick a **pattern** (hash map for lookups, two pointers for sorted data, a sliding window for contiguous ranges, a heap for top-K, BFS for shortest paths). State the target complexity **before** coding.
4. **Code:** clean names, small helpers, no premature micro-optimisation. Narrate the invariants ("the window always contains unique characters").
5. **Test:** walk through your examples by hand, then the **edge cases**: empty, one element, all the same, negatives, very large inputs.
6. **Analyse:** time and space complexity, and the trade-offs ("we use O(n) extra space for the map to get O(n) time").

**If you get stuck:** say what you're thinking, try a smaller example, consider sorting the input, consider a hash map, and **ask for a hint**. That's far better than silence.

### Explain Big-O notation and the common complexity classes 🔥

**Big-O** describes how running time (or memory) **grows** as the input size *n* grows, as an **upper bound**, dropping constants and lower-order terms. `3n² + 10n + 7` is O(n²).

| Complexity | Name | Example | n = 10⁶ is roughly… |
|---|---|---|---|
| O(1) | Constant | Array index, `Map.get`, `Set.has` (average) | instant |
| O(log n) | Logarithmic | Binary search, balanced-tree operations, heap push/pop | ~20 steps |
| O(n) | Linear | One pass over an array, `includes`, `indexOf` | 10⁶ |
| O(n log n) | Linearithmic | Efficient sorting (merge sort, `Array.prototype.sort`) | ~2×10⁷ |
| O(n²) | Quadratic | Nested loops over all pairs | 10¹² ✗ too slow |
| O(2ⁿ) | Exponential | All subsets, naive recursive Fibonacci | ✗ |
| O(n!) | Factorial | All permutations | ✗ |

**Rough guide from input size to the complexity you need** (about 10⁸ simple operations per second):

- n ≤ 20 → O(2ⁿ) is OK
- n ≤ 10³ → O(n²)
- n ≤ 10⁵–10⁶ → **O(n log n) or O(n)**

**Other notes:**

- **Space complexity** counts **extra** memory (often including the recursion stack).
- **Amortised** analysis: `array.push` is O(1) amortised, even though occasional resizes copy everything.
- **Best, average, worst case:** quicksort is O(n log n) average but O(n²) worst. Hash maps are O(1) average, with a bad worst case.

```js
// Measure growth empirically: count operations as n doubles
function countOps(n) {
  let linear = 0, quadratic = 0, logarithmic = 0;
  for (let i = 0; i < n; i++) linear++;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) quadratic++;
  for (let i = n; i > 1; i = Math.floor(i / 2)) logarithmic++;
  return { n, logarithmic, linear, quadratic };
}
console.table([100, 200, 400, 800].map(countOps));   // linear doubles, quadratic quadruples, log adds 1
```

### What are the time complexities of common JavaScript operations? 🔥

| Operation | Complexity | Note |
|---|---|---|
| `arr[i]`, `arr.length`, `arr.push`, `arr.pop` | O(1) (push is amortised) | |
| **`arr.shift()` / `arr.unshift()`** | **O(n)** | Re-indexes every element. **Don't use shift for BFS queues** on big inputs; use an index pointer |
| `arr.includes`, `indexOf`, `find`, `filter`, `map`, `reduce` | O(n) | |
| `arr.slice(a, b)` | O(b − a) | Copies |
| `arr.splice` (middle) | O(n) | Shifts elements |
| `arr.sort()` | O(n log n) | V8 uses **TimSort** (stable). Default comparison is **string-based**, so pass `(a, b) => a - b` |
| `[...arr]`, `arr.concat` | O(n) | |
| `Set.add/has/delete`, `Map.get/set/has/delete` | **O(1) average** | |
| `Object.keys(obj)` | O(k) | |
| `str[i]`, `str.length` | O(1) | Strings are **immutable** |
| `str + str2`, `str.slice`, `str.split`, `str.includes` | O(n) | Building a string in a loop with `+=` is usually fine in V8 (ropes), but `arr.push` + `join` is the safe idiom |
| `str.split('').reverse().join('')` | O(n) | Breaks on surrogate pairs (emoji); use `[...str]` for code points |

### What does recursion cost, and when do you convert it to iteration?

- Each recursive call adds a **stack frame**, so space is **O(depth)**. JS engines have a limit (often around 10,000 frames in V8 by default), and **JavaScript has no tail-call optimisation in practice** (only Safari implements it). Deep recursion, like DFS on a 100,000-node linked structure, throws `RangeError: Maximum call stack size exceeded`.
- **Convert to iteration** with an explicit stack (DFS) or queue (BFS) when depth can be large.
- **Memoise** recursive solutions with overlapping subproblems (DP).

```js
function depthRecursive(n) { return n === 0 ? 0 : 1 + depthRecursive(n - 1); }
function depthIterative(n) { let d = 0; while (n-- > 0) d++; return d; }

let overflow = null;
try { depthRecursive(1e6); } catch (e) { overflow = e.constructor.name; }
console.log('recursive 1e6:', overflow ?? 'ok', '| iterative 1e6:', depthIterative(1e6));
test('iteration handles depths recursion cannot', () => {
  expect(overflow).toBe('RangeError');
  expect(depthIterative(1e6)).toBe(1e6);
});
```

## Core patterns

### Hashing pattern: when should you reach for a Map or Set? 🔥

**Use a hash map or set when you need:**

- **O(1) lookup** of "have I seen X?" or "where is X?"
- **counting** (frequencies)
- **grouping** by a key
- **complement lookups** ("is target − x present?")

This is the **single most useful pattern** for easy and medium problems. It turns O(n²) pair searches into O(n).

```js
// 1) Frequency count  2) seen-set  3) complement lookup  4) group by key
const freq = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());

const firstDuplicate = (arr) => {
  const seen = new Set();
  for (const x of arr) { if (seen.has(x)) return x; seen.add(x); }
  return null;
};

const hasPairWithSum = (arr, target) => {
  const seen = new Set();
  for (const x of arr) { if (seen.has(target - x)) return true; seen.add(x); }
  return false;
};

const groupBy = (arr, keyFn) => arr.reduce((m, x) => { const k = keyFn(x); (m.get(k) ?? m.set(k, []).get(k)).push(x); return m; }, new Map());

test('hash patterns', () => {
  expect([...freq(['a', 'b', 'a'])]).toEqual([['a', 2], ['b', 1]]);
  expect(firstDuplicate([3, 1, 4, 1, 5])).toBe(1);
  expect(hasPairWithSum([8, 3, 5, 1], 9)).toBe(true);
  expect(hasPairWithSum([8, 3, 5, 1], 100)).toBe(false);
  expect(groupBy(['ab', 'c', 'de'], (s) => s.length).get(2)).toEqual(['ab', 'de']);
});
```

### Two pointers: explain the variants with examples 🔥

**Two pointers** work best on **sorted arrays** or when comparing elements from both ends. They usually reduce O(n²) to **O(n)** with O(1) space.

1. **Opposite ends** (left = 0, right = n − 1, moving inward): pair sums in sorted arrays, palindromes, container with most water, reversing in place.
2. **Same direction (fast/slow):** removing duplicates in place, moving zeros, partitioning, merging sorted arrays, linked-list cycle detection.

```js
// Opposite ends: pair with target sum in a SORTED array
function twoSumSorted(nums, target) {
  let l = 0, r = nums.length - 1;
  while (l < r) {
    const sum = nums[l] + nums[r];
    if (sum === target) return [l, r];
    if (sum < target) l++; else r--;          // need bigger -> move left up; smaller -> move right down
  }
  return [-1, -1];
}

// Same direction: remove duplicates from a sorted array in place, return the new length
function removeDuplicates(nums) {
  if (!nums.length) return 0;
  let write = 1;
  for (let read = 1; read < nums.length; read++) {
    if (nums[read] !== nums[write - 1]) nums[write++] = nums[read];
  }
  return write;
}

// Opposite ends: palindrome check ignoring non-alphanumerics, O(1) extra space
function isPalindrome(s) {
  const ok = (c) => /[a-z0-9]/i.test(c);
  let l = 0, r = s.length - 1;
  while (l < r) {
    while (l < r && !ok(s[l])) l++;
    while (l < r && !ok(s[r])) r--;
    if (s[l].toLowerCase() !== s[r].toLowerCase()) return false;
    l++; r--;
  }
  return true;
}

test('two pointers', () => {
  expect(twoSumSorted([1, 3, 4, 6, 9], 10)).toEqual([0, 4]);
  const arr = [1, 1, 2, 3, 3, 3, 4];
  const len = removeDuplicates(arr);
  expect(arr.slice(0, len)).toEqual([1, 2, 3, 4]);
  expect(isPalindrome('A man, a plan, a canal: Panama')).toBe(true);
  expect(isPalindrome('race a car')).toBe(false);
});
```

### Sliding window: fixed and variable size 🔥

Use it for problems about **contiguous subarrays or substrings**: "longest/shortest/maximum … such that …".

- **Fixed window of size k:** add the incoming element, remove the outgoing one. O(n) instead of O(n·k).
- **Variable window:** **expand `right`**, and **shrink `left` while the window is invalid**. Track the best answer. Each index enters and leaves at most once, so the whole thing is **O(n)**.

```js
// Fixed: maximum sum of any k consecutive elements
function maxSumK(nums, k) {
  if (nums.length < k) return null;
  let sum = 0;
  for (let i = 0; i < k; i++) sum += nums[i];
  let best = sum;
  for (let i = k; i < nums.length; i++) {
    sum += nums[i] - nums[i - k];               // slide: add right, remove left
    best = Math.max(best, sum);
  }
  return best;
}

// Variable: longest substring with at most K distinct characters
function longestKDistinct(s, k) {
  const counts = new Map();
  let left = 0, best = 0;
  for (let right = 0; right < s.length; right++) {
    counts.set(s[right], (counts.get(s[right]) ?? 0) + 1);
    while (counts.size > k) {                   // shrink until valid
      const c = s[left++];
      counts.set(c, counts.get(c) - 1);
      if (counts.get(c) === 0) counts.delete(c);
    }
    best = Math.max(best, right - left + 1);
  }
  return best;
}

// Variable (shortest): minimum length subarray with sum >= target (positive numbers)
function minSubArrayLen(target, nums) {
  let left = 0, sum = 0, best = Infinity;
  for (let right = 0; right < nums.length; right++) {
    sum += nums[right];
    while (sum >= target) {
      best = Math.min(best, right - left + 1);
      sum -= nums[left++];
    }
  }
  return best === Infinity ? 0 : best;
}

test('sliding window', () => {
  expect(maxSumK([2, 1, 5, 1, 3, 2], 3)).toBe(9);
  expect(longestKDistinct('eceba', 2)).toBe(3);         // "ece"
  expect(longestKDistinct('aa', 1)).toBe(2);
  expect(minSubArrayLen(7, [2, 3, 1, 2, 4, 3])).toBe(2); // [4,3]
  expect(minSubArrayLen(100, [1, 2])).toBe(0);
});
```

### Prefix sums: what are they and when do you use them? 🔥

A **prefix sum array** `pre[i] = nums[0] + … + nums[i-1]` answers **range sum queries in O(1)**: `sum(l..r) = pre[r+1] − pre[l]`.

Combined with a **hash map of prefix sums seen**, it solves "count subarrays with sum = k", **including negative numbers**, where a sliding window fails.

```js
function buildPrefix(nums) {
  const pre = [0];
  for (const n of nums) pre.push(pre.at(-1) + n);
  return (l, r) => pre[r + 1] - pre[l];        // inclusive range sum in O(1)
}

// Number of contiguous subarrays summing to k (works with negatives)
function subarraySum(nums, k) {
  const seen = new Map([[0, 1]]);              // prefix sum 0 occurs once (empty prefix)
  let sum = 0, count = 0;
  for (const n of nums) {
    sum += n;
    count += seen.get(sum - k) ?? 0;           // a previous prefix equal to sum-k means a subarray summing to k ends here
    seen.set(sum, (seen.get(sum) ?? 0) + 1);
  }
  return count;
}

test('prefix sums', () => {
  const rangeSum = buildPrefix([3, -1, 4, 1, 5]);
  expect(rangeSum(1, 3)).toBe(4);              // -1 + 4 + 1
  expect(rangeSum(0, 4)).toBe(12);
  expect(subarraySum([1, 1, 1], 2)).toBe(2);
  expect(subarraySum([1, -1, 0], 0)).toBe(3);  // [1,-1], [0], [1,-1,0]
});
```

### Binary search: write a bug-free template and explain "search on the answer" 🔥

Binary search works on any **monotonic** condition. Each step halves the search space, so it's **O(log n)**.

**The bug-prone details:**

- loop condition (`<` vs `<=`)
- mid calculation: `lo + ((hi - lo) >> 1)` avoids overflow in other languages; in JS, `Math.floor((lo + hi) / 2)` is fine
- updating bounds without infinite loops

**The safest template is "lower bound":** find the **first index where `condition` is true**.

**"Binary search on the answer":** when the answer is a number within a range, and "is X feasible?" is monotonic, binary search over X. Examples: minimum ship capacity to deliver within D days, minimum eating speed, square root.

```js
// First index i with nums[i] >= target (nums sorted). Returns nums.length if none.
function lowerBound(nums, target) {
  let lo = 0, hi = nums.length;               // search space [lo, hi)
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (nums[mid] >= target) hi = mid; else lo = mid + 1;
  }
  return lo;
}

function binarySearch(nums, target) {
  const i = lowerBound(nums, target);
  return i < nums.length && nums[i] === target ? i : -1;
}

// First/last position of target
const searchRange = (nums, t) => {
  const first = lowerBound(nums, t);
  if (first === nums.length || nums[first] !== t) return [-1, -1];
  return [first, lowerBound(nums, t + 1) - 1];
};

// Search on the answer: least ship capacity to ship packages (in order) within `days`
function shipWithinDays(weights, days) {
  const canShip = (cap) => {
    let needed = 1, load = 0;
    for (const w of weights) {
      if (load + w > cap) { needed++; load = 0; }
      load += w;
    }
    return needed <= days;
  };
  let lo = Math.max(...weights), hi = weights.reduce((a, b) => a + b, 0);
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (canShip(mid)) hi = mid; else lo = mid + 1;   // smallest feasible capacity
  }
  return lo;
}

// Integer square root via binary search
function mySqrt(x) {
  let lo = 0, hi = x;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;            // upper mid to avoid an infinite loop when lo = mid
    if (mid * mid <= x) lo = mid; else hi = mid - 1;
  }
  return lo;
}

test('binary search family', () => {
  expect(binarySearch([-1, 0, 3, 5, 9, 12], 9)).toBe(4);
  expect(binarySearch([-1, 0, 3, 5, 9, 12], 2)).toBe(-1);
  expect(searchRange([5, 7, 7, 8, 8, 10], 8)).toEqual([3, 4]);
  expect(searchRange([5, 7, 7, 8, 8, 10], 6)).toEqual([-1, -1]);
  expect(shipWithinDays([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toBe(15);
  expect([0, 1, 4, 8, 16, 2147395599].map(mySqrt)).toEqual([0, 1, 2, 2, 4, 46339]);
});
```

## Sorting

### Implement merge sort and quicksort, and compare sorting algorithms 🔥

| Algorithm | Best | Average | Worst | Space | Stable | Notes |
|---|---|---|---|---|---|---|
| Bubble / Insertion | O(n) | O(n²) | O(n²) | O(1) | Yes | **Insertion sort is great for small or nearly-sorted arrays** (TimSort uses it for small runs) |
| Selection | O(n²) | O(n²) | O(n²) | O(1) | No | Minimal swaps |
| **Merge sort** | O(n log n) | O(n log n) | **O(n log n)** | **O(n)** | **Yes** | Predictable; good for linked lists and external sorting |
| **Quicksort** | O(n log n) | O(n log n) | **O(n²)** (bad pivots) | O(log n) stack | No | Fast in practice (cache-friendly); randomised pivot avoids the worst case |
| Heap sort | O(n log n) | O(n log n) | O(n log n) | O(1) | No | |
| Counting / radix | O(n + k) | O(n + k) | O(n + k) | O(n + k) | Yes | Small integer ranges |
| **TimSort** (`Array.prototype.sort` in V8, Python) | O(n) | O(n log n) | O(n log n) | O(n) | **Yes** | A hybrid of merge + insertion sort that exploits existing runs |

**Stability** means equal elements keep their original order. It matters when sorting by multiple keys (sort by name, then stable-sort by role, and names stay sorted within each role).

```js
function mergeSort(arr) {
  if (arr.length <= 1) return arr;
  const mid = arr.length >> 1;
  const left = mergeSort(arr.slice(0, mid));
  const right = mergeSort(arr.slice(mid));
  const out = [];
  let i = 0, j = 0;
  while (i < left.length && j < right.length) out.push(left[i] <= right[j] ? left[i++] : right[j++]); // <= keeps it stable
  return out.concat(left.slice(i), right.slice(j));
}

function quickSort(arr, lo = 0, hi = arr.length - 1) {
  if (lo >= hi) return arr;
  const pivotIndex = lo + Math.floor(Math.random() * (hi - lo + 1));   // random pivot: expected O(n log n)
  [arr[pivotIndex], arr[hi]] = [arr[hi], arr[pivotIndex]];
  const pivot = arr[hi];
  let store = lo;
  for (let i = lo; i < hi; i++) {
    if (arr[i] < pivot) { [arr[i], arr[store]] = [arr[store], arr[i]]; store++; }  // Lomuto partition
  }
  [arr[store], arr[hi]] = [arr[hi], arr[store]];
  quickSort(arr, lo, store - 1);
  quickSort(arr, store + 1, hi);
  return arr;
}

function insertionSort(arr) {
  for (let i = 1; i < arr.length; i++) {
    const cur = arr[i];
    let j = i - 1;
    while (j >= 0 && arr[j] > cur) { arr[j + 1] = arr[j]; j--; }
    arr[j + 1] = cur;
  }
  return arr;
}

const random = Array.from({ length: 2000 }, () => Math.floor(Math.random() * 1000) - 500);
const expected = [...random].sort((a, b) => a - b);

test('sorting algorithms agree with the built-in sort', () => {
  expect(mergeSort(random)).toEqual(expected);
  expect(quickSort([...random])).toEqual(expected);
  expect(insertionSort([...random])).toEqual(expected);
  expect(mergeSort([])).toEqual([]);
  expect(quickSort([5, 5, 5, 5])).toEqual([5, 5, 5, 5]);
});

test('Array.prototype.sort is stable and string-based by default', () => {
  const people = [{ n: 'Asha', r: 2 }, { n: 'Ravi', r: 1 }, { n: 'Zara', r: 2 }, { n: 'Ben', r: 1 }];
  expect(people.toSorted((a, b) => a.r - b.r).map((p) => p.n)).toEqual(['Ravi', 'Ben', 'Asha', 'Zara']);
  expect([10, 9, 1, 100].sort()).toEqual([1, 10, 100, 9]);
});
```

## Choosing a technique

### Which data structure or pattern should you reach for? A recognition cheat sheet 🔥

| If the problem says… | Think… |
|---|---|
| "find pair/complement", "seen before", "count occurrences", "group" | **Hash map / set** |
| sorted array, "pair with sum", palindrome, "in place" | **Two pointers** |
| "contiguous subarray/substring", "longest/shortest window with…" | **Sliding window** (positive numbers) or **prefix sums + hash map** (negatives) |
| sorted / monotonic condition, "minimum X such that…" | **Binary search** (on the index or on the answer) |
| "top K", "K-th largest", "merge K sorted", streaming median | **Heap / priority queue** |
| matching brackets, "next greater element", undo, nested structure | **Stack** (monotonic stack) |
| shortest path in an unweighted grid or graph, level by level | **BFS** (queue) |
| all paths, connected components, islands, cycle detection | **DFS** / union-find |
| dependencies / ordering / prerequisites | **Topological sort** |
| "all combinations/permutations/subsets" | **Backtracking** |
| "number of ways", "min/max cost", overlapping choices | **Dynamic programming** |
| prefix matching, autocomplete | **Trie** |
| intervals: merge, overlap, rooms | **Sort by start** (+ heap for rooms) |
| LRU, O(1) get/put with order | **Hash map + doubly linked list** (or JS `Map` order) |

### What bit-manipulation tricks are worth knowing?

```js
const isPowerOfTwo = (n) => n > 0 && (n & (n - 1)) === 0;         // a single set bit
const countBits = (n) => { let c = 0; while (n) { n &= n - 1; c++; } return c; };   // Brian Kernighan
const singleNumber = (nums) => nums.reduce((x, n) => x ^ n, 0);    // every number twice except one: a^a = 0
const missingNumber = (nums) => nums.reduce((x, n, i) => x ^ n ^ (i + 1), 0);       // 0..n with one missing

test('bit tricks', () => {
  expect([1, 2, 3, 16, 18, 1024].map(isPowerOfTwo)).toEqual([true, true, false, true, false, true]);
  expect(countBits(0b1011)).toBe(3);
  expect(singleNumber([4, 1, 2, 1, 2])).toBe(4);
  expect(missingNumber([3, 0, 1])).toBe(2);
  expect(5 >> 1).toBe(2);                     // fast floor(n/2) for non-negative 32-bit ints
});
```

**JS caveat:** bitwise operators work on **32-bit signed integers**. Use `>>>` for unsigned shifts. For values beyond 2³¹, use regular arithmetic or BigInt.

### How do you traverse a grid or matrix cleanly?

Use a **directions array** and bounds checks. This is the foundation for islands, flood fill, BFS shortest path and spiral problems.

```js
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function neighbours(grid, r, c) {
  return DIRS.map(([dr, dc]) => [r + dr, c + dc]).filter(([nr, nc]) => nr >= 0 && nr < grid.length && nc >= 0 && nc < grid[0].length);
}

// Count cells reachable from (0,0) through '.' cells (BFS with an index-pointer queue: O(1) dequeue)
function reachable(grid) {
  const seen = new Set(['0,0']);
  const queue = [[0, 0]];
  for (let head = 0; head < queue.length; head++) {
    const [r, c] = queue[head];
    for (const [nr, nc] of neighbours(grid, r, c)) {
      const key = `${nr},${nc}`;
      if (grid[nr][nc] === '.' && !seen.has(key)) { seen.add(key); queue.push([nr, nc]); }
    }
  }
  return seen.size;
}

test('grid BFS', () => {
  expect(reachable(['..#', '.##', '...'])).toBe(6);       // (0,0) (0,1) (1,0) (2,0) (2,1) (2,2)
  expect(reachable(['.#', '#.'])).toBe(1);               // diagonal moves aren't allowed
});
```
