# Jitsi, Prosody & XMPP

Your resume lists **Prosody (XMPP)** next to React and WebRTC, which is rare. Interviewers at real-time or communication companies will test whether you understand **XMPP as a protocol**, **how Prosody is configured and extended**, and **how the Jitsi components cooperate**. The MeetHour deep dive covers *your features*. This page covers the *platform knowledge* underneath them.

> Lua snippets show Prosody's module API (not runnable here). The JavaScript blocks (stanza building, JWT signing and verification) are runnable.

## XMPP fundamentals

### What is XMPP and why does Jitsi use it for signalling? 🔥

**XMPP** (Extensible Messaging and Presence Protocol, RFC 6120/6121) is an open, **XML-based**, federated protocol for messaging and **presence**. A client opens a long-lived **XML stream** to its server and exchanges small XML fragments called **stanzas**. It's **extensible** through **XEPs** (XMPP Extension Protocols), each in its own XML **namespace**.

**Why it fits conferencing signalling:**

- **Presence** is built in: who is in the room, their status and metadata. That maps directly to "participants and their mute state".
- **Multi-User Chat (MUC, XEP-0045)** models a meeting room, with roles, affiliations, moderation and passwords.
- **Jingle (XEP-0166/0167/0176)** is a standard way to negotiate media sessions, including ICE candidates and DTLS fingerprints.
- Mature servers (Prosody), client libraries (Strophe.js), **federation (server-to-server)** used by Jitsi's visitor nodes, and an extensible security and auth model.

### What are the three XMPP stanza types? 🔥

| Stanza | Purpose | Delivery | Jitsi usage |
|---|---|---|---|
| **`<message>`** | Push a payload, fire-and-forget. Types: `chat`, `groupchat`, `normal`, `headline`, `error` | Routed to the recipient | In-meeting chat (`groupchat`), private messages, some endpoint messages |
| **`<presence>`** | Availability plus broadcast state. In MUC, **joining = sending presence** to `room@conference/nick` | **Broadcast** to subscribers / all room occupants | Participant join/leave and **all per-participant state**: display name, audio/video muted, raised hand, role, codec, stats-id, recording status (from focus) |
| **`<iq>`** (Info/Query) | **Request–response**: `type="get" \| "set"` → `"result" \| "error"`, correlated by **`id`** | One-to-one, must be answered | Conference request to Jicofo, Jingle actions (`session-initiate`, `source-add`), Jibri start/stop, Colibri allocation, lobby/breakout actions, pings |

**JIDs** (Jabber IDs) look like `localpart@domainpart/resourcepart`:

- **bare JID:** `user@meet.example.com`
- **full JID:** `user@meet.example.com/abc123` (a specific connection)
- **in MUC:** `room@conference.meet.example.com/nickname` is an occupant's **room JID**

```js
// A Strophe-style stanza builder (the API shape of $pres()/$iq() in Strophe.js), runnable
function el(name, attrs = {}) {
  const node = { name, attrs, children: [], text: null, parent: null };
  const api = {
    c(childName, childAttrs) { const child = el(childName, childAttrs); child.node.parent = api; node.children.push(child.node); return child; },
    t(text) { node.text = String(text); return api; },
    up() { return node.parent ?? api; },
    root() { let a = api; while (a.node.parent) a = a.node.parent; return a; },
    toString() { return serialize(node); },
    node,
  };
  return api;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
function serialize(n) {
  const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  const inner = (n.text !== null ? esc(n.text) : '') + n.children.map(serialize).join('');
  return inner ? `<${n.name}${attrs}>${inner}</${n.name}>` : `<${n.name}${attrs}/>`;
}

// Joining a MUC = presence to room@conference/nick, with Jitsi-style extensions
const join = el('presence', { to: 'standup@conference.meet.example.com/7f3a2b1c' })
  .c('x', { xmlns: 'http://jabber.org/protocol/muc' }).up()
  .c('nick', { xmlns: 'http://jabber.org/protocol/nick' }).t('Zaki <host>').up()
  .c('audiomuted').t('false').up()
  .c('videomuted').t('true').up()
  .c('raisedHand').t('1700000000000').up()           // timestamp when the hand was raised
  .root();

// A request to the focus (Jicofo) to start a recording session
const startRecording = el('iq', { type: 'set', to: 'focus.meet.example.com', id: 'rec-1' })
  .c('jibri', { xmlns: 'http://jitsi.org/protocol/jibri', action: 'start', recording_mode: 'file', app_data: '{"file_recording_metadata":{"share":true}}' })
  .root();

console.log(String(join));
console.log(String(startRecording));

test('stanzas are well-formed and escaped', () => {
  expect(String(join)).toContain('<nick xmlns="http://jabber.org/protocol/nick">Zaki &lt;host&gt;</nick>');
  expect(String(startRecording)).toMatch(/^<iq type="set" to="focus\.meet\.example\.com" id="rec-1"><jibri /);
});
```

### What is MUC (XEP-0045)? Explain roles and affiliations 🔥

**Multi-User Chat** rooms live on a MUC **component** (e.g. `conference.meet.example.com`).

- **Join:** send presence to `room@service/nick`. The server replies with the presence of every existing occupant, then your own presence (with status code 110, "this is you"), and broadcasts your presence to everyone else.
- **Affiliations** are **persistent**, tied to the **bare JID**: `owner` > `admin` > `member` > `none` > `outcast` (banned).
- **Roles** are **per session**: `moderator` > `participant` > `visitor` (in moderated rooms, visitors have no "voice").
- **Room configuration** (through a data form): members-only, password-protected, moderated, persistent, max occupants, who can see real JIDs (semi-anonymous vs non-anonymous).
- **Kick** sets role `none`; **ban** sets affiliation `outcast`. Changing roles or affiliations is done with IQs (`muc#admin`).
- **Jitsi mapping:**
  - Jicofo (focus) joins as **owner**
  - moderators get the `moderator` role, granted by Jicofo's auto-owner logic, JWT claims or authentication
  - the lobby uses **members-only** plus a separate lobby room
  - Jitsi "visitors" are a different concept from XEP-0045 visitors (separate nodes, not just a role)

### How does an XMPP client connect from the browser? BOSH vs WebSocket 🔥

Browsers can't open raw TCP sockets, so XMPP is carried over HTTP-friendly transports:

- **BOSH** (XEP-0124/0206): **HTTP long-polling**. The client keeps an HTTP request pending; the server responds when it has stanzas to send. Higher latency and overhead, but it works through any proxy. Jitsi exposes it at `/http-bind`.
- **WebSocket** (RFC 7395): a full-duplex framing of XMPP over a WebSocket (`wss://host/xmpp-websocket`). Lower latency and overhead, so it's **preferred**. Prosody's `mod_websocket` provides it. Nginx must proxy the `Upgrade` headers, and tune timeouts for long-lived connections.
- **Session resumption / reliability:** **XEP-0198 Stream Management** (acks and resumption after a brief disconnect, so participants don't drop out on a network blip) and **XEP-0199 pings**.
- **Strophe.js** is the JS client library that lib-jitsi-meet uses.

### What is Jingle and how does it relate to SDP? 🔥

**Jingle** (XEP-0166, with RTP in XEP-0167 and ICE-UDP in XEP-0176) negotiates media sessions with **IQs**: `session-initiate`, `session-accept`, `transport-info` (trickled candidates), `source-add` / `source-remove` (Jitsi's extension for adding or removing streams without full renegotiation), `session-terminate`.

It carries the same information as SDP, but **as structured XML**:

- `<content name="video">`
- `<description xmlns="urn:xmpp:jingle:apps:rtp:1" media="video">` with `<payload-type id="96" name="VP8" clockrate="90000">`, `<rtcp-fb>`, `<rtp-hdrext>` and `<source ssrc>` (XEP-0339)
- `<transport xmlns="urn:xmpp:jingle:transports:ice-udp:1" ufrag pwd>` with `<candidate>` and `<fingerprint>` (XEP-0320)

**In Jitsi**, lib-jitsi-meet translates between Jingle and SDP for the browser's `RTCPeerConnection`. **Jicofo is the Jingle initiator** for the session with the bridge. Knowing that you can **read a Jingle session-initiate and map it to SDP** is a strong signal in interviews.

### Which XEPs are most relevant to a Jitsi-based system?

| XEP / RFC | What | Where it shows up |
|---|---|---|
| RFC 6120/6121 | XMPP core and IM/presence | Everything |
| **XEP-0045** | Multi-User Chat | Meeting rooms, lobby, breakout rooms |
| XEP-0030 | Service Discovery (`disco#info/items`) | Discovering features and components |
| **XEP-0166/0167/0176** | Jingle, RTP, ICE-UDP | Media session negotiation |
| XEP-0320 / 0339 / 0294 | DTLS fingerprints, sources (SSRCs), RTP header extensions in Jingle | Media details |
| XEP-0340 | **COLIBRI** (bridge control) | Jicofo ↔ JVB (now Colibri2) |
| XEP-0124/0206 | BOSH | `/http-bind` transport |
| RFC 7395 | XMPP over WebSocket | `/xmpp-websocket` |
| XEP-0198 | Stream Management | Reconnect without losing session state |
| XEP-0199 | Ping | Keepalive |
| **XEP-0215** | External Service Discovery | Handing **TURN/STUN credentials** to clients (`mod_turncredentials` / `mod_external_services`) |
| XEP-0115 | Entity Capabilities | Feature advertisement in presence |

## Prosody

### What is Prosody and how is it configured for Jitsi? 🔥

**Prosody** is a lightweight, modular XMPP server written in **Lua**. Configuration is Lua as well: `/etc/prosody/prosody.cfg.lua` plus per-host files in `conf.d/`.

A typical Jitsi layout:

```lua
-- /etc/prosody/conf.d/meet.example.com.cfg.lua (simplified)
plugin_paths = { "/usr/share/jitsi-meet/prosody-plugins/" }

VirtualHost "meet.example.com"                 -- where web/mobile clients log in
    authentication = "token"                  -- JWT auth ("jitsi-anonymous" / "internal_hashed" are alternatives)
    app_id = "meethour"
    app_secret = "change-me"                  -- HS256 secret (or asap_key_server for RS256)
    allow_empty_token = false
    modules_enabled = {
        "bosh"; "websocket"; "smacks";        -- transports + stream management
        "ping"; "speakerstats"; "conference_duration";
        "muc_lobby_rooms"; "muc_breakout_rooms"; "av_moderation"; "room_metadata";
        "external_services";                  -- XEP-0215: TURN credentials for clients
    }
    main_muc = "conference.meet.example.com"
    lobby_muc = "lobby.meet.example.com"
    breakout_rooms_muc = "breakout.meet.example.com"
    c2s_require_encryption = false            -- TLS terminated at nginx in front of BOSH/WebSocket

VirtualHost "auth.meet.example.com"            -- internal accounts: focus, jvb, jibri, jigasi
    authentication = "internal_hashed"
    modules_enabled = { "limits_exception"; }

Component "conference.meet.example.com" "muc"  -- the meeting rooms
    modules_enabled = { "muc_meeting_id"; "muc_domain_mapper"; "polls"; "token_verification"; "muc_rate_limit"; }
    muc_room_locking = false
    muc_room_default_public_jids = true

Component "internal.auth.meet.example.com" "muc" -- brewery rooms: JvbBrewery, JibriBrewery, JigasiBrewery
    modules_enabled = { "ping"; }
    muc_room_cache_size = 1000

Component "focus.meet.example.com" "client_proxy" -- the address clients send conference IQs to
    target_address = "focus@auth.meet.example.com"

Component "lobby.meet.example.com" "muc"
Component "breakout.meet.example.com" "muc"

VirtualHost "recorder.meet.example.com"        -- hidden domain for Jibri's call login
    modules_enabled = { "ping"; }
    authentication = "internal_hashed"
```

**Key concepts:**

- **VirtualHost:** an XMPP domain that users log into.
- **Component:** a service on its own domain. MUC rooms, the focus proxy and speaker stats are components.
- **Module:** a Lua plugin hooking into server events.

Also know the **docker-jitsi-meet** environment variables (e.g. `XMPP_DOMAIN`, `XMPP_MUC_DOMAIN`, `XMPP_INTERNAL_MUC_DOMAIN`, `XMPP_RECORDER_DOMAIN`, `JIBRI_BREWERY_MUC`, `ENABLE_AUTH`, `AUTH_TYPE=jwt`, `JWT_APP_ID`, `JWT_APP_SECRET`) if you deployed with Docker.

### How do you write a custom Prosody module? Give an example 🔥

Modules are Lua files (`mod_<name>.lua`) in a plugin path, enabled through `modules_enabled`. They **hook events** with `module:hook(event, handler, priority)`.

- Return **`true`** from a handler to **stop processing** (block the event).
- Use `module:get_option_*` for config, `module:log` for logging, `module:depends`, and `module:provides("http", …)` for HTTP endpoints.
- Use `util.stanza` to build stanzas (`st.reply`, `st.error_reply`), and `util.jid` to split and normalise JIDs.

**Common MUC events:**

- `muc-room-pre-create`, `muc-room-created`, `muc-room-destroyed`
- **`muc-occupant-pre-join`** (enforce rules before join), `muc-occupant-joined`, `muc-occupant-left`
- `muc-occupant-pre-change`, `muc-broadcast-presence` (modify outgoing presence)
- `muc-set-affiliation`

**Example:** enforce role-based permissions for **Visitor/Webinar mode**. Only hosts may join the main room unmuted, the occupant's role is tagged in presence so every client can render it, and a webhook fires on joins.

```lua
-- mod_meethour_roles.lua (illustrative)
local st = require "util.stanza";
local jid = require "util.jid";
local http = require "net.http";
local json = require "util.json";

local webhook_url = module:get_option_string("meethour_webhook_url");
local MAX_MAIN = module:get_option_number("meethour_max_main_participants", 100);

-- 1) Before join: deny if the main room is full and the user isn't a host
module:hook("muc-occupant-pre-join", function(event)
    local room, stanza, origin = event.room, event.stanza, event.origin;
    local session_ctx = origin.jitsi_meet_context_user or {};   -- set by token auth from the JWT
    local is_host = session_ctx.moderator == true or session_ctx.moderator == "true";
    local count = 0;
    for _ in room:each_occupant() do count = count + 1; end
    if count >= MAX_MAIN and not is_host then
        origin.send(st.error_reply(stanza, "cancel", "service-unavailable", "Room is full, join as a visitor"));
        return true;                                             -- stop: the join is rejected
    end
end, 10);

-- 2) Tag the occupant's role in every presence broadcast so all clients can render it
module:hook("muc-broadcast-presence", function(event)
    local occupant, stanza = event.occupant, event.stanza;
    local role = (occupant.role == "moderator") and "host" or "participant";
    stanza:maptags(function(tag)                                -- remove client-supplied spoofed role
        if tag.name == "meethour-role" then return nil; end
        return tag;
    end);
    stanza:tag("meethour-role", { xmlns = "urn:meethour:role" }):text(role):up();
end);

-- 3) Notify the backend asynchronously when someone joins (never block the XMPP thread)
module:hook("muc-occupant-joined", function(event)
    if not webhook_url then return; end
    local room_node = jid.node(event.room.jid);
    http.request(webhook_url, {
        method = "POST",
        headers = { ["Content-Type"] = "application/json" },
        body = json.encode({ event = "joined", room = room_node, nick = event.occupant.nick }),
    }, function(_, code) if code ~= 200 then module:log("warn", "webhook failed: %s", tostring(code)); end end);
end);
```

**Talking points:**

- **Enforce on the server.** Clients can be modified, so permission checks must live in modules.
- **Strip client-supplied versions** of server-asserted extensions to prevent spoofing.
- **Never block** Prosody's single-threaded event loop with synchronous I/O. Use `net.http` asynchronously.
- **Priorities** control ordering relative to other modules' hooks.

### How does JWT (token) authentication work in Jitsi/Prosody? 🔥

1. The **customer's backend** (MeetHour's API) **signs a JWT** after authenticating the user:
   - `iss` (issuer = `app_id`), `aud` (often `"jitsi"`), `sub` (tenant/domain), **`room`** (the room name, or `*` for any)
   - `exp`/`nbf`
   - **`context`** (user `id`, `name`, `email`, `avatar`, and flags such as `moderator`, plus optional `features` like recording or livestreaming)
2. The client opens the meeting URL with **`?jwt=<token>`**. lib-jitsi-meet passes it on the BOSH/WebSocket connection.
3. **Prosody's token auth** (`authentication = "token"`, `mod_auth_token`) **verifies the signature** with HS256 `app_secret`, or RS256 with public keys fetched from `asap_key_server`. It checks `iss`/`aud`/`exp`, and **`mod_token_verification`** checks that the **`room` claim matches** the MUC room being joined.
4. The user context from the token is attached to the session (e.g. `jitsi_meet_context_user`), so modules can derive moderator rights, display name and avatar.
5. **Security notes:**
   - Keep tokens **short-lived** (minutes to hours).
   - Never let the client mint tokens. Never put the secret in the frontend.
   - Use **RS256 with key rotation** for multi-tenant setups.
   - Validate **`room`** to prevent a token for one meeting being reused in another.

```js
// Build and verify a Jitsi-style HS256 JWT with Web Crypto (backend logic, runnable)
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signJitsiToken({ secret, appId, room, user, ttl = 3600, now = Math.floor(Date.now() / 1000) }) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { iss: appId, aud: 'jitsi', sub: 'meet.example.com', room, nbf: now - 10, exp: now + ttl, context: { user } };
  const data = `${enc(header)}.${enc(payload)}`;
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(data)));
  return `${data}.${b64url(sig)}`;
}

async function verifyJitsiToken(token, { secret, appId, room, now = Math.floor(Date.now() / 1000) }) {
  const [h, p, s] = token.split('.');
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('bad signature');
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  if (claims.iss !== appId) throw new Error('bad issuer');
  if (claims.exp <= now || claims.nbf > now) throw new Error('token expired or not yet valid');
  if (claims.room !== '*' && claims.room !== room) throw new Error(`token not valid for room ${room}`);
  return claims;
}

const now = 1_760_000_000;
const token = await signJitsiToken({ secret: 's3cret', appId: 'meethour', room: 'weekly-sync', now, user: { id: 'u1', name: 'Zaki', moderator: true } });
console.log(token.split('.').map((part) => part.slice(0, 24) + '…').join('.'));
const claims = await verifyJitsiToken(token, { secret: 's3cret', appId: 'meethour', room: 'weekly-sync', now: now + 60 });
console.log(claims.context.user);

test('rejects wrong room, tampering and expiry', async () => {
  await expect(verifyJitsiToken(token, { secret: 's3cret', appId: 'meethour', room: 'other-room', now })).rejects.toThrow('not valid for room');
  await expect(verifyJitsiToken(token, { secret: 'wrong', appId: 'meethour', room: 'weekly-sync', now })).rejects.toThrow('bad signature');
  await expect(verifyJitsiToken(token, { secret: 's3cret', appId: 'meethour', room: 'weekly-sync', now: now + 7200 })).rejects.toThrow('expired');
});
```

### How do you debug Prosody issues?

- **Logs:** `/var/log/prosody/prosody.log` and `prosody.err`. Raise the level to `debug` temporarily in the config (`log = { debug = "/var/log/prosody/debug.log" }`).
- **`prosodyctl`:**
  - `prosodyctl status`, `check config`, `check dns`, `check certs`
  - `prosodyctl register focus auth.meet.example.com <pass>` (create internal users)
  - `prosodyctl shell` (the admin console: inspect rooms with `muc:room("room@conference…")`, list sessions with `c2s:show()`, reload modules)
- **Common problems:**
  - "**Jibri never becomes available**": wrong brewery room name or domain in `jibri.conf`, wrong control login credentials, missing `internal.auth` MUC component
  - "**Jicofo can't find a bridge**": JVB not joined to the JvbBrewery, auth failure for the `jvb` user, mismatched domains
  - **Token auth failures**: the `room` claim doesn't match, clock skew causes `nbf`/`exp` failures, wrong `aud`/`iss`
  - **WebSocket not working**: Nginx `proxy_set_header Upgrade/Connection` missing, `cross_domain_websocket`, proxy timeouts

## Jitsi components

### What does Jicofo do exactly? 🔥

**Jicofo** (Jitsi Conference Focus, written in Kotlin/Java) is the **conference controller**:

1. **Conference lifecycle:** on a client's `<conference>` request, it creates or joins the MUC as **owner** (focus) and manages participants.
2. **Bridge selection:**
   - watches **JvbBrewery** presence (each bridge's stress, region, version, graceful-shutdown state)
   - picks bridges with strategies: single, split, **region-based**, intra-region
   - **load-balances** and enables **cascading** (relays) across bridges for big or geo-distributed meetings
3. **Media allocation:** **Colibri2** requests to bridges to create endpoints and relays and to update sources.
4. **Signalling with participants:** **Jingle** sessions (`session-initiate` with the bridge's transport and existing sources; `source-add`/`source-remove` as participants come and go).
5. **Moderation and features:**
   - grants moderator (owner) rights according to the auth mode
   - handles **AV moderation**, lobby integration, breakout rooms (with Prosody modules)
   - the start-muted policy
6. **Jibri and Jigasi management:** selects idle instances from their breweries, starts and stops sessions, propagates status (`jibri-recording-status`).
7. **Visitors:** redirects joins to visitor nodes and manages their media sessions.
8. **Health and failover:** detects failed bridges and **re-invites participants to a healthy bridge**.

### What is the JVB and how do you configure it behind NAT?

The **Jitsi Videobridge** is the **SFU**. It receives RTP from each endpoint and forwards selected streams to the others. That includes **simulcast/SVC layer selection** per receiver, **last-N**, receiver video constraints, bandwidth estimation (TCC), the **bridge channel** (Colibri WebSocket) and **relays** for cascading. Configuration is `jvb.conf` (HOCON).

**NAT and cloud deployment** (the most common production issue):

- The JVB must **advertise the public IP** in its ICE candidates. On AWS and other clouds, the instance has a private IP. Configure **static mappings** (`ice4j.harvest.mapping.static-mappings` with local and public addresses, or the Docker `JVB_ADVERTISE_IPS`), or STUN-based discovery.
- **Open UDP 10000** (media) in the security group and firewall. If it's closed, ICE fails and users see "everyone's video is black" or they get disconnected in calls with 3+ people. 1:1 calls may still work because they're P2P.
- **TCP fallback:** use TURN (coturn on 443) for clients on UDP-blocked networks. JVB's own TCP harvester is deprecated in favour of TURN.

**Monitoring:** the `/colibri/stats` REST endpoint (conferences, participants, stress, bitrates, packet loss), `/about/health`, Prometheus exporters.

### Explain the full lifecycle of a recording through the Jitsi stack 🔥

```text
Moderator clicks "Start recording"
  └─ client sends IQ <jibri action="start" recording_mode="file"/> to focus.<domain>
       └─ Jicofo checks permissions (moderator? feature enabled in JWT?)
       └─ Jicofo picks an IDLE Jibri from JibriBrewery presence
       └─ Jicofo sends start IQ to that Jibri (room JID, session id, mode, stream key/app_data)
            └─ Jibri: launches Chrome (Selenium) in Xvfb, joins room as hidden user on recorder.<domain>
            └─ Jibri: starts ffmpeg (x11grab + ALSA loopback → H.264/AAC → MP4 or RTMP)
            └─ Jibri → Jicofo: status PENDING → ON (or OFF + failure reason)
       └─ Jicofo publishes jibri-recording-status in its MUC presence
  └─ all clients show "Recording" indicator (and play the recording notification)
Stop: client IQ action="stop" → Jicofo → Jibri stops ffmpeg, leaves, runs finalize script (upload, webhook)
```

**Failure points to mention:**

- no idle Jibri → "recording unavailable"
- Chrome or ChromeDriver version mismatch
- `snd-aloop` kernel module missing (no audio)
- disk full
- RTMP endpoint rejects the stream key
- network egress limits

### What are breakout rooms and how are they implemented in Jitsi?

- Moderators create **sub-rooms**. Each breakout room is a **separate MUC** on the `breakout.<domain>` component, and **`mod_muc_breakout_rooms`** tracks the relationship with the main room.
- Moderators can create, rename, close and **move participants**. Participants receive a message telling them to switch rooms. The client leaves one MUC and joins another (a new conference session with Jicofo), and can return to the main room.
- The breakout state (the list of rooms and who is where) is broadcast to moderators. Closing a room moves its participants back.
- **Interview angle:** switching rooms means leaving and rejoining **conferences**, which affects media continuity (a brief interruption) and requires careful client state handling: chat history per room, device state preserved, UI transitions.

### How do you scale a Jitsi deployment and keep it highly available? 🔥

1. **Shards:** a shard = Prosody + Jicofo (+ the web front end) + a pool of JVBs. Rooms are pinned to a shard (all participants of a room must be on the same Prosody/Jicofo). A **front proxy** (HAProxy/Nginx) routes by **room name** (consistent hashing on the `room` query parameter, or stick tables).
2. **JVB autoscaling:** scale on **stress** and participant counts. Use **graceful shutdown** (bridges stop accepting new conferences and drain existing ones) for scale-in and upgrades.
3. **Octo / relays (cascading):** one conference across multiple bridges, for capacity and **geo-proximity**. Users connect to a nearby bridge, and bridges exchange streams.
4. **Jibri pool autoscaling** on the idle count. Keep a warm buffer.
5. **Visitors** for very large audiences: separate Prosody visitor nodes connected with s2s, plus receive-only media.
6. **TURN servers** near users. A CDN for static assets. Monitoring and alerting (Prometheus/Grafana): stress, ICE failures, join times, recording failures.
7. **HA:** shard health checks with **failover** (drain a bad shard, send new rooms elsewhere). Prosody and Jicofo are **stateful per shard**, so a shard crash ends its meetings, and clients reconnect to a healthy shard. Bridges fail over within a shard through Jicofo.

### How does Jitsi support end-to-end encryption?

- Normal Jitsi calls are encrypted **hop-by-hop** (DTLS-SRTP between client and JVB). The bridge can technically access the media.
- **E2EE mode** uses **Insertable Streams / Encoded Transform**. Each sender encrypts its **frame payloads** (AES-GCM, SFrame-like) in a worker before packetisation, and receivers decrypt. The JVB still routes packets (headers stay readable) but can't decode the media.
- **Key management:** keys are exchanged between participants using **Olm** (Signal-protocol style double ratchet, via the libolm/vodozemac WASM build) over **endpoint messages**. They're rotated when participants join or leave (ratcheting) so newcomers can't decrypt past media.
- **Limits:**
  - **recording, streaming and transcription don't work** in E2EE, because Jibri and Jigasi aren't trusted endpoints
  - browser support requirements (Encoded Transform)
  - some CPU overhead
  - SIP participants can't take part

### Compare Jitsi with other media servers (mediasoup, Janus, LiveKit, Kurento)

| | Jitsi (JVB) | mediasoup | Janus | LiveKit | Kurento |
|---|---|---|---|---|---|
| Type | Complete platform (SFU + signalling + app + recording) | SFU **library** (Node.js + C++ workers) | General-purpose WebRTC gateway with plugins (C) | SFU platform (Go, built on Pion) with SDKs | Media server with processing (MCU-like, mostly unmaintained) |
| Signalling | XMPP/Jingle | Bring your own | Its own API (HTTP/WebSocket) | Its own (WebSocket + protobuf) | Its own (JSON-RPC) |
| Strength | Full product out of the box, proven scale, visitors, Jibri | Maximum flexibility and performance for custom apps | Flexible plugins (SIP, streaming, video room) | Developer experience, modern SDKs, cloud offering | Media processing pipelines |

**Why MeetHour builds on Jitsi:** a complete, open-source, battle-tested conferencing stack that can be extended (React UI, Prosody modules) instead of building signalling, recording and an app from scratch.
