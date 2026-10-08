# WebSockets & Real-time Systems

Real-time features run through your resume: XMPP over WebSocket in MeetHour, live recording status, Excalidraw collaboration, processing-status updates in SCAI. This page covers **the WebSocket protocol, choosing between WebSocket, SSE and polling, reconnection, scaling, delivery guarantees, presence and collaborative editing (OT vs CRDT)**.

## Protocol & alternatives

### How does the WebSocket protocol work? 🔥

1. **Opening handshake:** an **HTTP/1.1 `GET`** with:
   - `Upgrade: websocket`, `Connection: Upgrade`
   - `Sec-WebSocket-Key` (random base64), `Sec-WebSocket-Version: 13`
   - optionally `Sec-WebSocket-Protocol` (subprotocols such as `xmpp`) and `Sec-WebSocket-Extensions` (`permessage-deflate`)
   
   The server replies **`101 Switching Protocols`** with `Sec-WebSocket-Accept = base64(SHA-1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))`, which proves it understood the WebSocket handshake.
2. After that, the TCP (TLS for `wss://`) connection carries **frames**, full-duplex:
   - a FIN bit
   - an **opcode**: `0x1` text (UTF-8), `0x2` binary, `0x0` continuation, `0x8` **close**, `0x9` **ping**, `0xA` **pong**
   - the payload length
   - **client-to-server frames must be masked** (a 4-byte XOR key, protection against cache poisoning by intermediaries)
3. **Closing handshake:** a close frame with a **code and reason**:
   - `1000` normal, `1001` going away
   - `1006` abnormal (never sent on the wire; it means the connection dropped without a close frame)
   - `1008` policy violation, `1011` server error, `1012` service restart, `1013` try again later
   - `4000–4999` application-defined
4. **Heartbeats:** the server sends **pings** and the browser answers with **pongs automatically**. Browser JavaScript **can't send protocol-level pings**, so apps also send **application-level pings** to detect dead connections from the client side.

```js
// Compute Sec-WebSocket-Accept exactly like a server does (RFC 6455 example values)
async function acceptKey(secWebSocketKey) {
  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(secWebSocketKey + GUID));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

const accept = await acceptKey('dGhlIHNhbXBsZSBub25jZQ==');
console.log('Sec-WebSocket-Accept:', accept);

test('matches the example in RFC 6455', () => {
  expect(accept).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});
```

### WebSocket vs SSE vs long polling vs short polling vs WebTransport: when do you use which? 🔥

| | Direction | Transport | Pros | Cons | Use for |
|---|---|---|---|---|---|
| **Short polling** | Client pulls on an interval | HTTP | Simple, cache-friendly, works everywhere | Wasted requests; latency = the interval | Job status every 5–10 s, low-frequency dashboards |
| **Long polling** | Server holds the request until data arrives (or a timeout), then the client re-requests | HTTP | Near real-time, works through any proxy | Request overhead per message; ordering and duplicate handling | Fallback transport (BOSH, Socket.IO's fallback) |
| **SSE** (`EventSource`) | **Server → client** only | HTTP (`text/event-stream`) | Simple, **auto-reconnect with `Last-Event-ID`**, works with HTTP/2 multiplexing, text-based | One-way; no binary; the 6-connection limit per domain on HTTP/1.1 | Notifications, live feeds, **LLM token streaming**, progress updates |
| **WebSocket** | **Bidirectional** | TCP upgrade | Low latency, low overhead per message, binary | Stateful connections (harder to scale and load-balance), no built-in reconnect or resume, proxy issues in some corporate networks | Chat, signalling (XMPP), collaboration, multiplayer, live presence |
| **WebTransport** | Bidirectional, **multiple streams + unreliable datagrams** | HTTP/3 (QUIC) | No head-of-line blocking, datagrams for real-time data | Newer; server support still maturing | Low-latency games and media (Media over QUIC) |
| **WebRTC DataChannel** | Peer-to-peer (or via an SFU) | SCTP/DTLS/UDP | P2P, configurable reliability | Complex setup (ICE) | P2P file transfer, game state between peers |

**Decision rule:**

- Only the server pushes → **SSE**.
- Both sides talk frequently with low latency → **WebSocket**.
- Updates are rare or tolerant of delay → **polling** (the simplest thing that works).

```node
// SSE endpoint (Node/Express) — great for streaming job progress or LLM tokens
app.get('/api/jobs/:id/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  let lastId = Number(req.headers['last-event-id'] ?? 0);          // resume after reconnect
  const timer = setInterval(() => {
    lastId++;
    res.write(`id: ${lastId}\nevent: progress\ndata: ${JSON.stringify({ pct: Math.min(100, lastId * 10) })}\n\n`);
  }, 1000);
  req.on('close', () => clearInterval(timer));
});

// Browser
const es = new EventSource('/api/jobs/42/events');                  // reconnects automatically
es.addEventListener('progress', (e) => setProgress(JSON.parse(e.data).pct));
```

## Reliability

### How do you build a robust WebSocket client: reconnects, heartbeats and queued messages? 🔥

**Requirements:**

1. **Reconnect with exponential backoff and jitter.** Don't hammer the server when it's down, and avoid a **thundering herd** when thousands of clients reconnect after a deploy. Reset the backoff after a stable connection.
2. **Detect dead connections.** TCP can stay "open" for minutes after the network silently drops (Wi-Fi switch, laptop sleep). Use **application heartbeats**: if no pong or message arrives within N seconds, close and reconnect. Also listen to `online`/`offline` and `visibilitychange`.
3. **Queue outgoing messages** while disconnected, with a bounded size, and flush them after reconnecting. Make messages **idempotent** (client-generated message IDs) so retries don't duplicate.
4. **Resume state after reconnecting:** re-authenticate, **re-subscribe** to channels, and fetch missed events (send the **last received sequence number**, or refetch a snapshot).
5. **Close codes:** don't reconnect on **auth failures** (e.g. 4001 "token expired"). Refresh the token first. Don't reconnect on deliberate closes.

```js
// A reconnecting client with backoff, heartbeat and an outbox (runs against a fake socket)
function createRealtimeClient(createSocket, { baseDelay = 50, maxDelay = 2000, heartbeatMs = 100, onStatus = () => {} } = {}) {
  let socket = null;
  let attempts = 0;
  let closedByUser = false;
  let heartbeatTimer = null;
  let lastSeen = 0;
  const outbox = [];
  const handlers = new Set();

  const connect = () => {
    onStatus(attempts === 0 ? 'connecting' : `reconnecting #${attempts}`);
    socket = createSocket();
    socket.onopen = () => {
      attempts = 0;
      lastSeen = Date.now();
      onStatus('open');
      while (outbox.length && socket.readyState === 1) socket.send(outbox.shift()); // flush queued messages
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (Date.now() - lastSeen > heartbeatMs * 3) socket.close(4000, 'heartbeat timeout'); // dead connection
        else socket.send(JSON.stringify({ type: 'ping' }));
      }, heartbeatMs);
    };
    socket.onmessage = (e) => {
      lastSeen = Date.now();
      const msg = JSON.parse(e.data);
      if (msg.type !== 'pong') handlers.forEach((h) => h(msg));
    };
    socket.onclose = (e) => {
      clearInterval(heartbeatTimer);
      if (closedByUser || e.code === 4001) return onStatus(`closed (${e.code})`);   // don't retry auth failures
      const delay = Math.min(maxDelay, baseDelay * 2 ** attempts++) * (0.5 + Math.random() / 2); // backoff + jitter
      setTimeout(connect, delay);
    };
  };
  connect();
  return {
    send(msg) {
      const data = JSON.stringify(msg);
      if (socket?.readyState === 1) socket.send(data);
      else if (outbox.length < 100) outbox.push(data);                    // bounded queue
    },
    subscribe: (h) => (handlers.add(h), () => handlers.delete(h)),
    close() { closedByUser = true; clearInterval(heartbeatTimer); socket?.close(1000, 'bye'); },
  };
}

// Fake server: the first connection fails, the second works and echoes messages
let connections = 0;
const serverReceived = [];
function createFakeSocket() {
  const n = ++connections;
  const s = { readyState: 0, send(d) { const m = JSON.parse(d); if (m.type === 'ping') setTimeout(() => s.onmessage?.({ data: '{"type":"pong"}' }), 1); else { serverReceived.push(m); setTimeout(() => s.onmessage?.({ data: JSON.stringify({ type: 'ack', id: m.id }) }), 1); } },
    close(code = 1000) { s.readyState = 3; setTimeout(() => s.onclose?.({ code }), 0); } };
  setTimeout(() => {
    if (n === 1) { s.readyState = 3; s.onclose?.({ code: 1006 }); }     // network failure
    else { s.readyState = 1; s.onopen?.(); }
  }, 10);
  return s;
}

const statuses = [];
const acks = [];
const client = createRealtimeClient(createFakeSocket, { onStatus: (s) => statuses.push(s) });
client.subscribe((m) => acks.push(m.id));
client.send({ type: 'chat', id: 'm1', text: 'queued while connecting' });

test('reconnects, flushes the outbox and keeps the connection alive', async () => {
  await new Promise((r) => setTimeout(r, 400));
  client.close();
  expect(connections).toBe(2);
  expect(serverReceived.map((m) => m.id)).toEqual(['m1']);
  expect(acks).toEqual(['m1']);
  expect(statuses.slice(0, 3)).toEqual(['connecting', 'reconnecting #1', 'open']);
});
```

### What delivery and ordering guarantees does a WebSocket give you? How do you get exactly-once behaviour? 🔥

- **Within one connection:** TCP gives **ordered, reliable delivery**. Messages arrive in order or the connection breaks.
- **Across reconnects: no guarantees.** Messages in flight when the connection dropped may or may not have been processed. That's **at-most-once** unless you add retries, and with retries it becomes **at-least-once**.
- **Getting "effectively exactly-once":**
  1. **Client-generated IDs** on every message, and **acks** from the server.
  2. **Retry** unacked messages after reconnecting (at-least-once delivery).
  3. **Idempotent processing / deduplication** on the server, keyed by message ID (store recently seen IDs).
  4. **Server-to-client:** **sequence numbers per channel**. The client tracks the last sequence it saw and, after reconnecting, asks for everything after it (from a log or stream such as Redis Streams or Kafka). Gaps trigger a resync with a full snapshot.
- **Ordering across multiple servers or partitions:** use a single ordering authority per room (one shard or leader per room), or logical clocks (Lamport, vector clocks) or **CRDTs** when concurrent edits are expected.

### How do you authenticate and secure WebSocket connections? 🔥

- **The browser WebSocket API can't set custom headers.** Options:
  1. **Cookies** (an HTTP-only session cookie is sent automatically on the handshake). You then **must check the `Origin` header** to prevent **Cross-Site WebSocket Hijacking (CSWSH)**, because cookies are sent even when another site opens the socket.
  2. **A short-lived token in the URL query** (`wss://…/ws?token=…`). Simple, but URLs end up in logs and proxies, so use one-time or very short-lived tickets obtained from an authenticated HTTP endpoint.
  3. **Authenticate in the first message** after connecting (`{ type: 'auth', token }`). Don't process anything else until authenticated, and close with a 4001-style code on failure.
- **Always use `wss://`** (TLS).
- **Authorise every action**, not just the connection: can this user publish to this room?
- **Validate and limit messages:** schema-validate JSON, enforce a **max frame size**, **rate-limit** messages per connection, and protect against slowloris-style idle connections (timeouts).
- **Token expiry on long-lived connections:** re-authenticate periodically, or close with a specific code so the client refreshes and reconnects.

## Scaling

### How do you scale WebSocket servers horizontally? 🔥

WebSocket connections are **long-lived and stateful**, which changes the scaling story compared with stateless HTTP:

1. **Load balancing:** an L4 or L7 load balancer that supports **Upgrade** and long idle timeouts (Nginx `proxy_read_timeout`, ALB idle timeout).
   - **Sticky sessions** are needed when the protocol has multi-request phases. **Socket.IO's polling fallback** requires them; pure WebSocket doesn't need stickiness after the upgrade.
2. **Cross-node messaging:** a user on server A sends to a room whose members are spread across A, B and C. Use a **pub/sub backbone**: **Redis Pub/Sub** (or Redis Streams), NATS, Kafka, RabbitMQ, or the Socket.IO **Redis adapter**. Each node subscribes to the channels its connected clients care about and fans out locally.
3. **Connection state** (presence, rooms) lives in a **shared store** (Redis with TTLs), or is partitioned by room, with **consistent hashing** routing a room to one node, as Jitsi does with shards.
4. **Capacity per node:** memory per connection, file descriptors (`ulimit -n`), CPU for TLS and JSON. Tune the kernel (`somaxconn`, ephemeral ports). Usually tens to hundreds of thousands of idle connections per node, fewer when active.
5. **Deploys:** drain connections gracefully (send a "reconnect" message or close code 1012, with jittered client backoff) to avoid reconnect storms.
6. **Managed options:** **AWS API Gateway WebSocket APIs** (connection IDs stored in DynamoDB; Lambdas post messages through the management API), AppSync subscriptions, Pusher, Ably, Azure Web PubSub. You trade control for no-ops scaling.

```text
            ┌──────────── Load balancer (Upgrade, long idle timeout) ────────────┐
            ▼                              ▼                                     ▼
      WS node A (rooms 1,2)          WS node B (rooms 2,3)                WS node C (room 1)
            │  publish room:2              ▲ subscribed to room:2               ▲ subscribed to room:1
            └──────────────►  Redis Pub/Sub / Streams  ◄────────────────────────┘
```

### Socket.IO vs raw WebSockets: what's the difference?

**Socket.IO** is a **library and protocol on top of** WebSocket (via Engine.IO). It's **not** a plain WebSocket server, so a raw `WebSocket` client can't talk to it.

**Socket.IO adds:**

- **automatic reconnection** with backoff
- **HTTP long-polling fallback** (and an upgrade to WebSocket)
- **rooms and namespaces**
- **acknowledgements** (callbacks)
- broadcasting helpers, binary support, middleware for auth
- **adapters** (Redis, Postgres) for multi-node setups
- connection state recovery

**Trade-offs:** extra protocol overhead, a client library is required, and polling needs sticky sessions. **Raw `ws`** (Node) or uWebSockets.js gives lower overhead and full control, but you build reconnection, rooms and acks yourself. **Excalidraw's collaboration server (excalidraw-room) uses Socket.IO.**

## Presence & collaboration

### How do you implement presence ("who's online") and typing indicators? 🔥

- **Presence:**
  - mark the user online on connect, with a **heartbeat-refreshed TTL**, e.g. Redis `SET presence:user:42 <nodeId> EX 30` refreshed every 10 s
  - a missed heartbeat means the key expires, so the user is offline (this handles crashes without a clean disconnect)
  - publish **presence change events** to interested rooms
  - multiple tabs or devices: count connections per user (use a set of connection IDs) and go offline only when all are gone
- **Typing indicators:**
  - send `typing:start` **throttled** (at most every 3 s while typing) and `typing:stop` on blur, send or idle
  - receivers auto-expire the indicator after about 5 s with no updates, so it doesn't get stuck
  - ephemeral and never persisted
- **XMPP equivalent:** MUC presence (with `<show>`/status) and **chat state notifications** (XEP-0085: composing/paused).

### OT vs CRDT: how do collaborative editors handle concurrent edits? 🔥

**The problem:** two users edit the same document at the same time. Each applies their own edit locally first (for responsiveness), so the replicas must **converge** to the same state.

| | **Operational Transformation (OT)** | **CRDT (Conflict-free Replicated Data Types)** |
|---|---|---|
| Idea | Transform concurrent operations against each other (e.g. shift an insert's index by a concurrent insert before it) | Data structures designed so **concurrent operations commute**: merge in any order and get the same result |
| Coordination | Usually a **central server** that orders operations | **Decentralised**: works peer-to-peer and offline |
| Complexity | Transformation functions are notoriously hard to get right | Metadata overhead (tombstones, unique IDs); modern implementations are efficient |
| Used by | **Google Docs**, **Etherpad** (Easysync changesets), CKEditor 5 real-time collaboration, ShareDB | **Yjs**, **Automerge**, Figma (CRDT-inspired, server-authoritative), Apple Notes, Linear |

**Excalidraw** uses a simpler **per-element reconciliation**, since a drawing is a set of independent elements rather than linear text:

- each element has a `version` (incremented on every change) and a random `versionNonce`
- on receiving remote elements, **keep the one with the higher version**
- break ties with `versionNonce`, so all clients choose the same winner deterministically
- deletions are **soft** (`isDeleted: true`) so they also reconcile

This is essentially a **last-writer-wins register per element**, which is a simple CRDT. Here's that logic, runnable:

```js
// Excalidraw-style reconciliation: per-element last-writer-wins by version, tie-break by nonce
function reconcile(localElements, remoteElements, editingElementId = null) {
  const byId = new Map(localElements.map((e) => [e.id, e]));
  for (const remote of remoteElements) {
    const local = byId.get(remote.id);
    if (!local) { byId.set(remote.id, remote); continue; }
    if (local.id === editingElementId) continue;                         // don't clobber what I'm drawing right now
    const remoteWins = remote.version > local.version || (remote.version === local.version && remote.versionNonce < local.versionNonce);
    if (remoteWins) byId.set(remote.id, remote);
  }
  return [...byId.values()].filter((e) => !e.isDeleted);
}

const base = { id: 'rect1', type: 'rectangle', x: 0, version: 1, versionNonce: 500, isDeleted: false };
const alice = [{ ...base, x: 10, version: 2, versionNonce: 111 }];             // Alice moved it
const bob = [{ ...base, x: 99, version: 2, versionNonce: 222 }, { id: 'text1', type: 'text', version: 1, versionNonce: 7, isDeleted: false }];

const onAlice = reconcile(alice, bob);   // Alice receives Bob's state
const onBob = reconcile(bob, alice);     // Bob receives Alice's state
console.log(onAlice.map((e) => `${e.id}@x=${e.x ?? '-'}`), onBob.map((e) => `${e.id}@x=${e.x ?? '-'}`));

test('both replicas converge to the same winner', () => {
  const pick = (els) => els.find((e) => e.id === 'rect1').x;
  expect(pick(onAlice)).toBe(pick(onBob));
  expect(pick(onAlice)).toBe(10);                 // equal versions: lower nonce wins deterministically
  expect(onAlice.some((e) => e.id === 'text1')).toBe(true);
  const deleted = reconcile(onAlice, [{ ...base, x: 10, version: 3, versionNonce: 1, isDeleted: true }]);
  expect(deleted.some((e) => e.id === 'rect1')).toBe(false); // deletion propagates as a newer version
});
```

### Implement a simple CRDT: a grow-only counter and an LWW map

These two CRDTs build intuition for the merge function's properties (**commutative, associative, idempotent**), which is what makes CRDTs converge regardless of delivery order or duplicates.

```js
// G-Counter: each replica increments its own slot; merge = element-wise max
const gCounter = {
  increment: (c, replica, n = 1) => ({ ...c, [replica]: (c[replica] ?? 0) + n }),
  merge: (a, b) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, Math.max(a[k] ?? 0, b[k] ?? 0)])),
  value: (c) => Object.values(c).reduce((s, n) => s + n, 0),
};

// LWW-Map: each key keeps (value, timestamp, replicaId); higher timestamp wins, replica id breaks ties
const lwwMap = {
  set: (m, key, value, ts, replica) => ({ ...m, [key]: { value, ts, replica } }),
  merge: (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      const cur = out[k];
      if (!cur || v.ts > cur.ts || (v.ts === cur.ts && v.replica > cur.replica)) out[k] = v;
    }
    return out;
  },
};

let tabA = gCounter.increment({}, 'A', 3);   // 3 reactions from replica A
let tabB = gCounter.increment({}, 'B', 2);   // 2 reactions from replica B
tabB = gCounter.increment(tabB, 'B');
const merged1 = gCounter.merge(tabA, tabB);
const merged2 = gCounter.merge(gCounter.merge(tabB, tabA), tabA);   // different order + duplicate delivery
console.log('reactions:', gCounter.value(merged1));

const s1 = lwwMap.set({}, 'title', 'Weekly sync', 100, 'A');
const s2 = lwwMap.set({}, 'title', 'Weekly standup', 105, 'B');
test('CRDT merges are commutative and idempotent', () => {
  expect(merged1).toEqual(merged2);
  expect(gCounter.value(merged1)).toBe(6);
  expect(lwwMap.merge(s1, s2)).toEqual(lwwMap.merge(s2, s1));
  expect(lwwMap.merge(s1, s2).title.value).toBe('Weekly standup');
});
```

### How do you integrate real-time updates with React state and caches?

- **Subscribe in one place** (a provider or a store module), not in every component. Expose the data through **`useSyncExternalStore`**, Redux middleware or Zustand.
- **Update server-state caches from events:** on `recording:finished`, call SWR `mutate('/api/recordings')` or TanStack `queryClient.setQueryData(...)` / `invalidateQueries`. The UI then stays consistent with what the REST API returns, and you avoid a separate "live" copy of the data.
- **Batch high-frequency events** (cursor positions, audio levels) per animation frame before touching React state.
- **Handle reconnects:** after reconnecting, **refetch** (`mutate()` or invalidate) to catch up on missed events, unless the protocol supports resume.
- **Effects with cleanup:** unsubscribe on unmount, which StrictMode will test for you.

### How do you debug real-time connection problems?

- **DevTools → Network → WS:** see the handshake (status 101, headers) and **every frame** with timestamps and sizes. Filter by message type.
- **CLI clients:** `wscat -c wss://host/ws` or `websocat` to reproduce server behaviour without the UI.
- **Common issues:**
  - a proxy that doesn't forward `Upgrade`/`Connection` (Nginx needs `proxy_http_version 1.1` and `proxy_set_header Upgrade $http_upgrade` / `Connection "upgrade"`)
  - **idle timeouts** that close quiet connections at 60 s (fix with heartbeats or longer timeouts)
  - **corporate proxies** blocking WebSockets (fall back to long polling or SSE)
  - **mixed content** (`ws://` on an HTTPS page)
  - the token expiring mid-connection
- **Observability:** count connects, disconnects and reconnects per minute, close-code distributions, message rates and latencies per channel, and **reconnect storms after deploys**.
