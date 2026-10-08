# Trees, Graphs & Recursion

Trees and graphs appear constantly in frontend work: the **DOM**, React's **component and fiber tree**, folder hierarchies (Nebraska Draw), dependency graphs (bundlers, task ordering), and **network topologies** (bridges cascading in Jitsi). Interviewers at product companies ask the classic easy/medium tree problems, BFS/DFS on grids, and topological sorting.

> The trees are written as LeetCode-style arrays (`[3,9,20,null,null,15,7]`). Each block defines its own `TreeNode` and `fromArray` helper so it runs anywhere (the playground also has `arrayToTree` / `treeToArray` globally).

## Binary trees

### Implement the tree traversals: pre-order, in-order, post-order and level order 🔥

- **DFS orders** (by when the node is visited relative to its children):
  - **pre-order:** node, left, right (copy or serialise a tree)
  - **in-order:** left, node, right (**sorted order for a BST**)
  - **post-order:** left, right, node (delete or free a tree, evaluate expressions, compute sizes bottom-up)
- **BFS / level order** uses a queue (level-by-level output, shortest paths in unweighted trees).
- **Recursion** is concise. Use **iterative versions with an explicit stack** to avoid stack overflow on very deep (skewed) trees.

```js
class TreeNode { constructor(val, left = null, right = null) { this.val = val; this.left = left; this.right = right; } }
function fromArray(arr) {
  if (!arr.length || arr[0] == null) return null;
  const root = new TreeNode(arr[0]); const q = [root]; let i = 1;
  for (let h = 0; h < q.length && i < arr.length; h++) {
    const n = q[h];
    if (arr[i] != null) q.push((n.left = new TreeNode(arr[i]))); i++;
    if (i < arr.length && arr[i] != null) q.push((n.right = new TreeNode(arr[i]))); i++;
  }
  return root;
}

const preorder = (n, out = []) => (n ? (out.push(n.val), preorder(n.left, out), preorder(n.right, out), out) : out);
const inorder = (n, out = []) => (n ? (inorder(n.left, out), out.push(n.val), inorder(n.right, out), out) : out);
const postorder = (n, out = []) => (n ? (postorder(n.left, out), postorder(n.right, out), out.push(n.val), out) : out);

function inorderIterative(root) {
  const out = [], stack = [];
  let cur = root;
  while (cur || stack.length) {
    while (cur) { stack.push(cur); cur = cur.left; }   // go as far left as possible
    cur = stack.pop();
    out.push(cur.val);
    cur = cur.right;
  }
  return out;
}

function levelOrder(root) {
  if (!root) return [];
  const levels = [];
  let queue = [root];
  while (queue.length) {
    levels.push(queue.map((n) => n.val));
    queue = queue.flatMap((n) => [n.left, n.right].filter(Boolean));   // next level
  }
  return levels;
}

const tree = fromArray([1, 2, 3, 4, 5, null, 6]);
test('traversals', () => {
  expect(preorder(tree)).toEqual([1, 2, 4, 5, 3, 6]);
  expect(inorder(tree)).toEqual([4, 2, 5, 1, 3, 6]);
  expect(postorder(tree)).toEqual([4, 5, 2, 6, 3, 1]);
  expect(inorderIterative(tree)).toEqual(inorder(tree));
  expect(levelOrder(tree)).toEqual([[1], [2, 3], [4, 5, 6]]);
});
```

### Maximum depth, invert tree, same tree, symmetric tree 🔥

These are recursion warm-ups. Define the answer for a node **in terms of its children's answers**.

```js
class TreeNode { constructor(val, left = null, right = null) { this.val = val; this.left = left; this.right = right; } }
function fromArray(arr) { if (!arr.length || arr[0] == null) return null; const root = new TreeNode(arr[0]); const q = [root]; let i = 1; for (let h = 0; h < q.length && i < arr.length; h++) { const n = q[h]; if (arr[i] != null) q.push((n.left = new TreeNode(arr[i]))); i++; if (i < arr.length && arr[i] != null) q.push((n.right = new TreeNode(arr[i]))); i++; } return root; }
const levelValues = (root) => { const out = []; const q = [root]; for (let h = 0; h < q.length; h++) { const n = q[h]; if (n) { out.push(n.val); q.push(n.left, n.right); } } return out; };

const maxDepth = (n) => (n ? 1 + Math.max(maxDepth(n.left), maxDepth(n.right)) : 0);

const minDepth = (n) => {
  if (!n) return 0;
  if (!n.left) return 1 + minDepth(n.right);       // a missing child isn't a leaf path
  if (!n.right) return 1 + minDepth(n.left);
  return 1 + Math.min(minDepth(n.left), minDepth(n.right));
};

function invertTree(n) {
  if (!n) return null;
  [n.left, n.right] = [invertTree(n.right), invertTree(n.left)];
  return n;
}

const isSameTree = (a, b) => (!a || !b ? a === b : a.val === b.val && isSameTree(a.left, b.left) && isSameTree(a.right, b.right));

const isSymmetric = (root) => {
  const mirror = (a, b) => (!a || !b ? a === b : a.val === b.val && mirror(a.left, b.right) && mirror(a.right, b.left));
  return mirror(root?.left ?? null, root?.right ?? null);
};

test('basic tree recursion', () => {
  expect(maxDepth(fromArray([3, 9, 20, null, null, 15, 7]))).toBe(3);
  expect(minDepth(fromArray([2, null, 3, null, 4]))).toBe(3);
  expect(levelValues(invertTree(fromArray([4, 2, 7, 1, 3, 6, 9])))).toEqual([4, 7, 2, 9, 6, 3, 1]);
  expect(isSameTree(fromArray([1, 2, 3]), fromArray([1, 2, 3]))).toBe(true);
  expect(isSameTree(fromArray([1, 2]), fromArray([1, null, 2]))).toBe(false);
  expect(isSymmetric(fromArray([1, 2, 2, 3, 4, 4, 3]))).toBe(true);
  expect(isSymmetric(fromArray([1, 2, 2, null, 3, null, 3]))).toBe(false);
});
```

### Diameter of a binary tree, and checking whether a tree is balanced 🔥

Both use **post-order recursion that returns a height** while **updating a global answer**, which is a very common pattern.

- **Diameter:** the longest path between any two nodes = max over nodes of `leftHeight + rightHeight`.
- **Balanced:** at every node, the subtree heights differ by at most 1. Return −1 as a "not balanced" sentinel to short-circuit the whole check in O(n).

```js
class TreeNode { constructor(val, left = null, right = null) { this.val = val; this.left = left; this.right = right; } }
function fromArray(arr) { if (!arr.length || arr[0] == null) return null; const root = new TreeNode(arr[0]); const q = [root]; let i = 1; for (let h = 0; h < q.length && i < arr.length; h++) { const n = q[h]; if (arr[i] != null) q.push((n.left = new TreeNode(arr[i]))); i++; if (i < arr.length && arr[i] != null) q.push((n.right = new TreeNode(arr[i]))); i++; } return root; }

function diameterOfBinaryTree(root) {
  let best = 0;
  const height = (n) => {
    if (!n) return 0;
    const l = height(n.left), r = height(n.right);
    best = Math.max(best, l + r);        // path through n (in edges)
    return 1 + Math.max(l, r);
  };
  height(root);
  return best;
}

function isBalanced(root) {
  const check = (n) => {
    if (!n) return 0;
    const l = check(n.left);
    if (l === -1) return -1;
    const r = check(n.right);
    if (r === -1 || Math.abs(l - r) > 1) return -1;
    return 1 + Math.max(l, r);
  };
  return check(root) !== -1;
}

// Path sum: does any root-to-leaf path add up to target?
const hasPathSum = (n, target) =>
  !!n && (!n.left && !n.right ? n.val === target : hasPathSum(n.left, target - n.val) || hasPathSum(n.right, target - n.val));

test('height-based recursion', () => {
  expect(diameterOfBinaryTree(fromArray([1, 2, 3, 4, 5]))).toBe(3);
  expect(isBalanced(fromArray([3, 9, 20, null, null, 15, 7]))).toBe(true);
  expect(isBalanced(fromArray([1, 2, 2, 3, 3, null, null, 4, 4]))).toBe(false);
  expect(hasPathSum(fromArray([5, 4, 8, 11, null, 13, 4, 7, 2, null, null, null, 1]), 22)).toBe(true);
  expect(hasPathSum(null, 0)).toBe(false);
});
```

### Validate a BST, find the kth smallest, and the lowest common ancestor 🔥

- **Validate BST:** pass down **(min, max) bounds**. A common mistake is only comparing a node with its direct children: every node in the left subtree must be smaller than the ancestor, not just the parent. An in-order traversal must also be strictly increasing.
- **Kth smallest in a BST:** in-order traversal, stopping at the kth node. **O(h + k).**
- **LCA in a BST:** walk from the root. If both values are smaller, go left; if both are larger, go right; otherwise the current node is the split point. **O(h).**
- **LCA in a general binary tree:** recurse. If the node is p or q, return it. If both sides return non-null, this node is the LCA. **O(n).**

```js
class TreeNode { constructor(val, left = null, right = null) { this.val = val; this.left = left; this.right = right; } }
function fromArray(arr) { if (!arr.length || arr[0] == null) return null; const root = new TreeNode(arr[0]); const q = [root]; let i = 1; for (let h = 0; h < q.length && i < arr.length; h++) { const n = q[h]; if (arr[i] != null) q.push((n.left = new TreeNode(arr[i]))); i++; if (i < arr.length && arr[i] != null) q.push((n.right = new TreeNode(arr[i]))); i++; } return root; }
const find = (n, v) => (!n ? null : n.val === v ? n : find(n.left, v) ?? find(n.right, v));

const isValidBST = (n, min = -Infinity, max = Infinity) =>
  !n || (n.val > min && n.val < max && isValidBST(n.left, min, n.val) && isValidBST(n.right, n.val, max));

function kthSmallest(root, k) {
  const stack = [];
  let cur = root;
  while (cur || stack.length) {
    while (cur) { stack.push(cur); cur = cur.left; }
    cur = stack.pop();
    if (--k === 0) return cur.val;
    cur = cur.right;
  }
  return null;
}

function lcaBST(root, p, q) {
  let n = root;
  while (n) {
    if (p < n.val && q < n.val) n = n.left;
    else if (p > n.val && q > n.val) n = n.right;
    else return n.val;
  }
  return null;
}

function lowestCommonAncestor(root, p, q) {
  if (!root || root === p || root === q) return root;
  const left = lowestCommonAncestor(root.left, p, q);
  const right = lowestCommonAncestor(root.right, p, q);
  return left && right ? root : left ?? right;
}

const bst = fromArray([6, 2, 8, 0, 4, 7, 9, null, null, 3, 5]);
const general = fromArray([3, 5, 1, 6, 2, 0, 8, null, null, 7, 4]);
test('BST & LCA', () => {
  expect(isValidBST(bst)).toBe(true);
  expect(isValidBST(fromArray([5, 1, 4, null, null, 3, 6]))).toBe(false);
  expect(isValidBST(fromArray([5, 4, 6, null, null, 3, 7]))).toBe(false);   // 3 is in the right subtree of 5
  expect(kthSmallest(bst, 3)).toBe(3);
  expect(lcaBST(bst, 2, 8)).toBe(6);
  expect(lcaBST(bst, 3, 5)).toBe(4);
  expect(lowestCommonAncestor(general, find(general, 5), find(general, 4)).val).toBe(5);
  expect(lowestCommonAncestor(general, find(general, 6), find(general, 0)).val).toBe(3);
});
```

### Right side view, zigzag level order, and maximum width (BFS variants)

```js
class TreeNode { constructor(val, left = null, right = null) { this.val = val; this.left = left; this.right = right; } }
function fromArray(arr) { if (!arr.length || arr[0] == null) return null; const root = new TreeNode(arr[0]); const q = [root]; let i = 1; for (let h = 0; h < q.length && i < arr.length; h++) { const n = q[h]; if (arr[i] != null) q.push((n.left = new TreeNode(arr[i]))); i++; if (i < arr.length && arr[i] != null) q.push((n.right = new TreeNode(arr[i]))); i++; } return root; }

function bfsLevels(root) {
  const levels = [];
  let level = root ? [root] : [];
  while (level.length) {
    levels.push(level);
    level = level.flatMap((n) => [n.left, n.right].filter(Boolean));
  }
  return levels;
}

const rightSideView = (root) => bfsLevels(root).map((lvl) => lvl.at(-1).val);
const zigzag = (root) => bfsLevels(root).map((lvl, i) => (i % 2 ? lvl.map((n) => n.val).reverse() : lvl.map((n) => n.val)));
const averageOfLevels = (root) => bfsLevels(root).map((lvl) => lvl.reduce((s, n) => s + n.val, 0) / lvl.length);

test('BFS variants', () => {
  expect(rightSideView(fromArray([1, 2, 3, null, 5, null, 4]))).toEqual([1, 3, 4]);
  expect(zigzag(fromArray([3, 9, 20, null, null, 15, 7]))).toEqual([[3], [20, 9], [15, 7]]);
  expect(averageOfLevels(fromArray([3, 9, 20, null, null, 15, 7]))).toEqual([3, 14.5, 11]);
});
```

### Serialise and deserialise a binary tree 🔥

Use **pre-order with null markers**. It's unambiguous, and deserialising consumes tokens in the same order. **O(n)** both ways. It's the same problem as saving and restoring tree-shaped UI state (a folder tree, a component tree) through JSON.

```js
class TreeNode { constructor(val, left = null, right = null) { this.val = val; this.left = left; this.right = right; } }

function serialize(root) {
  const out = [];
  const walk = (n) => { if (!n) { out.push('#'); return; } out.push(String(n.val)); walk(n.left); walk(n.right); };
  walk(root);
  return out.join(',');
}

function deserialize(data) {
  const tokens = data.split(',');
  let i = 0;
  const build = () => {
    const t = tokens[i++];
    if (t === '#') return null;
    const node = new TreeNode(Number(t));
    node.left = build();
    node.right = build();
    return node;
  };
  return build();
}

const root = new TreeNode(1, new TreeNode(2), new TreeNode(3, new TreeNode(4), new TreeNode(5)));
const s = serialize(root);
console.log(s);

test('round trip', () => {
  expect(s).toBe('1,2,#,#,3,4,#,#,5,#,#');
  expect(serialize(deserialize(s))).toBe(s);
  expect(deserialize(serialize(null))).toBeNull();
});
```

### Implement a Trie for prefix search and autocomplete 🔥

A **trie** (prefix tree) stores strings character by character.

- **insert, search and startsWith** run in **O(L)** for a word of length L, independent of how many words are stored.
- **Autocomplete:** walk to the prefix node, then DFS to collect completions. Store a rank or frequency to return the top results.
- Ties directly to the **typeahead** system-design question. An in-memory trie of participant names or commands gives instant client-side suggestions.

```js
class Trie {
  root = { children: new Map(), end: false, count: 0 };
  insert(word, weight = 1) {
    let node = this.root;
    for (const ch of word) {
      if (!node.children.has(ch)) node.children.set(ch, { children: new Map(), end: false, count: 0 });
      node = node.children.get(ch);
    }
    node.end = true;
    node.count += weight;
  }
  #walk(prefix) {
    let node = this.root;
    for (const ch of prefix) { node = node.children.get(ch); if (!node) return null; }
    return node;
  }
  search(word) { return this.#walk(word)?.end === true; }
  startsWith(prefix) { return this.#walk(prefix) !== null; }
  suggest(prefix, limit = 3) {
    const start = this.#walk(prefix);
    if (!start) return [];
    const results = [];
    const dfs = (node, path) => {
      if (node.end) results.push([path, node.count]);
      for (const [ch, child] of node.children) dfs(child, path + ch);
    };
    dfs(start, prefix);
    return results.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([w]) => w);
  }
}

const t = new Trie();
[['mute', 9], ['mute all', 5], ['music', 1], ['meeting', 7], ['record', 4], ['react', 2]].forEach(([w, n]) => t.insert(w, n));
console.log(t.suggest('mu'), t.suggest('r'), t.suggest('x'));

test('trie', () => {
  expect(t.search('mute')).toBe(true);
  expect(t.search('mut')).toBe(false);
  expect(t.startsWith('mut')).toBe(true);
  expect(t.suggest('mu')).toEqual(['mute', 'mute all', 'music']);
  expect(t.suggest('re', 1)).toEqual(['record']);
});
```

## Graphs

### How do you represent graphs, and how do BFS and DFS differ? 🔥

**Representations:**

- An **adjacency list** (`Map<node, neighbours[]>`) is the default. It uses O(V + E) space and is efficient for sparse graphs.
- An **adjacency matrix** uses O(V²) space and answers "is there an edge?" in O(1). Use it for dense graphs.
- An **edge list** suits algorithms such as Kruskal's and union-find.
- **Grids are implicit graphs:** each cell's neighbours are up, down, left and right.

**BFS vs DFS:**

| | BFS | DFS |
|---|---|---|
| Data structure | Queue | Stack (or recursion) |
| Explores | Level by level | As deep as possible first |
| Finds | **Shortest path in unweighted graphs** | Any path, connectivity, cycles, topological order |
| Memory | Can be large (a wide frontier) | O(depth) |

Both run in **O(V + E)**. **Always track visited nodes** in graphs (not needed in trees), or cycles cause infinite loops.

```js
function buildGraph(edges, directed = false) {
  const g = new Map();
  const add = (a, b) => { if (!g.has(a)) g.set(a, []); g.get(a).push(b); };
  for (const [a, b] of edges) { add(a, b); if (!directed) add(b, a); else if (!g.has(b)) g.set(b, []); }
  return g;
}

function bfsShortestPath(graph, start, goal) {
  const prev = new Map([[start, null]]);
  const queue = [start];
  for (let h = 0; h < queue.length; h++) {
    const node = queue[h];
    if (node === goal) break;
    for (const next of graph.get(node) ?? []) {
      if (!prev.has(next)) { prev.set(next, node); queue.push(next); }
    }
  }
  if (!prev.has(goal)) return null;
  const path = [];
  for (let n = goal; n !== null; n = prev.get(n)) path.push(n);
  return path.reverse();
}

function dfsReachable(graph, start) {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const node = stack.pop();
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of graph.get(node) ?? []) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

// Bridges cascaded across regions (undirected)
const net = buildGraph([['mumbai', 'singapore'], ['singapore', 'frankfurt'], ['frankfurt', 'virginia'], ['mumbai', 'frankfurt'], ['tokyo', 'sydney']]);
test('BFS & DFS', () => {
  expect(bfsShortestPath(net, 'mumbai', 'virginia')).toEqual(['mumbai', 'frankfurt', 'virginia']);
  expect(bfsShortestPath(net, 'mumbai', 'tokyo')).toBeNull();
  expect([...dfsReachable(net, 'tokyo')].sort()).toEqual(['sydney', 'tokyo']);
});
```

### Number of Islands (and flood fill) 🔥

Scan the grid. Whenever you find unvisited land, **count an island** and **flood-fill** (DFS or BFS) to mark all connected land. **O(rows × cols).** Flood fill is the same idea: the bucket tool in drawing apps (relevant to whiteboards).

```js
function numIslands(grid) {
  const g = grid.map((row) => [...row]);          // don't mutate the input
  const R = g.length, C = g[0]?.length ?? 0;
  let islands = 0;
  const sink = (r, c) => {
    const stack = [[r, c]];
    while (stack.length) {
      const [y, x] = stack.pop();
      if (y < 0 || y >= R || x < 0 || x >= C || g[y][x] !== '1') continue;
      g[y][x] = '0';                              // mark visited
      stack.push([y + 1, x], [y - 1, x], [y, x + 1], [y, x - 1]);
    }
  };
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (g[r][c] === '1') { islands++; sink(r, c); }
  return islands;
}

function floodFill(image, sr, sc, color) {
  const original = image[sr][sc];
  if (original === color) return image;
  const fill = (r, c) => {
    if (r < 0 || r >= image.length || c < 0 || c >= image[0].length || image[r][c] !== original) return;
    image[r][c] = color;
    fill(r + 1, c); fill(r - 1, c); fill(r, c + 1); fill(r, c - 1);
  };
  fill(sr, sc);
  return image;
}

test('islands & flood fill', () => {
  expect(numIslands(['11000', '11000', '00100', '00011'])).toBe(3);
  expect(numIslands(['111', '010', '111'])).toBe(1);
  expect(floodFill([[1, 1, 1], [1, 1, 0], [1, 0, 1]], 1, 1, 2)).toEqual([[2, 2, 2], [2, 2, 0], [2, 0, 1]]);
});
```

### Rotting Oranges / shortest time to spread (multi-source BFS)

Start BFS from **all sources at once** (every rotten orange). Each BFS level is one minute. If fresh oranges remain at the end, return −1. **O(R × C).** The same pattern answers "distance to the nearest exit or server" and "how long until a message reaches every node".

```js
function orangesRotting(grid) {
  const g = grid.map((r) => [...r]);
  let fresh = 0;
  let queue = [];
  g.forEach((row, r) => row.forEach((v, c) => { if (v === 2) queue.push([r, c]); else if (v === 1) fresh++; }));
  let minutes = 0;
  while (queue.length && fresh) {
    const next = [];
    for (const [r, c] of queue) {
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc;
        if (g[nr]?.[nc] === 1) { g[nr][nc] = 2; fresh--; next.push([nr, nc]); }
      }
    }
    queue = next;
    minutes++;
  }
  return fresh ? -1 : minutes;
}

test('multi-source BFS', () => {
  expect(orangesRotting([[2, 1, 1], [1, 1, 0], [0, 1, 1]])).toBe(4);
  expect(orangesRotting([[2, 1, 1], [0, 1, 1], [1, 0, 1]])).toBe(-1);
  expect(orangesRotting([[0, 2]])).toBe(0);
});
```

### Course Schedule: cycle detection and topological sort (Kahn's algorithm) 🔥

**Topological sort** orders the nodes of a **DAG** so every edge goes from earlier to later: prerequisites before courses, **build steps in dependency order** (bundlers, monorepo task runners like Turborepo and Nx), **module initialisation order**, spreadsheet recalculation.

**Kahn's algorithm:**

1. Compute **in-degrees**.
2. Queue the nodes with in-degree 0.
3. Pop a node, append it to the order, and decrement its neighbours' in-degrees, queueing any that reach 0.

If the output includes **fewer than V nodes**, there's a **cycle**. **O(V + E).**

```js
function topoSort(numNodes, edges) {           // edges: [from, to]  (from must come before to)
  const adj = Array.from({ length: numNodes }, () => []);
  const indeg = new Array(numNodes).fill(0);
  for (const [a, b] of edges) { adj[a].push(b); indeg[b]++; }
  const queue = [];
  indeg.forEach((d, i) => d === 0 && queue.push(i));
  const order = [];
  for (let h = 0; h < queue.length; h++) {
    const n = queue[h];
    order.push(n);
    for (const m of adj[n]) if (--indeg[m] === 0) queue.push(m);
  }
  return order.length === numNodes ? order : null;   // null => cycle
}

// Course Schedule: prerequisites [course, prereq] means prereq -> course
const canFinish = (n, prerequisites) => topoSort(n, prerequisites.map(([c, p]) => [p, c])) !== null;

// Named example: build order for packages in a monorepo
function buildOrder(deps) {                     // { pkg: [dependencies] }
  const names = Object.keys(deps);
  const id = new Map(names.map((n, i) => [n, i]));
  const edges = names.flatMap((n) => deps[n].map((d) => [id.get(d), id.get(n)]));
  const order = topoSort(names.length, edges);
  return order && order.map((i) => names[i]);
}

test('topological sort', () => {
  expect(canFinish(2, [[1, 0]])).toBe(true);
  expect(canFinish(2, [[1, 0], [0, 1]])).toBe(false);
  const order = buildOrder({ web: ['ui', 'api-client'], ui: ['tokens'], 'api-client': ['types'], tokens: [], types: [] });
  expect(order.indexOf('tokens')).toBeLessThan(order.indexOf('ui'));
  expect(order.indexOf('ui')).toBeLessThan(order.indexOf('web'));
  expect(order.at(-1)).toBe('web');
  expect(buildOrder({ a: ['b'], b: ['a'] })).toBeNull();
});
```

### Union-Find (Disjoint Set Union): connected components and redundant connections

**Union-Find** maintains groups under merges:

- `find(x)` returns the group representative
- `union(a, b)` merges two groups
- with **path compression** and **union by rank/size**, both are nearly **O(1)** amortised (inverse Ackermann)

**Uses:**

- counting connected components (an alternative to DFS)
- detecting a cycle in an undirected graph (union fails because the nodes are already connected)
- Kruskal's minimum spanning tree
- dynamic connectivity, such as grouping duplicate records

```js
class DSU {
  constructor(n) { this.parent = Array.from({ length: n }, (_, i) => i); this.size = new Array(n).fill(1); this.components = n; }
  find(x) { while (this.parent[x] !== x) { this.parent[x] = this.parent[this.parent[x]]; x = this.parent[x]; } return x; }  // path halving
  union(a, b) {
    let ra = this.find(a), rb = this.find(b);
    if (ra === rb) return false;                      // already connected -> this edge would form a cycle
    if (this.size[ra] < this.size[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    this.size[ra] += this.size[rb];
    this.components--;
    return true;
  }
}

function countComponents(n, edges) {
  const dsu = new DSU(n);
  edges.forEach(([a, b]) => dsu.union(a, b));
  return dsu.components;
}

function findRedundantConnection(edges) {
  const dsu = new DSU(edges.length + 1);
  for (const [a, b] of edges) if (!dsu.union(a, b)) return [a, b];
  return null;
}

test('union-find', () => {
  expect(countComponents(5, [[0, 1], [1, 2], [3, 4]])).toBe(2);
  expect(findRedundantConnection([[1, 2], [1, 3], [2, 3]])).toEqual([2, 3]);
  expect(findRedundantConnection([[1, 2], [2, 3], [3, 4], [1, 4], [1, 5]])).toEqual([1, 4]);
});
```

### Dijkstra's shortest path (weighted graphs)

For **non-negative** edge weights: use a **min-heap of (distance, node)**. Pop the closest unfinished node and relax its edges. **O((V + E) log V).** Negative weights need Bellman–Ford. Example: the **lowest-latency route** between media servers.

```js
function dijkstra(graph, source) {             // graph: { node: [[neighbour, weight], ...] }
  const dist = Object.fromEntries(Object.keys(graph).map((n) => [n, Infinity]));
  dist[source] = 0;
  const heap = [[0, source]];                   // simple binary heap of [distance, node]
  const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };

  while (heap.length) {
    const [d, node] = pop();
    if (d > dist[node]) continue;               // stale entry
    for (const [next, w] of graph[node]) {
      if (d + w < dist[next]) { dist[next] = d + w; push([dist[next], next]); }
    }
  }
  return dist;
}

const latencyMs = {
  hyd: [['mum', 18], ['sin', 60]],
  mum: [['hyd', 18], ['sin', 55], ['fra', 120]],
  sin: [['hyd', 60], ['mum', 55], ['fra', 150]],
  fra: [['mum', 120], ['sin', 150], ['iad', 85]],
  iad: [['fra', 85]],
};
test('dijkstra', () => {
  expect(dijkstra(latencyMs, 'hyd')).toEqual({ hyd: 0, mum: 18, sin: 60, fra: 138, iad: 223 });
});
```

## Backtracking

### Generate subsets, permutations and combinations (backtracking template) 🔥

**Backtracking** builds candidates incrementally and **undoes each choice** (backtracks) after exploring it. Template: `choose → explore → un-choose`.

- **Subsets:** O(2ⁿ · n).
- **Permutations:** O(n! · n).
- **Prune** branches early, e.g. stop when the running sum exceeds the target in combination sum.

```js
function subsets(nums) {
  const out = [], path = [];
  const dfs = (start) => {
    out.push([...path]);
    for (let i = start; i < nums.length; i++) {
      path.push(nums[i]);       // choose
      dfs(i + 1);               // explore
      path.pop();               // un-choose
    }
  };
  dfs(0);
  return out;
}

function permutations(nums) {
  const out = [], path = [], used = new Array(nums.length).fill(false);
  const dfs = () => {
    if (path.length === nums.length) { out.push([...path]); return; }
    for (let i = 0; i < nums.length; i++) {
      if (used[i]) continue;
      used[i] = true; path.push(nums[i]);
      dfs();
      used[i] = false; path.pop();
    }
  };
  dfs();
  return out;
}

// Combination sum: candidates may be reused; return unique combinations summing to target
function combinationSum(candidates, target) {
  const sorted = [...candidates].sort((a, b) => a - b), out = [], path = [];
  const dfs = (start, remaining) => {
    if (remaining === 0) { out.push([...path]); return; }
    for (let i = start; i < sorted.length && sorted[i] <= remaining; i++) {   // pruning thanks to sorting
      path.push(sorted[i]);
      dfs(i, remaining - sorted[i]);                                         // i (not i+1): reuse allowed
      path.pop();
    }
  };
  dfs(0, target);
  return out;
}

// Generate all valid parentheses strings with n pairs
function generateParenthesis(n) {
  const out = [];
  const dfs = (s, open, close) => {
    if (s.length === 2 * n) { out.push(s); return; }
    if (open < n) dfs(s + '(', open + 1, close);
    if (close < open) dfs(s + ')', open, close + 1);
  };
  dfs('', 0, 0);
  return out;
}

test('backtracking', () => {
  expect(subsets([1, 2, 3])).toHaveLength(8);
  expect(subsets([1, 2])).toEqual([[], [1], [1, 2], [2]]);
  expect(permutations([1, 2, 3])).toHaveLength(6);
  expect(permutations([1, 2])).toEqual([[1, 2], [2, 1]]);
  expect(combinationSum([2, 3, 6, 7], 7)).toEqual([[2, 2, 3], [7]]);
  expect(generateParenthesis(3)).toEqual(['((()))', '(()())', '(())()', '()(())', '()()()']);
});
```

### Word Search in a grid (DFS with backtracking)

```js
function exist(board, word) {
  const R = board.length, C = board[0].length;
  const dfs = (r, c, i) => {
    if (i === word.length) return true;
    if (r < 0 || r >= R || c < 0 || c >= C || board[r][c] !== word[i]) return false;
    const saved = board[r][c];
    board[r][c] = '#';                                   // mark as used on this path
    const found = dfs(r + 1, c, i + 1) || dfs(r - 1, c, i + 1) || dfs(r, c + 1, i + 1) || dfs(r, c - 1, i + 1);
    board[r][c] = saved;                                 // backtrack
    return found;
  };
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (dfs(r, c, 0)) return true;
  return false;
}

const board = () => [['A', 'B', 'C', 'E'], ['S', 'F', 'C', 'S'], ['A', 'D', 'E', 'E']];
test('word search', () => {
  expect(exist(board(), 'ABCCED')).toBe(true);
  expect(exist(board(), 'SEE')).toBe(true);
  expect(exist(board(), 'ABCB')).toBe(false);      // can't reuse a cell
});
```

### How do these tree and graph ideas show up in frontend work?

- **The DOM is a tree:**
  - `querySelectorAll` and `TreeWalker` are traversals
  - event propagation walks the ancestor path
  - "find the LCA of two elements" is how libraries compute common containers (e.g. `Range.commonAncestorContainer`)
- **React:**
  - reconciliation compares two trees with heuristics, O(n)
  - Fiber walks the tree iteratively through `child`/`sibling`/`return` pointers (DFS without recursion)
  - context lookup walks ancestors
- **Bundlers and module graphs:** dependency graphs, cycle detection (circular imports), topological ordering, tree shaking (reachability from entry points: graph DFS).
- **State and UI:** nested comments and folder trees (recursive components, flattening to ID maps), breadcrumbs (a path to the root), undo history (a tree of states).
- **Conferencing:** bridge cascading as a graph, region routing (shortest path), BFS for "who hears whom" in breakout rooms.

```js
// Flatten a nested folder tree into an id map (normalisation) and build a breadcrumb path
const tree = { id: 'root', name: 'Documents', children: [
  { id: 'f1', name: 'Contracts', children: [{ id: 'f3', name: '2025', children: [] }] },
  { id: 'f2', name: 'Invoices', children: [] },
] };

function flatten(node, parentId = null, out = {}) {
  out[node.id] = { id: node.id, name: node.name, parentId, childIds: node.children.map((c) => c.id) };
  node.children.forEach((c) => flatten(c, node.id, out));
  return out;
}

const byId = flatten(tree);
const breadcrumb = (id) => { const path = []; for (let n = byId[id]; n; n = byId[n.parentId]) path.unshift(n.name); return path.join(' / '); };
console.log(breadcrumb('f3'));

test('tree utilities', () => {
  expect(Object.keys(byId)).toHaveLength(4);
  expect(breadcrumb('f3')).toBe('Documents / Contracts / 2025');
});
```
