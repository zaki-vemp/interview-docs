# Dynamic Programming & Greedy (Essentials)

For non-FAANG interviews, DP usually means **the classic 1-D and 2-D problems**: climbing stairs, house robber, coin change, LIS, LCS, edit distance, unique paths, word break, knapsack. The goal is to **recognise DP**, define the **state and recurrence**, and implement it **top-down (memoised) or bottom-up (tabulated)**. Greedy problems (intervals, jump game) are shorter but need a justification of **why greedy works**.

## DP method

### How do you recognise and solve a dynamic programming problem? 🔥

**Signals:**

- "number of ways", "minimum/maximum cost or length", "is it possible", over **sequences or grids**
- choices at each step whose results **overlap**
- brute-force recursion with **repeated subproblems**

**DP applies when there's:**

1. **Optimal substructure:** the answer is built from answers to subproblems.
2. **Overlapping subproblems:** the same subproblem is solved repeatedly (naive recursion is exponential).

**The recipe:**

1. **State:** what does `dp[i]` (or `dp[i][j]`) mean, *in words*? For example, "the minimum coins needed to make amount i".
2. **Recurrence:** how does a state depend on smaller ones? For example, `dp[i] = min(dp[i − coin] + 1)`.
3. **Base cases:** `dp[0] = 0`, empty strings, the first row and column of a grid.
4. **Order:** compute states so their dependencies are ready (bottom-up), or use recursion + memoisation (top-down).
5. **Answer:** which state holds it (`dp[n]`, `dp[m][n]`, the max over all `dp[i]`).
6. **Optimise space:** often only the previous row or the last two values are needed.

**Top-down vs bottom-up:**

- **Memoisation** is easier to derive from the brute-force recursion and computes only the states it needs. It costs a recursion stack (deep recursion can overflow in JS).
- **Tabulation** is iterative with no stack risk, and easy to space-optimise.

```js
// Fibonacci three ways: exponential -> memoised O(n) -> tabulated O(1) space
const fibNaive = (n) => (n < 2 ? n : fibNaive(n - 1) + fibNaive(n - 2));            // O(2^n)

function fibMemo(n, memo = new Map()) {
  if (n < 2) return n;
  if (!memo.has(n)) memo.set(n, fibMemo(n - 1, memo) + fibMemo(n - 2, memo));
  return memo.get(n);
}

function fibTab(n) {
  let a = 0, b = 1;
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return a;
}

let calls = 0;
const countingFib = (n) => { calls++; return n < 2 ? n : countingFib(n - 1) + countingFib(n - 2); };
countingFib(25);
console.log('naive calls for fib(25):', calls, '| fib(90) =', fibTab(90));

test('fibonacci', () => {
  expect(fibNaive(20)).toBe(6765);
  expect(fibMemo(80)).toBe(23416728348467685);
  expect(fibTab(80)).toBe(23416728348467685);
});
```

## 1-D DP

### Climbing Stairs, and Min Cost Climbing Stairs 🔥

**Climbing stairs** (1 or 2 steps at a time): the number of ways to reach step n is `ways(n) = ways(n−1) + ways(n−2)`, which is Fibonacci. **O(n) time, O(1) space.**

```js
function climbStairs(n) {
  let oneBack = 1, twoBack = 1;                 // ways(1) = 1, ways(0) = 1
  for (let i = 2; i <= n; i++) [twoBack, oneBack] = [oneBack, oneBack + twoBack];
  return oneBack;
}

// General version: allowed step sizes
function climbWithSteps(n, steps) {
  const dp = new Array(n + 1).fill(0);
  dp[0] = 1;
  for (let i = 1; i <= n; i++) for (const s of steps) if (i - s >= 0) dp[i] += dp[i - s];
  return dp[n];
}

// Pay cost[i] to step on stair i; start at 0 or 1; reach the top (beyond the last index)
function minCostClimbingStairs(cost) {
  let a = 0, b = 0;                              // min cost to reach stair i-2, i-1
  for (let i = 2; i <= cost.length; i++) [a, b] = [b, Math.min(b + cost[i - 1], a + cost[i - 2])];
  return b;
}

test('stairs', () => {
  expect([1, 2, 3, 4, 5].map(climbStairs)).toEqual([1, 2, 3, 5, 8]);
  expect(climbWithSteps(4, [1, 2, 3])).toBe(7);
  expect(minCostClimbingStairs([10, 15, 20])).toBe(15);
  expect(minCostClimbingStairs([1, 100, 1, 1, 1, 100, 1, 1, 100, 1])).toBe(6);
});
```

### House Robber (no two adjacent houses) 🔥

**State:** `dp[i]` = the maximum you can rob from the first i houses. **Recurrence:** `dp[i] = max(dp[i−1], dp[i−2] + nums[i−1])` (skip this house, or rob it plus the best result up to two houses back). **O(n) time, O(1) space.**

**Circular variant** (the first and last houses are adjacent): run the linear version on `nums[0..n−2]` and on `nums[1..n−1]` and take the max.

```js
function rob(nums) {
  let prev2 = 0, prev1 = 0;
  for (const x of nums) [prev2, prev1] = [prev1, Math.max(prev1, prev2 + x)];
  return prev1;
}

const robCircular = (nums) => (nums.length === 1 ? nums[0] : Math.max(rob(nums.slice(0, -1)), rob(nums.slice(1))));

test('house robber', () => {
  expect(rob([1, 2, 3, 1])).toBe(4);
  expect(rob([2, 7, 9, 3, 1])).toBe(12);
  expect(robCircular([2, 3, 2])).toBe(3);
  expect(robCircular([1, 2, 3, 1])).toBe(4);
});
```

### Coin Change: fewest coins, and number of ways 🔥

- **Fewest coins** (unbounded supply): `dp[a] = min over coins c of dp[a − c] + 1`, with `dp[0] = 0` and **Infinity** marking unreachable amounts. **O(amount × coins).** Greedy (always take the largest coin) **fails** for coin systems such as [1, 3, 4] with amount 6: greedy gives 4 + 1 + 1, but the optimum is 3 + 3.
- **Number of combinations** (order doesn't matter): **loop over coins on the outside** so each combination is counted once. Looping over amounts on the outside counts permutations instead.

```js
function coinChange(coins, amount) {
  const dp = new Array(amount + 1).fill(Infinity);
  dp[0] = 0;
  for (let a = 1; a <= amount; a++) {
    for (const c of coins) if (c <= a && dp[a - c] + 1 < dp[a]) dp[a] = dp[a - c] + 1;
  }
  return dp[amount] === Infinity ? -1 : dp[amount];
}

function coinCombinations(coins, amount) {
  const dp = new Array(amount + 1).fill(0);
  dp[0] = 1;
  for (const c of coins) for (let a = c; a <= amount; a++) dp[a] += dp[a - c];   // coins outer -> combinations
  return dp[amount];
}

test('coin change', () => {
  expect(coinChange([1, 2, 5], 11)).toBe(3);   // 5+5+1
  expect(coinChange([2], 3)).toBe(-1);
  expect(coinChange([1, 3, 4], 6)).toBe(2);    // 3+3 (greedy would give 3 coins)
  expect(coinChange([1], 0)).toBe(0);
  expect(coinCombinations([1, 2, 5], 5)).toBe(4);
});
```

### Longest Increasing Subsequence: O(n²) DP and O(n log n) patience sorting 🔥

- **O(n²) DP:** `dp[i]` = the length of the LIS ending at i = `1 + max(dp[j])` over `j < i` with `nums[j] < nums[i]`.
- **O(n log n):** keep `tails[k]` = the **smallest possible tail** of an increasing subsequence of length k + 1. For each number, **binary search** the first tail ≥ x and replace it (or append). The length of `tails` is the answer. (`tails` itself isn't necessarily a valid subsequence.)

```js
function lisQuadratic(nums) {
  const dp = new Array(nums.length).fill(1);
  for (let i = 1; i < nums.length; i++)
    for (let j = 0; j < i; j++) if (nums[j] < nums[i]) dp[i] = Math.max(dp[i], dp[j] + 1);
  return nums.length ? Math.max(...dp) : 0;
}

function lisFast(nums) {
  const tails = [];
  for (const x of nums) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < x) lo = mid + 1; else hi = mid; }
    tails[lo] = x;                                // replace or append
  }
  return tails.length;
}

test('LIS', () => {
  for (const [input, expected] of [[[10, 9, 2, 5, 3, 7, 101, 18], 4], [[0, 1, 0, 3, 2, 3], 4], [[7, 7, 7, 7], 1], [[], 0]]) {
    expect(lisQuadratic(input)).toBe(expected);
    expect(lisFast(input)).toBe(expected);
  }
});
```

### Word Break 🔥

**State:** `dp[i]` = whether the prefix `s[0..i)` can be segmented into dictionary words. **Recurrence:** `dp[i] = true` if any `j < i` has `dp[j]` true and `s[j..i)` in the dictionary. Limit `j` to the maximum word length for speed. **O(n · maxLen)** substring checks. It's related to **tokenisation** and to splitting hashtags or concatenated words in search features.

```js
function wordBreak(s, words) {
  const dict = new Set(words);
  const maxLen = Math.max(0, ...words.map((w) => w.length));
  const dp = new Array(s.length + 1).fill(false);
  dp[0] = true;
  for (let i = 1; i <= s.length; i++) {
    for (let j = Math.max(0, i - maxLen); j < i && !dp[i]; j++) {
      if (dp[j] && dict.has(s.slice(j, i))) dp[i] = true;
    }
  }
  return dp[s.length];
}

// Return one segmentation (reconstruct by remembering the split point)
function segment(s, words) {
  const dict = new Set(words);
  const from = new Array(s.length + 1).fill(-1);
  from[0] = 0;
  for (let i = 1; i <= s.length; i++)
    for (let j = 0; j < i; j++) if (from[j] !== -1 && dict.has(s.slice(j, i))) { from[i] = j; break; }
  if (from[s.length] === -1) return null;
  const parts = [];
  for (let i = s.length; i > 0; i = from[i]) parts.unshift(s.slice(from[i], i));
  return parts;
}

test('word break', () => {
  expect(wordBreak('leetcode', ['leet', 'code'])).toBe(true);
  expect(wordBreak('applepenapple', ['apple', 'pen'])).toBe(true);
  expect(wordBreak('catsandog', ['cats', 'dog', 'sand', 'and', 'cat'])).toBe(false);
  expect(segment('startrecording', ['start', 'record', 'recording', 'ing'])).toEqual(['start', 'recording']);
});
```

### Decode Ways ("226" → 3)

`dp[i]` = the number of ways to decode the first i characters. A single digit 1–9 adds `dp[i−1]`; a two-digit 10–26 adds `dp[i−2]`. Watch out for zeros.

```js
function numDecodings(s) {
  let prev2 = 1, prev1 = s[0] === '0' ? 0 : 1;      // dp[i-2], dp[i-1]
  for (let i = 2; i <= s.length; i++) {
    let cur = 0;
    if (s[i - 1] !== '0') cur += prev1;
    const two = Number(s.slice(i - 2, i));
    if (two >= 10 && two <= 26) cur += prev2;
    [prev2, prev1] = [prev1, cur];
  }
  return s.length ? prev1 : 0;
}

test('decode ways', () => {
  expect(numDecodings('12')).toBe(2);
  expect(numDecodings('226')).toBe(3);
  expect(numDecodings('06')).toBe(0);
  expect(numDecodings('10')).toBe(1);
});
```

## 2-D DP

### Unique Paths and Minimum Path Sum in a grid 🔥

**Grid DP:** each cell depends on the cell **above** and the cell to the **left**. A single rolling row gives **O(cols)** space.

```js
function uniquePaths(m, n) {
  const row = new Array(n).fill(1);                      // first row: one way to each cell
  for (let r = 1; r < m; r++) for (let c = 1; c < n; c++) row[c] += row[c - 1];
  return row[n - 1];
}

function uniquePathsWithObstacles(grid) {
  const n = grid[0].length;
  const row = new Array(n).fill(0);
  row[0] = grid[0][0] === 1 ? 0 : 1;
  for (const cells of grid) {
    for (let c = 0; c < n; c++) {
      if (cells[c] === 1) row[c] = 0;
      else if (c > 0) row[c] += row[c - 1];
    }
  }
  return row[n - 1];
}

function minPathSum(grid) {
  const n = grid[0].length;
  const row = new Array(n).fill(Infinity);
  row[0] = 0;
  for (const cells of grid) {
    row[0] += cells[0];
    for (let c = 1; c < n; c++) row[c] = Math.min(row[c], row[c - 1]) + cells[c];
  }
  return row[n - 1];
}

test('grid DP', () => {
  expect(uniquePaths(3, 7)).toBe(28);
  expect(uniquePaths(3, 2)).toBe(3);
  expect(uniquePathsWithObstacles([[0, 0, 0], [0, 1, 0], [0, 0, 0]])).toBe(2);
  expect(minPathSum([[1, 3, 1], [1, 5, 1], [4, 2, 1]])).toBe(7);
});
```

### Longest Common Subsequence and Edit Distance 🔥

These are **two-sequence DPs** with `dp[i][j]` over the prefixes `a[0..i)` and `b[0..j)`. **O(m·n) time**, and O(n) space with a rolling row.

- **LCS:** if `a[i−1] === b[j−1]`, then `dp[i][j] = dp[i−1][j−1] + 1`; otherwise `max(dp[i−1][j], dp[i][j−1])`. **Uses:** diff tools (`git diff`, text compare), and comparing an edited transcript with the original (scQuill).
- **Edit distance (Levenshtein):** if the characters are equal, `dp[i][j] = dp[i−1][j−1]`; otherwise `1 + min(insert dp[i][j−1], delete dp[i−1][j], replace dp[i−1][j−1])`. **Uses:** spell-check, **fuzzy search** in participant lists ("did you mean…"), and **word error rate** (WER) for evaluating transcription quality.

```js
function longestCommonSubsequence(a, b) {
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length];
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);      // "" -> b[0..j) needs j inserts
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];                                                 // a[0..i) -> "" needs i deletes
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(cur[j - 1], prev[j], prev[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length];
}

// Word error rate for transcripts = word-level edit distance / reference length
const wer = (reference, hypothesis) => editDistance(reference.split(' '), hypothesis.split(' ')) / reference.split(' ').length;

test('sequence DP', () => {
  expect(longestCommonSubsequence('abcde', 'ace')).toBe(3);
  expect(longestCommonSubsequence('abc', 'def')).toBe(0);
  expect(editDistance('horse', 'ros')).toBe(3);
  expect(editDistance('intention', 'execution')).toBe(5);
  expect(editDistance('', 'abc')).toBe(3);
  expect(wer('where were you on tuesday', 'where you on thursday')).toBe(0.4);   // 1 deletion + 1 substitution
});
```

(Arrays work too: `editDistance` compares elements with `===`, so passing word arrays gives word-level distances.)

### 0/1 Knapsack and Partition Equal Subset Sum 🔥

- **0/1 knapsack:** each item is used **at most once**. `dp[w]` = the best value with capacity w. **Iterate w downward** so each item counts once. Iterating upward gives the unbounded knapsack (as in coin change). **O(n · W).**
- **Partition Equal Subset Sum:** can the array be split into two subsets with equal sums? That's a knapsack with boolean states and target `sum / 2`.

```js
function knapsack(weights, values, capacity) {
  const dp = new Array(capacity + 1).fill(0);
  for (let i = 0; i < weights.length; i++) {
    for (let w = capacity; w >= weights[i]; w--) {        // downward: each item used once
      dp[w] = Math.max(dp[w], dp[w - weights[i]] + values[i]);
    }
  }
  return dp[capacity];
}

function canPartition(nums) {
  const sum = nums.reduce((a, b) => a + b, 0);
  if (sum % 2) return false;
  const target = sum / 2;
  const dp = new Array(target + 1).fill(false);
  dp[0] = true;
  for (const x of nums) for (let s = target; s >= x; s--) dp[s] ||= dp[s - x];
  return dp[target];
}

// Real-world flavour: choose recordings to fit a storage quota while maximising "importance"
test('knapsack family', () => {
  expect(knapsack([1, 3, 4, 5], [1, 4, 5, 7], 7)).toBe(9);     // items 3+4 -> 4+5
  expect(canPartition([1, 5, 11, 5])).toBe(true);
  expect(canPartition([1, 2, 3, 5])).toBe(false);
});
```

## Greedy

### When does a greedy algorithm work? Explain with interval scheduling 🔥

**Greedy** makes the **locally optimal choice** at each step and never reconsiders. It works when the problem has the **greedy-choice property**: some optimal solution includes the greedy choice. You usually justify it with an **exchange argument**: "if an optimal solution didn't pick this, we could swap our choice in without making it worse".

**Interval scheduling** (the maximum number of non-overlapping meetings in one room): **sort by end time** and pick each meeting that starts after the last picked one ends. Choosing the meeting that **ends earliest** leaves the most room for the rest.

The related "Non-overlapping Intervals" problem (the minimum number to remove to make the rest non-overlapping) is `n − maxNonOverlapping`.

```js
function maxNonOverlapping(intervals) {
  const sorted = [...intervals].sort((a, b) => a[1] - b[1]);   // earliest end first
  let count = 0, lastEnd = -Infinity;
  for (const [s, e] of sorted) {
    if (s >= lastEnd) { count++; lastEnd = e; }
  }
  return count;
}

const eraseOverlapIntervals = (intervals) => intervals.length - maxNonOverlapping(intervals);

// Minimum arrows to burst balloons (points on a line): another earliest-end greedy
function findMinArrowShots(points) {
  const sorted = [...points].sort((a, b) => a[1] - b[1]);
  let arrows = 0, lastShot = -Infinity;
  for (const [s, e] of sorted) if (s > lastShot) { arrows++; lastShot = e; }
  return arrows;
}

test('interval greedy', () => {
  expect(maxNonOverlapping([[1, 2], [2, 3], [3, 4], [1, 3]])).toBe(3);
  expect(eraseOverlapIntervals([[1, 2], [2, 3], [3, 4], [1, 3]])).toBe(1);
  expect(eraseOverlapIntervals([[1, 2], [1, 2], [1, 2]])).toBe(2);
  expect(findMinArrowShots([[10, 16], [2, 8], [1, 6], [7, 12]])).toBe(2);
});
```

### Jump Game I and II 🔥

- **Jump Game I** (can you reach the end?): track the **farthest reachable index**. If the current index ever exceeds it, you're stuck. **O(n).**
- **Jump Game II** (minimum jumps): a **BFS by levels in disguise**. Track the current jump's range end and the farthest point reachable from it; when you hit the range end, take another jump. **O(n).**

```js
function canJump(nums) {
  let farthest = 0;
  for (let i = 0; i < nums.length; i++) {
    if (i > farthest) return false;
    farthest = Math.max(farthest, i + nums[i]);
  }
  return true;
}

function minJumps(nums) {
  let jumps = 0, currentEnd = 0, farthest = 0;
  for (let i = 0; i < nums.length - 1; i++) {
    farthest = Math.max(farthest, i + nums[i]);
    if (i === currentEnd) { jumps++; currentEnd = farthest; }
  }
  return jumps;
}

test('jump game', () => {
  expect(canJump([2, 3, 1, 1, 4])).toBe(true);
  expect(canJump([3, 2, 1, 0, 4])).toBe(false);
  expect(minJumps([2, 3, 1, 1, 4])).toBe(2);
  expect(minJumps([0])).toBe(0);
});
```

### Gas Station, and Best Time to Buy and Sell (greedy proofs)

- **Gas Station:** if the total gas is at least the total cost, a solution exists. **Reset the start** to `i + 1` whenever the running tank goes negative, because no station between the old start and `i` can work. **O(n).**
- **Stock with unlimited transactions:** summing every positive day-to-day difference is optimal (see the arrays doc). Any profitable multi-day hold decomposes into daily gains.

```js
function canCompleteCircuit(gas, cost) {
  let total = 0, tank = 0, start = 0;
  for (let i = 0; i < gas.length; i++) {
    const diff = gas[i] - cost[i];
    total += diff;
    tank += diff;
    if (tank < 0) { start = i + 1; tank = 0; }
  }
  return total >= 0 ? start : -1;
}

test('gas station', () => {
  expect(canCompleteCircuit([1, 2, 3, 4, 5], [3, 4, 5, 1, 2])).toBe(3);
  expect(canCompleteCircuit([2, 3, 4], [3, 4, 3])).toBe(-1);
});
```

### Task scheduling: minimise the time to run tasks with a cooldown

**Task Scheduler** (identical tasks need n idle slots between them): the answer is `max(tasks.length, (maxFreq − 1) × (n + 1) + countOfMaxFreq)`. The most frequent tasks determine the frame, and other tasks fill the gaps. This greedy formula is a frequent "aha" question. It's similar to spacing out retries of the same job, or rate-limiting the same Jibri instance.

```js
function leastInterval(tasks, n) {
  const freq = new Map();
  for (const t of tasks) freq.set(t, (freq.get(t) ?? 0) + 1);
  const maxFreq = Math.max(...freq.values());
  const countMax = [...freq.values()].filter((f) => f === maxFreq).length;
  return Math.max(tasks.length, (maxFreq - 1) * (n + 1) + countMax);
}

test('task scheduler', () => {
  expect(leastInterval(['A', 'A', 'A', 'B', 'B', 'B'], 2)).toBe(8);   // A B _ A B _ A B
  expect(leastInterval(['A', 'A', 'A', 'B', 'B', 'B'], 0)).toBe(6);
  expect(leastInterval(['A', 'A', 'A', 'A', 'A', 'A', 'B', 'C', 'D', 'E', 'F', 'G'], 2)).toBe(16);
});
```

### Greedy or DP: how do you decide? 🔥

| | Greedy | Dynamic programming |
|---|---|---|
| Decision | One irrevocable local choice per step | Considers **all** choices for each subproblem and keeps the best |
| Correctness | Needs a **proof** (exchange argument, greedy-choice property); fails silently otherwise | Correct whenever the recurrence is right |
| Complexity | Usually O(n) or O(n log n) (after sorting) | Usually O(n²), O(n·W), O(m·n) |
| Examples where greedy works | Interval scheduling (by earliest end), jump game, gas station, Huffman coding, Dijkstra, canonical coin systems | — |
| Examples where greedy fails | Coin change with arbitrary coins ([1, 3, 4] → 6), 0/1 knapsack, LIS, edit distance | Use DP |

**Interview tip:** if you propose a greedy solution, **test it on a small counterexample** before coding. If you can't justify it, fall back to DP.
