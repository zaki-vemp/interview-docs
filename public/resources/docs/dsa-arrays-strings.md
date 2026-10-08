# Arrays, Strings & Hashing Problems

The most frequently asked **easy/medium** problems at product companies, in JavaScript. For each: the **brute force**, the **optimal idea**, **complexity**, and **runnable tests**. Try each one yourself in the playground first (`Ctrl + backquote`); the test block tells you immediately whether your version works.

## Hashing

### Two Sum: return the indices of two numbers that add up to the target 🔥

**Brute force:** check all pairs, O(n²). **Optimal:** one pass with a **hash map from value to index**. For each number, check whether its **complement** (`target − x`) was already seen. **O(n) time, O(n) space.**

```js
function twoSum(nums, target) {
  const indexOf = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (indexOf.has(need)) return [indexOf.get(need), i];
    indexOf.set(nums[i], i);                 // store AFTER checking, so an element isn't paired with itself
  }
  return [];
}

test('twoSum', () => {
  expect(twoSum([2, 7, 11, 15], 9)).toEqual([0, 1]);
  expect(twoSum([3, 2, 4], 6)).toEqual([1, 2]);
  expect(twoSum([3, 3], 6)).toEqual([0, 1]);
  expect(twoSum([1, 2], 7)).toEqual([]);
});
```

### Contains Duplicate, and Contains Duplicate within distance k

```js
const containsDuplicate = (nums) => new Set(nums).size !== nums.length;     // O(n)

function containsNearbyDuplicate(nums, k) {                                   // |i - j| <= k
  const lastIndex = new Map();
  for (let i = 0; i < nums.length; i++) {
    if (lastIndex.has(nums[i]) && i - lastIndex.get(nums[i]) <= k) return true;
    lastIndex.set(nums[i], i);
  }
  return false;
}

test('duplicates', () => {
  expect(containsDuplicate([1, 2, 3, 1])).toBe(true);
  expect(containsDuplicate([1, 2, 3, 4])).toBe(false);
  expect(containsNearbyDuplicate([1, 2, 3, 1], 3)).toBe(true);
  expect(containsNearbyDuplicate([1, 2, 3, 1, 2, 3], 2)).toBe(false);
});
```

### Valid Anagram and Group Anagrams 🔥

- **Valid Anagram:** count characters. One map, increment for `s` and decrement for `t`. **O(n)**. Sorting both strings is O(n log n).
- **Group Anagrams:** use a canonical **key** per word (sorted letters, O(k log k); or a 26-letter count signature, O(k)) and group in a map. **O(n·k)**.

```js
function isAnagram(s, t) {
  if (s.length !== t.length) return false;
  const count = new Map();
  for (const c of s) count.set(c, (count.get(c) ?? 0) + 1);
  for (const c of t) {
    if (!count.get(c)) return false;
    count.set(c, count.get(c) - 1);
  }
  return true;
}

function groupAnagrams(words) {
  const groups = new Map();
  for (const w of words) {
    const counts = new Array(26).fill(0);
    for (const c of w) counts[c.charCodeAt(0) - 97]++;
    const key = counts.join('#');               // O(k) signature, avoids sorting
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }
  return [...groups.values()];
}

test('anagrams', () => {
  expect(isAnagram('anagram', 'nagaram')).toBe(true);
  expect(isAnagram('rat', 'car')).toBe(false);
  const g = groupAnagrams(['eat', 'tea', 'tan', 'ate', 'nat', 'bat']).map((x) => x.sort()).sort((a, b) => a.length - b.length || a[0].localeCompare(b[0]));
  expect(g).toEqual([['bat'], ['nat', 'tan'], ['ate', 'eat', 'tea']]);
});
```

### Top K Frequent Elements 🔥

**Options:**

1. Count frequencies, then sort the entries by count: O(n log n).
2. A min-heap of size k: O(n log k). See the heaps doc.
3. **Bucket sort by frequency:** index = count, so **O(n)**. Frequencies are bounded by n.

```js
function topKFrequent(nums, k) {
  const freq = new Map();
  for (const n of nums) freq.set(n, (freq.get(n) ?? 0) + 1);
  const buckets = Array.from({ length: nums.length + 1 }, () => []);
  for (const [num, count] of freq) buckets[count].push(num);
  const result = [];
  for (let c = buckets.length - 1; c > 0 && result.length < k; c--) result.push(...buckets[c]);
  return result.slice(0, k);
}

test('topKFrequent', () => {
  expect(topKFrequent([1, 1, 1, 2, 2, 3], 2)).toEqual([1, 2]);
  expect(topKFrequent([4], 1)).toEqual([4]);
});
```

### Longest Consecutive Sequence (in O(n))

**Idea:** put all the numbers in a Set. Only **start counting from numbers that begin a sequence** (`n − 1` isn't in the set), then walk upward. Each number is visited at most twice, so the whole thing is **O(n)**. Sorting would be O(n log n).

```js
function longestConsecutive(nums) {
  const set = new Set(nums);
  let best = 0;
  for (const n of set) {
    if (set.has(n - 1)) continue;              // not a sequence start
    let len = 1;
    while (set.has(n + len)) len++;
    best = Math.max(best, len);
  }
  return best;
}

test('longestConsecutive', () => {
  expect(longestConsecutive([100, 4, 200, 1, 3, 2])).toBe(4);
  expect(longestConsecutive([0, 3, 7, 2, 5, 8, 4, 6, 0, 1])).toBe(9);
  expect(longestConsecutive([])).toBe(0);
});
```

### First non-repeating character, and Majority Element (Boyer–Moore)

```js
function firstUniqChar(s) {
  const count = new Map();
  for (const c of s) count.set(c, (count.get(c) ?? 0) + 1);
  for (let i = 0; i < s.length; i++) if (count.get(s[i]) === 1) return i;
  return -1;
}

// Majority element (appears > n/2 times) in O(n) time, O(1) space
function majorityElement(nums) {
  let candidate = null, votes = 0;
  for (const n of nums) {
    if (votes === 0) candidate = n;
    votes += n === candidate ? 1 : -1;        // pairs of different elements cancel out
  }
  return candidate;
}

test('counting problems', () => {
  expect(firstUniqChar('leetcode')).toBe(0);
  expect(firstUniqChar('loveleetcode')).toBe(2);
  expect(firstUniqChar('aabb')).toBe(-1);
  expect(majorityElement([2, 2, 1, 1, 1, 2, 2])).toBe(2);
});
```

## Array techniques

### Best Time to Buy and Sell Stock (one transaction) 🔥

**Idea:** track the **minimum price so far**. At each day, the best profit from selling today is `price − minSoFar`. **O(n), O(1).**

```js
function maxProfit(prices) {
  let minPrice = Infinity, best = 0;
  for (const p of prices) {
    minPrice = Math.min(minPrice, p);
    best = Math.max(best, p - minPrice);
  }
  return best;
}

// Variant: unlimited transactions -> sum every positive day-to-day increase
const maxProfitUnlimited = (prices) => prices.reduce((sum, p, i) => sum + Math.max(0, i ? p - prices[i - 1] : 0), 0);

test('stock', () => {
  expect(maxProfit([7, 1, 5, 3, 6, 4])).toBe(5);
  expect(maxProfit([7, 6, 4, 3, 1])).toBe(0);
  expect(maxProfitUnlimited([7, 1, 5, 3, 6, 4])).toBe(7);
});
```

### Maximum Subarray (Kadane's algorithm) 🔥

**Idea:** at each position, either **extend** the previous subarray or **start fresh**: `cur = max(x, cur + x)`. Track the global best. **O(n), O(1).** It handles all-negative arrays (the answer is the largest element).

```js
function maxSubArray(nums) {
  let cur = nums[0], best = nums[0];
  for (let i = 1; i < nums.length; i++) {
    cur = Math.max(nums[i], cur + nums[i]);
    best = Math.max(best, cur);
  }
  return best;
}

// Also return the subarray boundaries
function maxSubArrayWithRange(nums) {
  let cur = nums[0], best = nums[0], start = 0, bestStart = 0, bestEnd = 0;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] > cur + nums[i]) { cur = nums[i]; start = i; } else cur += nums[i];
    if (cur > best) { best = cur; bestStart = start; bestEnd = i; }
  }
  return { sum: best, range: [bestStart, bestEnd] };
}

test('Kadane', () => {
  expect(maxSubArray([-2, 1, -3, 4, -1, 2, 1, -5, 4])).toBe(6);
  expect(maxSubArray([-3, -1, -2])).toBe(-1);
  expect(maxSubArrayWithRange([-2, 1, -3, 4, -1, 2, 1, -5, 4])).toEqual({ sum: 6, range: [3, 6] });
});
```

### Product of Array Except Self (without division) 🔥

**Idea:** `answer[i] = (product of everything left of i) × (product of everything right of i)`. Compute the left products in the output array, then multiply by a running right product. **O(n) time, O(1) extra space** (the output doesn't count). It handles zeros correctly, unlike the division approach.

```js
function productExceptSelf(nums) {
  const out = new Array(nums.length).fill(1);
  let left = 1;
  for (let i = 0; i < nums.length; i++) { out[i] = left; left *= nums[i]; }
  let right = 1;
  for (let i = nums.length - 1; i >= 0; i--) { out[i] *= right; right *= nums[i]; }
  return out;
}

test('productExceptSelf', () => {
  expect(productExceptSelf([1, 2, 3, 4])).toEqual([24, 12, 8, 6]);
  expect(productExceptSelf([-1, 1, 0, -3, 3]).map((x) => x + 0)).toEqual([0, 0, 9, 0, 0]);   // +0 normalises -0
});
```

### Move Zeroes and Merge Sorted Array (in place)

```js
// Move all zeros to the end, keeping the order of non-zeros, in place
function moveZeroes(nums) {
  let write = 0;
  for (let read = 0; read < nums.length; read++) {
    if (nums[read] !== 0) [nums[write++], nums[read]] = [nums[read], nums[write]];
  }
  return nums;
}

// Merge nums2 into nums1 (nums1 has m real values + n slots at the end): fill from the BACK
function mergeSorted(nums1, m, nums2, n) {
  let i = m - 1, j = n - 1, k = m + n - 1;
  while (j >= 0) nums1[k--] = i >= 0 && nums1[i] > nums2[j] ? nums1[i--] : nums2[j--];
  return nums1;
}

test('in-place array ops', () => {
  expect(moveZeroes([0, 1, 0, 3, 12])).toEqual([1, 3, 12, 0, 0]);
  expect(mergeSorted([1, 2, 3, 0, 0, 0], 3, [2, 5, 6], 3)).toEqual([1, 2, 2, 3, 5, 6]);
  expect(mergeSorted([0], 0, [1], 1)).toEqual([1]);
});
```

### Rotate Array by k steps (in place)

**Idea:** reverse the whole array, then reverse the first k elements, then reverse the rest. **O(n), O(1).** Normalise `k %= n` first.

```js
function rotate(nums, k) {
  const n = nums.length;
  k %= n;
  const reverse = (l, r) => { while (l < r) [nums[l++], nums[r--]] = [nums[r], nums[l]]; };
  reverse(0, n - 1);
  reverse(0, k - 1);
  reverse(k, n - 1);
  return nums;
}

test('rotate', () => {
  expect(rotate([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([5, 6, 7, 1, 2, 3, 4]);
  expect(rotate([-1, -100, 3, 99], 2)).toEqual([3, 99, -1, -100]);
  expect(rotate([1, 2], 5)).toEqual([2, 1]);
});
```

### Container With Most Water 🔥

**Two pointers from both ends.** The area is `min(h[l], h[r]) × (r − l)`. **Always move the shorter side.** Moving the taller one can never increase the area, because the width shrinks and the height is still capped by the shorter side. **O(n).**

```js
function maxArea(height) {
  let l = 0, r = height.length - 1, best = 0;
  while (l < r) {
    best = Math.max(best, Math.min(height[l], height[r]) * (r - l));
    if (height[l] < height[r]) l++; else r--;
  }
  return best;
}

test('maxArea', () => {
  expect(maxArea([1, 8, 6, 2, 5, 4, 8, 3, 7])).toBe(49);
  expect(maxArea([1, 1])).toBe(1);
});
```

### 3Sum: all unique triplets that sum to zero 🔥

**Idea:** **sort**, then for each `i`, run **two pointers** on the rest. **Skip duplicates** for `i`, `l` and `r` to keep the triplets unique. **O(n²)** time (better than O(n³)), O(1) extra space apart from the output.

```js
function threeSum(nums) {
  nums = [...nums].sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < nums.length - 2; i++) {
    if (nums[i] > 0) break;                          // the rest are positive
    if (i > 0 && nums[i] === nums[i - 1]) continue;  // skip duplicate anchors
    let l = i + 1, r = nums.length - 1;
    while (l < r) {
      const sum = nums[i] + nums[l] + nums[r];
      if (sum < 0) l++;
      else if (sum > 0) r--;
      else {
        result.push([nums[i], nums[l], nums[r]]);
        while (l < r && nums[l] === nums[l + 1]) l++;
        while (l < r && nums[r] === nums[r - 1]) r--;
        l++; r--;
      }
    }
  }
  return result;
}

test('threeSum', () => {
  expect(threeSum([-1, 0, 1, 2, -1, -4])).toEqual([[-1, -1, 2], [-1, 0, 1]]);
  expect(threeSum([0, 0, 0, 0])).toEqual([[0, 0, 0]]);
  expect(threeSum([0, 1, 1])).toEqual([]);
});
```

### Trapping Rain Water

**Two pointers:** water at an index is `min(maxLeft, maxRight) − height`. Move the side with the **smaller max**, because that side's water level is already determined. **O(n), O(1).**

```js
function trap(height) {
  let l = 0, r = height.length - 1, leftMax = 0, rightMax = 0, water = 0;
  while (l < r) {
    if (height[l] < height[r]) {
      leftMax = Math.max(leftMax, height[l]);
      water += leftMax - height[l++];
    } else {
      rightMax = Math.max(rightMax, height[r]);
      water += rightMax - height[r--];
    }
  }
  return water;
}

test('trap', () => {
  expect(trap([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1])).toBe(6);
  expect(trap([4, 2, 0, 3, 2, 5])).toBe(9);
  expect(trap([])).toBe(0);
});
```

### Missing Number and Find All Duplicates (index tricks)

```js
// 0..n with exactly one missing: Gauss sum (or XOR)
const missingNumber = (nums) => (nums.length * (nums.length + 1)) / 2 - nums.reduce((a, b) => a + b, 0);

// Values in 1..n, some appear twice: mark seen by negating the value at index |v|-1 (O(n), O(1) extra)
function findDuplicates(nums) {
  const out = [];
  for (const v of nums) {
    const idx = Math.abs(v) - 1;
    if (nums[idx] < 0) out.push(Math.abs(v));
    else nums[idx] = -nums[idx];
  }
  return out;
}

test('index tricks', () => {
  expect(missingNumber([9, 6, 4, 2, 3, 5, 7, 0, 1])).toBe(8);
  expect(findDuplicates([4, 3, 2, 7, 8, 2, 3, 1]).sort()).toEqual([2, 3]);
});
```

## Binary search on arrays

### Search in a rotated sorted array 🔥

**Idea:** modified binary search. At each step, **one half is sorted**. Check whether the target lies in the sorted half, and discard the other half accordingly. **O(log n).**

```js
function searchRotated(nums, target) {
  let lo = 0, hi = nums.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (nums[mid] === target) return mid;
    if (nums[lo] <= nums[mid]) {                          // left half sorted
      if (nums[lo] <= target && target < nums[mid]) hi = mid - 1; else lo = mid + 1;
    } else {                                              // right half sorted
      if (nums[mid] < target && target <= nums[hi]) lo = mid + 1; else hi = mid - 1;
    }
  }
  return -1;
}

// Minimum of a rotated sorted array (no duplicates)
function findMin(nums) {
  let lo = 0, hi = nums.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (nums[mid] > nums[hi]) lo = mid + 1; else hi = mid;   // the min is right of mid, or at/left of mid
  }
  return nums[lo];
}

test('rotated array', () => {
  expect(searchRotated([4, 5, 6, 7, 0, 1, 2], 0)).toBe(4);
  expect(searchRotated([4, 5, 6, 7, 0, 1, 2], 3)).toBe(-1);
  expect(searchRotated([1], 1)).toBe(0);
  expect(findMin([3, 4, 5, 1, 2])).toBe(1);
  expect(findMin([11, 13, 15, 17])).toBe(11);
});
```

## Intervals & matrices

### Merge Intervals 🔥

**Idea:** **sort by start**. Then walk through the intervals: if the current one overlaps the last merged interval (`start ≤ last.end`), extend `last.end`; otherwise push it as a new interval. **O(n log n).**

Real-world use: merging busy time slots, combining highlighted ranges in a transcript, merging redaction rectangles.

```js
function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

// Insert a new interval into sorted, non-overlapping intervals
function insertInterval(intervals, [s, e]) {
  const out = [];
  let i = 0;
  while (i < intervals.length && intervals[i][1] < s) out.push(intervals[i++]);               // entirely before
  while (i < intervals.length && intervals[i][0] <= e) { s = Math.min(s, intervals[i][0]); e = Math.max(e, intervals[i][1]); i++; }
  out.push([s, e]);
  while (i < intervals.length) out.push(intervals[i++]);                                      // entirely after
  return out;
}

test('intervals', () => {
  expect(mergeIntervals([[1, 3], [2, 6], [8, 10], [15, 18]])).toEqual([[1, 6], [8, 10], [15, 18]]);
  expect(mergeIntervals([[1, 4], [4, 5]])).toEqual([[1, 5]]);
  expect(mergeIntervals([[1, 4], [0, 0]])).toEqual([[0, 0], [1, 4]]);
  expect(insertInterval([[1, 2], [3, 5], [6, 7], [8, 10], [12, 16]], [4, 8])).toEqual([[1, 2], [3, 10], [12, 16]]);
});
```

### Spiral Matrix and Rotate Image 🔥

```js
function spiralOrder(matrix) {
  const out = [];
  let top = 0, bottom = matrix.length - 1, left = 0, right = matrix[0].length - 1;
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) out.push(matrix[top][c]);
    top++;
    for (let r = top; r <= bottom; r++) out.push(matrix[r][right]);
    right--;
    if (top <= bottom) { for (let c = right; c >= left; c--) out.push(matrix[bottom][c]); bottom--; }
    if (left <= right) { for (let r = bottom; r >= top; r--) out.push(matrix[r][left]); left++; }
  }
  return out;
}

// Rotate an n×n matrix 90° clockwise in place: transpose, then reverse each row
function rotateImage(m) {
  const n = m.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) [m[i][j], m[j][i]] = [m[j][i], m[i][j]];
  m.forEach((row) => row.reverse());
  return m;
}

test('matrix', () => {
  expect(spiralOrder([[1, 2, 3], [4, 5, 6], [7, 8, 9]])).toEqual([1, 2, 3, 6, 9, 8, 7, 4, 5]);
  expect(spiralOrder([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]])).toEqual([1, 2, 3, 4, 8, 12, 11, 10, 9, 5, 6, 7]);
  expect(rotateImage([[1, 2, 3], [4, 5, 6], [7, 8, 9]])).toEqual([[7, 4, 1], [8, 5, 2], [9, 6, 3]]);
});
```

## Strings

### Longest Substring Without Repeating Characters 🔥

**Sliding window** with a map from each character to its **last index**. When the incoming character was seen **inside the current window**, jump `left` past its last occurrence. **O(n).**

```js
function lengthOfLongestSubstring(s) {
  const last = new Map();
  let left = 0, best = 0;
  for (let right = 0; right < s.length; right++) {
    const c = s[right];
    if (last.has(c) && last.get(c) >= left) left = last.get(c) + 1;   // only if it's inside the window
    last.set(c, right);
    best = Math.max(best, right - left + 1);
  }
  return best;
}

test('lengthOfLongestSubstring', () => {
  expect(lengthOfLongestSubstring('abcabcbb')).toBe(3);
  expect(lengthOfLongestSubstring('bbbbb')).toBe(1);
  expect(lengthOfLongestSubstring('pwwkew')).toBe(3);
  expect(lengthOfLongestSubstring('abba')).toBe(2);   // the "inside the window" check matters here
  expect(lengthOfLongestSubstring('')).toBe(0);
});
```

### Minimum Window Substring

**Variable sliding window:**

1. Expand `right` until the window **contains all the required characters** (track a `missing` count).
2. Then shrink `left` as far as possible while it stays valid, recording the smallest window.

**O(|s| + |t|).**

```js
function minWindow(s, t) {
  const need = new Map();
  for (const c of t) need.set(c, (need.get(c) ?? 0) + 1);
  let missing = t.length, left = 0, bestStart = 0, bestLen = Infinity;
  for (let right = 0; right < s.length; right++) {
    const c = s[right];
    if (need.has(c)) {
      if (need.get(c) > 0) missing--;
      need.set(c, need.get(c) - 1);
    }
    while (missing === 0) {                                // window is valid: try to shrink
      if (right - left + 1 < bestLen) { bestLen = right - left + 1; bestStart = left; }
      const lc = s[left++];
      if (need.has(lc)) {
        need.set(lc, need.get(lc) + 1);
        if (need.get(lc) > 0) missing++;
      }
    }
  }
  return bestLen === Infinity ? '' : s.slice(bestStart, bestStart + bestLen);
}

test('minWindow', () => {
  expect(minWindow('ADOBECODEBANC', 'ABC')).toBe('BANC');
  expect(minWindow('a', 'a')).toBe('a');
  expect(minWindow('a', 'aa')).toBe('');
});
```

### Longest Repeating Character Replacement (at most k changes)

**Window trick:** a window is valid if `windowLength − maxFrequencyInWindow ≤ k`. The max frequency never needs to decrease, because only a larger frequency can produce a longer answer. **O(n).**

```js
function characterReplacement(s, k) {
  const count = new Map();
  let left = 0, maxFreq = 0, best = 0;
  for (let right = 0; right < s.length; right++) {
    count.set(s[right], (count.get(s[right]) ?? 0) + 1);
    maxFreq = Math.max(maxFreq, count.get(s[right]));
    while (right - left + 1 - maxFreq > k) {
      count.set(s[left], count.get(s[left]) - 1);
      left++;
    }
    best = Math.max(best, right - left + 1);
  }
  return best;
}

test('characterReplacement', () => {
  expect(characterReplacement('ABAB', 2)).toBe(4);
  expect(characterReplacement('AABABBA', 1)).toBe(4);
});
```

### Valid Palindrome II (can delete at most one character)

```js
function validPalindrome(s) {
  const isPal = (l, r) => { while (l < r) if (s[l++] !== s[r--]) return false; return true; };
  let l = 0, r = s.length - 1;
  while (l < r) {
    if (s[l] !== s[r]) return isPal(l + 1, r) || isPal(l, r - 1);   // try skipping either side once
    l++; r--;
  }
  return true;
}

test('validPalindrome II', () => {
  expect(validPalindrome('aba')).toBe(true);
  expect(validPalindrome('abca')).toBe(true);
  expect(validPalindrome('abc')).toBe(false);
});
```

### Longest Palindromic Substring (expand around centre) 🔥

**Idea:** every palindrome has a **centre**: a character (odd length) or a gap between two characters (even length). Expand outward from each of the **2n − 1** centres. **O(n²) time, O(1) space.** That's simpler than DP. (Manacher's algorithm is O(n), but it's rarely expected.)

```js
function longestPalindrome(s) {
  if (s.length < 2) return s;
  let start = 0, maxLen = 1;
  const expand = (l, r) => {
    while (l >= 0 && r < s.length && s[l] === s[r]) { l--; r++; }
    if (r - l - 1 > maxLen) { maxLen = r - l - 1; start = l + 1; }
  };
  for (let i = 0; i < s.length; i++) {
    expand(i, i);       // odd length
    expand(i, i + 1);   // even length
  }
  return s.slice(start, start + maxLen);
}

test('longestPalindrome', () => {
  expect(['bab', 'aba']).toContain(longestPalindrome('babad'));
  expect(longestPalindrome('cbbd')).toBe('bb');
  expect(longestPalindrome('a')).toBe('a');
  expect(longestPalindrome('forgeeksskeegfor')).toBe('geeksskeeg');
});
```

### Longest Common Prefix, Reverse Words and String Compression 🔥

```js
function longestCommonPrefix(strs) {
  if (!strs.length) return '';
  let prefix = strs[0];
  for (const s of strs.slice(1)) {
    while (!s.startsWith(prefix)) prefix = prefix.slice(0, -1);   // shrink until it fits
    if (!prefix) break;
  }
  return prefix;
}

const reverseWords = (s) => s.trim().split(/\s+/).reverse().join(' ');

// Run-length encoding: "aaabccdddd" -> "a3bc2d4" (single chars without a count); return the original if not shorter
function compress(s) {
  let out = '';
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j < s.length && s[j] === s[i]) j++;
    out += s[i] + (j - i > 1 ? j - i : '');
    i = j;
  }
  return out.length < s.length ? out : s;
}

// Reverse a string correctly even with emoji (code points, not UTF-16 units)
const reverseString = (s) => [...s].reverse().join('');

test('string utilities', () => {
  expect(longestCommonPrefix(['flower', 'flow', 'flight'])).toBe('fl');
  expect(longestCommonPrefix(['dog', 'racecar', 'car'])).toBe('');
  expect(reverseWords('  the sky   is blue ')).toBe('blue is sky the');
  expect(compress('aaabccdddd')).toBe('a3bc2d4');
  expect(compress('abc')).toBe('abc');
  expect(reverseString('ab😀c')).toBe('c😀ba');
});
```

### String to Integer (atoi) and integer to Roman: parsing edge cases

These test **edge-case discipline**: whitespace, signs, overflow, invalid characters.

```js
function myAtoi(s) {
  const INT_MAX = 2 ** 31 - 1, INT_MIN = -(2 ** 31);
  let i = 0, sign = 1, n = 0;
  while (s[i] === ' ') i++;
  if (s[i] === '+' || s[i] === '-') sign = s[i++] === '-' ? -1 : 1;
  while (i < s.length && s[i] >= '0' && s[i] <= '9') {
    n = n * 10 + (s.charCodeAt(i++) - 48);
    if (n * sign > INT_MAX) return INT_MAX;    // clamp early on overflow
    if (n * sign < INT_MIN) return INT_MIN;
  }
  return n * sign || 0;                         // avoid -0
}

function intToRoman(num) {
  const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [value, sym] of table) while (num >= value) { out += sym; num -= value; }   // greedy
  return out;
}

test('parsing', () => {
  expect(myAtoi('   -42')).toBe(-42);
  expect(myAtoi('4193 with words')).toBe(4193);
  expect(myAtoi('words 987')).toBe(0);
  expect(myAtoi('-91283472332')).toBe(-2147483648);
  expect(myAtoi('+')).toBe(0);
  expect(intToRoman(1994)).toBe('MCMXCIV');
  expect(intToRoman(58)).toBe('LVIII');
});
```

### FizzBuzz, but extensible (a favourite warm-up)

Interviewers sometimes use FizzBuzz to check for **clean, extensible code**: rules as data, not nested `if`s.

```js
function fizzBuzz(n, rules = [[3, 'Fizz'], [5, 'Buzz']]) {
  return Array.from({ length: n }, (_, i) => {
    const k = i + 1;
    const word = rules.filter(([d]) => k % d === 0).map(([, w]) => w).join('');
    return word || String(k);
  });
}

test('fizzBuzz', () => {
  expect(fizzBuzz(15).slice(-5)).toEqual(['11', 'Fizz', '13', '14', 'FizzBuzz']);
  expect(fizzBuzz(7, [[7, 'Jitsi']])[6]).toBe('Jitsi');
});
```
