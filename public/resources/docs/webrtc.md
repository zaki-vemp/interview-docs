# WebRTC In Depth

WebRTC is the technical heart of MeetHour, and very few frontend candidates know it deeply. Expect questions from "how does a call get connected" down to "why did the video freeze": **SDP, ICE, STUN/TURN, DTLS-SRTP, codecs, simulcast/SVC, congestion control, `getStats` and debugging**.

> Browser-only code (needs `RTCPeerConnection`/camera) is labelled **Node.js/JSX** or explained inline. The runnable blocks work on the *data* of WebRTC (SDP, ICE candidates, stats, TURN credentials), which is what you debug in practice.

## Fundamentals

### What is WebRTC and what are its main APIs? 🔥

**WebRTC** (Web Real-Time Communication) is a set of browser APIs and protocols (W3C + IETF) for **peer-to-peer, low-latency audio, video and data**, encrypted by default, with no plugins.

**Main APIs:**

- **`navigator.mediaDevices.getUserMedia(constraints)`:** camera and microphone → `MediaStream` with `MediaStreamTrack`s.
- **`getDisplayMedia()`:** screen, window or tab capture.
- **`RTCPeerConnection`:** a connection to a remote peer (or to an SFU such as the JVB). It handles **ICE** (connectivity), **DTLS** (key exchange), **SRTP** (encrypted media), codecs, congestion control, jitter buffers and RTCP feedback.
- **`RTCRtpTransceiver` / `RTCRtpSender` / `RTCRtpReceiver`:** per-media-section control: `replaceTrack`, `setParameters` (bitrate, simulcast encodings), codec preferences.
- **`RTCDataChannel`:** arbitrary data over **SCTP over DTLS** (chat, file transfer, game state, whiteboard events).
- **`getStats()`:** detailed metrics.

**What WebRTC deliberately doesn't define:** **signalling**, the way peers exchange SDP and ICE candidates. You choose WebSocket, XMPP/Jingle (Jitsi), SIP, HTTP and so on.

### Walk me through establishing a WebRTC call 🔥

1. **Capture:** `getUserMedia` → add tracks with `pc.addTrack(track, stream)` (or `addTransceiver`).
2. **Offer:** caller: `offer = await pc.createOffer()` → `await pc.setLocalDescription(offer)` → send `offer.sdp` through **signalling**.
3. **Answer:** callee: `await pc.setRemoteDescription(offer)` → add its own tracks → `answer = await pc.createAnswer()` → `setLocalDescription(answer)` → send the answer back. Caller: `setRemoteDescription(answer)`.
4. **ICE (trickle):** as each side **gathers candidates** (host, server-reflexive via STUN, relay via TURN), `pc.onicecandidate` fires. Send each candidate to the other side, which calls `pc.addIceCandidate(candidate)`.
5. **Connectivity checks:** ICE pairs local and remote candidates and sends **STUN binding requests** on each pair. The best working pair is **nominated** (`iceConnectionState` → `connected`).
6. **DTLS handshake** over the selected pair. Each side verifies that the peer's certificate **fingerprint matches the one in the SDP**, then **SRTP keys** are derived (DTLS-SRTP).
7. **Media flows:** `pc.ontrack` fires on the receiver → attach `event.streams[0]` to a `<video>`.
8. **Ongoing:** RTCP feedback (receiver reports, NACK, PLI), bandwidth estimation, renegotiation when tracks change (`negotiationneeded`), ICE restarts on network change.

```node
// Minimal caller (browser). `signal` is your WebSocket/XMPP transport.
const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'turns:turn.example.com:443', username, credential }] });

const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 1280, height: 720 } });
stream.getTracks().forEach((t) => pc.addTrack(t, stream));

pc.onicecandidate = ({ candidate }) => candidate && signal.send({ type: 'candidate', candidate });
pc.ontrack = ({ streams: [remote] }) => { remoteVideo.srcObject = remote; };
pc.onconnectionstatechange = () => console.log('connection:', pc.connectionState);

await pc.setLocalDescription(await pc.createOffer());
signal.send({ type: 'offer', sdp: pc.localDescription });

signal.on('answer', (answer) => pc.setRemoteDescription(answer));
signal.on('candidate', (c) => pc.addIceCandidate(c));
```

**In Jitsi/MeetHour** the shape is the same, but the **SFU (JVB) is the "remote peer"**. **Jicofo sends the offer** as a Jingle `session-initiate`, lib-jitsi-meet converts Jingle ↔ SDP, and the client answers. (See the MeetHour deep dive.)

### What is SDP and what's inside it? 🔥

**SDP (Session Description Protocol)** is a text format describing the session. WebRTC uses it in an **offer/answer** model. Key parts:

- **Session level:** `v=`, `o=` (origin), `s=`, `t=`, and **`a=group:BUNDLE 0 1 2`** (all media multiplexed on one transport, the norm today).
- **Media sections (`m=` lines):** one per transceiver (`m=audio 9 UDP/TLS/RTP/SAVPF 111 63 …`), listing **payload types**.
  - **`a=rtpmap:111 opus/48000/2`** and **`a=fmtp:`** parameters (e.g. `useinbandfec=1`, H.264 `profile-level-id`)
  - **`a=rtcp-fb:`** feedback types: `nack`, `nack pli`, `ccm fir`, `goog-remb`, **`transport-cc`**
  - **`a=extmap:`** RTP header extensions (abs-send-time, transport-wide-cc, audio-level, mid, rid)
  - **`a=mid:`**, direction (`a=sendrecv` / `sendonly` / `recvonly` / `inactive`), **`a=msid:`** (stream and track IDs)
  - **SSRCs and simulcast:** `a=ssrc:`, `a=ssrc-group:FID` (RTX), `a=rid:` + `a=simulcast:send` (rid-based simulcast)
- **Transport:** **`a=ice-ufrag` / `a=ice-pwd`** (ICE credentials), **`a=fingerprint:sha-256 …`** (DTLS certificate hash), **`a=setup:actpass|active|passive`** (DTLS role), `a=candidate:` lines (if not trickled).
- **Unified Plan vs Plan B:** **Unified Plan** (the standard) means **one `m=` section per track** (transceivers). **Plan B** (old Chrome) put multiple tracks in one `m=` section and **was removed from Chrome** around 2021–22. Jitsi had to migrate to Unified Plan, and it's part of why multi-stream support required signalling changes.

```js
// Parse an SDP and summarise it — the kind of tool you write while debugging
const sdp = `v=0
o=- 4611731400430051336 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0 1
a=msid-semantic: WMS stream1
m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0
c=IN IP4 0.0.0.0
a=ice-ufrag:F7gI
a=ice-pwd:x9cml/YzichV2+XlhiMu8g
a=fingerprint:sha-256 49:66:12:17:0D:1C:91:AE:57:4C:C6:36:DD:D5:97:D2:7D:62:C9:9A:7F:B9:A3:F4:70:03:E7:43:91:73:23:5E
a=setup:actpass
a=mid:0
a=sendrecv
a=rtpmap:111 opus/48000/2
a=fmtp:111 minptime=10;useinbandfec=1
a=rtcp-fb:111 transport-cc
a=rtpmap:63 red/48000/2
a=rtpmap:9 G722/8000
a=rtpmap:0 PCMU/8000
m=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99
c=IN IP4 0.0.0.0
a=mid:1
a=sendrecv
a=rtpmap:96 VP8/90000
a=rtcp-fb:96 nack
a=rtcp-fb:96 nack pli
a=rtcp-fb:96 transport-cc
a=rtpmap:97 rtx/90000
a=fmtp:97 apt=96
a=rtpmap:98 VP9/90000
a=fmtp:98 profile-id=0
a=rtpmap:99 rtx/90000
a=fmtp:99 apt=98
a=rid:q send
a=rid:h send
a=rid:f send
a=simulcast:send q;h;f`;

function parseSdp(text) {
  const lines = text.split(/\r?\n/);
  const session = { media: [] };
  let current = session;
  for (const line of lines) {
    const [type, value] = [line[0], line.slice(2)];
    if (type === 'm') {
      const [kind, port, proto, ...pts] = value.split(' ');
      current = { kind, proto, payloadTypes: pts.map(Number), codecs: {}, feedback: {}, rids: [] };
      session.media.push(current);
    } else if (type === 'a') {
      const [attr, ...rest] = value.split(':');
      const v = rest.join(':');
      if (attr === 'rtpmap') {
        const [pt, codec] = v.split(' ');
        current.codecs[pt] = codec;
      } else if (attr === 'rtcp-fb') {
        const [pt, ...fb] = v.split(' ');
        (current.feedback[pt] ??= []).push(fb.join(' '));
      } else if (attr === 'rid') current.rids.push(v.split(' ')[0]);
      else if (['mid', 'setup', 'ice-ufrag', 'fingerprint', 'group'].includes(attr)) current[attr] = v;
      else if (['sendrecv', 'sendonly', 'recvonly', 'inactive'].includes(attr)) current.direction = attr;
    }
  }
  return session;
}

const parsed = parseSdp(sdp);
for (const m of parsed.media) {
  const primary = m.payloadTypes.map((pt) => m.codecs[pt]).filter((c) => !/^(rtx|red)\//.test(c));
  console.log(`${m.kind} mid=${m.mid} ${m.direction}: codecs in preference order -> ${primary.join(', ')}${m.rids.length ? ` | simulcast rids: ${m.rids.join(',')}` : ''}`);
}

test('extracts codecs, BUNDLE and simulcast', () => {
  expect(parsed.group).toBe('BUNDLE 0 1');
  expect(parsed.media[0].codecs['111']).toBe('opus/48000/2');
  expect(parsed.media[1].feedback['96']).toEqual(['nack', 'nack pli', 'transport-cc']);
  expect(parsed.media[1].rids).toEqual(['q', 'h', 'f']);
});
```

## Connectivity: ICE, STUN, TURN, NAT

### Explain ICE, STUN and TURN 🔥

Most devices sit behind **NATs and firewalls** and don't know their public address. **ICE** (Interactive Connectivity Establishment, RFC 8445) finds a working network path.

1. **Gather candidates** (possible addresses):
   - **host:** local interface IPs (in browsers, often obfuscated as **mDNS** `.local` names for privacy)
   - **srflx (server-reflexive):** your **public IP:port as seen by a STUN server**
   - **relay:** an address allocated on a **TURN server**, which relays your media
   - **prflx (peer-reflexive):** discovered during connectivity checks
2. **Exchange** candidates through signalling (trickle ICE sends them as they're found).
3. **Connectivity checks:** form candidate **pairs** ordered by priority and send **STUN binding requests** on each. The controlling agent **nominates** the best working pair.
4. **Keepalives** (consent freshness) every few seconds. Failure triggers `disconnected`/`failed` states. Recover with an **ICE restart** (`pc.restartIce()` or `createOffer({ iceRestart: true })`), for example after a Wi-Fi → 4G switch.

**STUN** (Session Traversal Utilities for NAT): a lightweight server that tells a client its public address. It's cheap, because **media doesn't go through it**.

**TURN** (Traversal Using Relays around NAT): a **media relay**. It's used when direct paths fail: **symmetric NATs**, firewalls that **block UDP** (corporate networks), and some carrier-grade NATs.

- **TURN over TCP and TLS on port 443** gets through restrictive firewalls (`turns:` URLs).
- It's **expensive**, because all media bandwidth passes through your server.
- **coturn** is the standard open-source server.
- Typically **10–20% of calls need TURN**, more in enterprise networks.

**For an SFU like the JVB:** the bridge has a **public IP**, so clients usually connect directly over UDP 10000. TURN (or TCP fallback) is still needed for clients on networks that block UDP.

### What are the NAT types and why do symmetric NATs need TURN?

| NAT type | Mapping behaviour | Direct connection possible? |
|---|---|---|
| Full cone | One public `ip:port` for an internal socket; **anyone** can send to it | Easy |
| (Address-)restricted cone | Same mapping, but only hosts you've sent to can reply | With hole punching |
| Port-restricted cone | Only the exact `ip:port` you've sent to can reply | With hole punching |
| **Symmetric** | A **different public port for each destination** | **Usually no**: the port STUN observed isn't the port the peer will see, so you need **TURN** |

**Hole punching:** both peers send packets to each other's reflexive addresses at about the same time, creating NAT mappings that allow the inbound packets.

### Parse an ICE candidate and explain candidate priority

The priority formula from RFC 8445:

`priority = 2^24 × typePreference + 2^8 × localPreference + (256 − componentId)`

Recommended type preferences are **host 126, prflx 110, srflx 100, relay 0**. Higher priority pairs are checked first, which is why direct paths beat TURN relays when both work.

```js
function parseCandidate(line) {
  const parts = line.replace(/^a=/, '').replace(/^candidate:/, '').split(' ');
  const [foundation, component, protocol, priority, address, port, , type] = parts;
  const extras = {};
  for (let i = 8; i < parts.length; i += 2) extras[parts[i]] = parts[i + 1];
  const p = Number(priority);
  return {
    foundation, component: Number(component), protocol: protocol.toLowerCase(), address, port: Number(port), type,
    typePreference: Math.floor(p / 2 ** 24),
    localPreference: Math.floor((p % 2 ** 24) / 2 ** 8),
    relatedAddress: extras.raddr, tcpType: extras.tcptype,
  };
}

const priority = (typePref, localPref, componentId) => 2 ** 24 * typePref + 2 ** 8 * localPref + (256 - componentId);

const candidates = [
  'candidate:842163049 1 udp 1677729535 203.0.113.7 54321 typ srflx raddr 192.168.1.10 rport 54321 generation 0',
  'candidate:1467250027 1 udp 2122260223 192.168.1.10 54321 typ host generation 0',
  'candidate:3745712436 1 udp 41885439 198.51.100.20 61234 typ relay raddr 203.0.113.7 rport 54321 generation 0',
].map(parseCandidate);

console.table(candidates.map(({ type, protocol, address, port, typePreference, localPreference }) => ({ type, protocol, address, port, typePreference, localPreference })));
console.log('host candidate priority for local pref 65535:', priority(126, 65535, 1));

test('candidate parsing and priority', () => {
  expect(candidates[0]).toMatchObject({ type: 'srflx', typePreference: 100, relatedAddress: '192.168.1.10' });
  expect(priority(126, 65535, 1)).toBe(2130706431);   // the classic max host priority
  expect([...candidates].sort((a, b) => b.typePreference - a.typePreference).map((c) => c.type)).toEqual(['host', 'srflx', 'relay']);
});
```

### How do you issue TURN credentials securely? 🔥

**Never hard-code a static TURN username and password in the frontend.** Anyone could use your relay and run up your bandwidth bill. Use **time-limited credentials** (the TURN REST API pattern, supported by coturn's `use-auth-secret`):

- The **backend** shares a secret with the TURN server.
- For each user session, it returns `username = "<expiryUnixTime>:<userId>"` and `credential = base64(HMAC-SHA1(secret, username))`.
- The TURN server recomputes the HMAC and rejects the credentials after the expiry time.
- **Short TTLs** (e.g. 24 h or less), served only to authenticated users.

```js
// Server-side logic shown with Web Crypto (works in browsers, workers and Node 18+)
async function turnCredentials(secret, userId, ttlSeconds, nowSeconds = Math.floor(Date.now() / 1000)) {
  const username = `${nowSeconds + ttlSeconds}:${userId}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username));
  const credential = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return { urls: ['turn:turn.example.com:3478?transport=udp', 'turns:turn.example.com:443?transport=tcp'], username, credential };
}

const creds = await turnCredentials('north-pole-secret', 'zaki', 86400, 1767139200);
console.log(creds);

test('matches the coturn REST-API scheme', () => {
  expect(creds.username).toBe('1767225600:zaki');
  expect(creds.credential).toBe('jN9mTcwxrHoRtTg4//0HzMZf80A=');
});
```

## Security & media transport

### How is WebRTC media secured? What is DTLS-SRTP? 🔥

- **Encryption is mandatory.** Unencrypted RTP isn't allowed in WebRTC.
- **DTLS** (TLS over UDP) runs over the ICE-selected path. Each peer has a (usually self-signed) certificate, and its **fingerprint is in the SDP**. During the handshake, each side checks that the peer's certificate matches the signalled fingerprint. **The trust anchor is therefore the signalling channel**, which must be secured (HTTPS/WSS plus authentication).
- **SRTP keys** are **derived from the DTLS handshake** (DTLS-SRTP, RFC 5764). Media is encrypted with SRTP (AES), and data channels use **SCTP over DTLS**.
- **With an SFU**, encryption is **hop-by-hop**: client ↔ SFU. The SFU **decrypts** packets to route them (it reads RTP headers and could access the media). For **end-to-end encryption** through an SFU, use **Insertable Streams / Encoded Transform** (`RTCRtpScriptTransform`) to encrypt frame payloads with keys the SFU never sees (SFrame-style). Jitsi supports E2EE this way, with key exchange through Olm.
- **Other protections:**
  - browser permission prompts for camera, mic and screen
  - an indicator while capturing
  - mDNS candidates hide local IPs
  - **consent freshness** checks prevent a peer from being used to flood a victim

### Explain RTP and RTCP. What are NACK, PLI, FIR, FEC and RTX? 🔥

**RTP** carries media in packets. Each packet has:

- a **payload type** (codec)
- a **sequence number** (to detect loss and reordering)
- a **timestamp** (media clock: 90 kHz for video, 48 kHz for Opus)
- an **SSRC** (stream identifier)
- a marker bit (end of a frame)
- header extensions

**RTCP** is the control protocol alongside RTP:

- **Sender/Receiver Reports** (SR/RR): packet counts, loss fraction, jitter, timing for RTT and lip-sync.
- **Feedback messages:**
  - **NACK:** "I'm missing packets 1234–1236". The sender retransmits, usually through a separate **RTX** stream (its own SSRC and payload type), so the stats stay clean.
  - **PLI** (Picture Loss Indication) / **FIR** (Full Intra Request): "send me a **keyframe**". Used when decoding broke, when a new receiver joins, or when an SFU **switches simulcast layers**.
  - **REMB** (legacy, receiver-side bandwidth estimate) and **Transport-CC feedback** (TWCC: per-packet arrival times for sender-side estimation).
- **FEC** (Forward Error Correction) sends **redundant data** so the receiver can **recover losses without a retransmission round trip**:
  - for audio: **Opus in-band FEC** and **RED** (redundant encoding)
  - for video: ULPFEC or FlexFEC
  - it trades bandwidth for resilience and suits high-RTT links where NACK is too slow
- **Jitter buffer:** the receiver buffers packets to smooth out arrival variation. That's a latency vs smoothness trade-off, which NetEQ manages adaptively for audio.

### How does congestion control / bandwidth estimation work in WebRTC? 🔥

- WebRTC must adapt the bitrate continuously to the available bandwidth, or packets queue up (latency rises) and get dropped.
- **GCC (Google Congestion Control)**, as used in libwebrtc, combines:
  - a **delay-based** estimator: rising **one-way delay variation** signals queues building up, so back off early, **before** loss happens
  - a **loss-based** estimator: lose more than 10% and you decrease; under 2% you can increase
- **Transport-wide congestion control (TWCC):** the receiver reports per-packet arrival times for **all streams on the transport**. The **sender** computes the estimate (sender-side BWE), which is more accurate than the older receiver-side **REMB**.
- The result (`availableOutgoingBitrate` in stats) feeds the **encoder target bitrate**, **simulcast layer activation** (high layers are disabled when bandwidth is low) and the **pacer** (which smooths out packet bursts).
- **SFUs run their own BWE per receiver** and choose which layers to forward. Jitsi's JVB does exactly this, combined with last-N and receiver constraints.
- **`qualityLimitationReason`** in outbound stats (`bandwidth` / `cpu` / `none`) tells you **why** the resolution dropped. That's very useful for support tickets.

### Which codecs does WebRTC use? Compare VP8, VP9, H.264 and AV1 🔥

| Codec | Notes |
|---|---|
| **Opus** (audio) | **The** WebRTC audio codec: 6–510 kbps, adaptive, speech and music, **in-band FEC**, **DTX** (silence suppression), stereo. G.711 (PCMU/PCMA) for legacy and SIP interop |
| **VP8** | Mandatory to implement; widely supported; **simulcast** support; software encoding (CPU) |
| **H.264** | Mandatory to implement; **hardware encode/decode** on most devices (battery-friendly), great for Safari/iOS; profile negotiation (`profile-level-id`) can be tricky; simulcast supported |
| **VP9** | About 30–40% better compression than VP8; **SVC** (spatial and temporal layers in one stream), loved by SFUs; higher CPU; hardware support varies |
| **AV1** | The best compression (especially for screen content), **SVC**, royalty-free; **CPU heavy** without hardware support; increasingly used for screen share and low bandwidth |

**Negotiation:** the order of payload types in the `m=` line is the preference order. Change it with **`transceiver.setCodecPreferences(codecs)`**; don't munge SDP. With an SFU, every receiver must support the sender's codec. Jitsi supports **codec selection per endpoint** and can fall back.

### Simulcast vs SVC: what's the difference? 🔥

- **Simulcast:** the sender encodes **independent streams at different resolutions/bitrates** (e.g. 180p/360p/720p, identified by `rid`s or SSRCs). The SFU forwards **one** of them to each receiver. Works with VP8 and H.264. Costs **more uplink and CPU** (three encodes).
- **SVC (Scalable Video Coding):** **one stream** with **layers**:
  - **temporal layers** (L1T3: drop frames for a lower frame rate)
  - **spatial layers** (L3T3: base resolution plus enhancement layers)
  
  The SFU **drops layers** per receiver. More uplink-efficient, and switching between layers needs no keyframe. VP9 and AV1 support it. Configure it with `sendEncodings: [{ scalabilityMode: 'L3T3_KEY' }]`.
- **Both** let an SFU serve heterogeneous receivers (a phone on 3G alongside a desktop on fibre) **without transcoding**.

```node
// Simulcast with three rid-based encodings (Unified Plan)
pc.addTransceiver(cameraTrack, {
  direction: 'sendonly',
  sendEncodings: [
    { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: 150_000 },
    { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: 500_000 },
    { rid: 'f', maxBitrate: 1_500_000 },
  ],
});

// Later: cap bandwidth without renegotiation
const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
const params = sender.getParameters();
params.encodings[2].active = false;          // stop sending the high layer (e.g. nobody views it in HD)
await sender.setParameters(params);
```

## Media handling in the browser

### How do you switch camera or microphone mid-call without renegotiating? 🔥

Use **`RTCRtpSender.replaceTrack(newTrack)`**. It swaps the source track in place, with **no SDP renegotiation**, as long as the new track is compatible (same kind, and the codec is already negotiated).

```node
async function switchCamera(pc, deviceId) {
  const newStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } });
  const [newTrack] = newStream.getVideoTracks();
  const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
  const oldTrack = sender.track;
  await sender.replaceTrack(newTrack);
  oldTrack?.stop();                          // release the old camera (turns its light off)
  localVideo.srcObject = newStream;
}
navigator.mediaDevices.addEventListener('devicechange', refreshDeviceList); // headset plugged in/out
```

**Mute options:**

- `track.enabled = false` → sends **black frames or silence**. Instant to unmute, but the **camera light stays on**.
- **`replaceTrack(null)`** + `track.stop()` → stops sending and releases the device (the light goes off). Unmuting needs `getUserMedia` again.
- Jitsi also signals the mute state in presence so others show the muted icon, and the SFU stops forwarding.

### What are the important `getUserMedia` constraints and audio processing options?

- **Constraints:** `{ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { max: 30 }, facingMode: 'user', deviceId: { exact: id } } }`.
  - `ideal` is a preference. `exact`/`min`/`max` are hard requirements: if they can't be met, you get an **`OverconstrainedError`**.
  - Inspect results with `track.getSettings()` and `getCapabilities()`. Adjust later with `track.applyConstraints()`.
- **Audio processing:** `echoCancellation`, `noiseSuppression` and `autoGainControl` are on by default for voice. **Turn them off** for music or high-fidelity scenarios (also set stereo Opus and a higher bitrate).
- **Errors to handle:**
  - `NotAllowedError` (the user or a policy denied it)
  - `NotFoundError` (no device)
  - `NotReadableError` (the device is used by another app, a common Windows issue)
  - `OverconstrainedError`
  - `SecurityError` (not HTTPS)
- **Permissions:** `navigator.permissions.query({ name: 'camera' })` to show good pre-join UI. Labels from `enumerateDevices` are empty until permission is granted.

### How does screen sharing work with `getDisplayMedia`?

- `navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: true })` must be called from a **user gesture**. The browser shows its own picker (screen, window or tab). Electron requires your own picker (see the Electron doc).
- **Options:** `preferCurrentTab`, `selfBrowserSurface`, `surfaceSwitching`, `systemAudio` (Chromium), `monitorTypeSurfaces`. **Tab audio** is widely supported; **system audio** is mostly Windows/ChromeOS.
- **Encoding hints:**
  - `track.contentHint = 'detail'` (or `'text'`) prioritises **sharpness over frame rate**, which is right for slides and code.
  - Use `'motion'` for video playback.
  - Screen share is typically high resolution and low FPS (5–15).
- **The `ended` event** fires when the user clicks the browser's "Stop sharing" button. Handle it to update the UI and signalling.
- **With multi-stream** (Jitsi), screen share is a **second video source** alongside the camera.

### What can you do with Insertable Streams / Encoded Transform and breakout box?

- **Encoded Transform** (`RTCRtpScriptTransform`; older Chromium used `createEncodedStreams()`) gives access to **encoded frames** before they're packetised (sender) or after depacketisation (receiver), in a **worker**. Uses:
  - **end-to-end encryption** (encrypt the payload, keep codec headers intact for the SFU)
  - adding metadata
  - custom FEC
- **Breakout box** (`MediaStreamTrackProcessor` / `MediaStreamTrackGenerator`, a Chromium API) gives access to **raw `VideoFrame`s and `AudioData`** as streams. Uses:
  - **virtual backgrounds**, blur, overlays and noise suppression without canvas round trips
  - combined with **WebCodecs** and **WebGPU/WebGL** for efficient pipelines
- These APIs are how modern conferencing apps do effects and E2EE efficiently (see virtual background in the MeetHour doc).

### What are data channels and how do you use them well? 🔥

- `pc.createDataChannel('chat', { ordered: true })`. The remote side gets the `datachannel` event. Transport is **SCTP over DTLS over ICE**, so data channels are **encrypted** and **congestion-controlled**.
- **Reliability modes:**
  - reliable + ordered (the default, like TCP)
  - **unordered**
  - **partially reliable**: `maxRetransmits: 0` or `maxPacketLifeTime: 100` for real-time state such as cursor positions or game state, where stale data is useless
- **Message size:** keep messages small (around 16 KB is the most interoperable; up to roughly 256 KB works in modern browsers). **Chunk** files.
- **Backpressure:** check `channel.bufferedAmount` and use `bufferedAmountLowThreshold` + `onbufferedamountlow` to pause and resume sending. This prevents memory blow-ups during file transfer.
- **Uses:**
  - chat, file transfer, whiteboard and annotation events, game state, remote control
  - in Jitsi, the **bridge channel** to the JVB for dominant speaker and constraints

```js
// Chunk a large payload and respect backpressure (simulated channel so it runs anywhere)
async function sendChunked(channel, bytes, chunkSize = 16 * 1024) {
  channel.bufferedAmountLowThreshold = 64 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    if (channel.bufferedAmount > 256 * 1024) {
      await new Promise((resolve) => channel.addEventListener('bufferedamountlow', resolve, { once: true }));
    }
    channel.send(bytes.subarray(offset, offset + chunkSize));
  }
  channel.send(JSON.stringify({ done: true, size: bytes.length }));
}

class FakeChannel extends EventTarget {
  bufferedAmount = 0;
  sent = 0;
  waits = 0;
  send(data) {
    this.sent++;
    this.bufferedAmount += data.length ?? data.byteLength;
    if (this.bufferedAmount > 256 * 1024) {
      this.waits++;
      setTimeout(() => { this.bufferedAmount = 0; this.dispatchEvent(new Event('bufferedamountlow')); }, 5); // network drains
    }
  }
}

const channel = new FakeChannel();
await sendChunked(channel, new Uint8Array(1024 * 1024));          // 1 MB
console.log(`sent ${channel.sent} messages, paused ${channel.waits} times for backpressure`);

test('1 MB is sent as 64 chunks plus a done message', () => {
  expect(channel.sent).toBe(65);
  expect(channel.waits).toBeGreaterThan(0);
});
```

### What is the "perfect negotiation" pattern? 🔥

**Renegotiation** happens when tracks are added or removed, codecs change or ICE restarts. Both peers might create offers at the same time (**glare**). **Perfect negotiation** (W3C pattern) makes this robust:

- One peer is **polite** and the other **impolite** (decided by signalling, e.g. who joined first).
- `onnegotiationneeded`: `await pc.setLocalDescription()` (implicit offer) and send it.
- On receiving an offer while we have our own offer pending (a **collision**):
  - The **impolite** peer **ignores** the incoming offer.
  - The **polite** peer **rolls back** its own offer (`setRemoteDescription` performs an implicit rollback) and accepts theirs.
- Use the same code on both sides. This avoids `InvalidStateError`s in complex apps.

```node
let makingOffer = false;
let ignoreOffer = false;
pc.onnegotiationneeded = async () => {
  try {
    makingOffer = true;
    await pc.setLocalDescription();                 // creates the right offer automatically
    signal.send({ description: pc.localDescription });
  } finally {
    makingOffer = false;
  }
};

signal.onmessage = async ({ description, candidate }) => {
  if (description) {
    const collision = description.type === 'offer' && (makingOffer || pc.signalingState !== 'stable');
    ignoreOffer = !polite && collision;
    if (ignoreOffer) return;                        // impolite peer ignores the colliding offer
    await pc.setRemoteDescription(description);     // polite peer: implicit rollback
    if (description.type === 'offer') {
      await pc.setLocalDescription();               // answer
      signal.send({ description: pc.localDescription });
    }
  } else if (candidate) {
    await pc.addIceCandidate(candidate).catch((e) => { if (!ignoreOffer) throw e; });
  }
};
```

## Stats, debugging & quality

### Which `getStats()` metrics matter and how do you compute bitrate and packet loss? 🔥

`pc.getStats()` returns an `RTCStatsReport` (a map of stats objects by type):

| Type | Key fields |
|---|---|
| `outbound-rtp` | `bytesSent`, `packetsSent`, `framesEncoded`, `frameWidth`/`frameHeight`, `framesPerSecond`, **`qualityLimitationReason`**, `nackCount`, `pliCount`, `retransmittedBytesSent`, `rid` |
| `inbound-rtp` | `bytesReceived`, **`packetsLost`**, `packetsReceived`, **`jitter`**, `framesDecoded`, **`framesDropped`**, `freezeCount`, `totalFreezesDuration`, `jitterBufferDelay`/`jitterBufferEmittedCount`, `concealedSamples` (audio) |
| `remote-inbound-rtp` | The remote side's view of what you sent: `roundTripTime`, `fractionLost`, `packetsLost` |
| `candidate-pair` (selected) | **`currentRoundTripTime`**, **`availableOutgoingBitrate`**, `bytesSent/Received` |
| `local-candidate` / `remote-candidate` | `candidateType` (host/srflx/relay: are we on TURN?), `protocol` (udp/tcp) |
| `transport` | `dtlsState`, `selectedCandidatePairId` |

**Counters are cumulative**, so compute **rates from the deltas between two snapshots**:

```js
function computeQuality(prev, curr) {
  const dtMs = curr.timestamp - prev.timestamp;
  const kbps = (bytes) => Math.round((bytes * 8) / dtMs);                 // bits per ms == kbit/s
  const lost = curr.packetsLost - prev.packetsLost;
  const received = curr.packetsReceived - prev.packetsReceived;
  const lossPct = lost + received > 0 ? (lost / (lost + received)) * 100 : 0;
  const avgJitterBufferMs = ((curr.jitterBufferDelay - prev.jitterBufferDelay) / (curr.jitterBufferEmittedCount - prev.jitterBufferEmittedCount)) * 1000;
  const verdict = lossPct > 5 || curr.rttMs > 400 ? 'poor' : lossPct > 2 || curr.rttMs > 250 ? 'fair' : 'good';
  return { inboundKbps: kbps(curr.bytesReceived - prev.bytesReceived), lossPct: +lossPct.toFixed(1), jitterMs: Math.round(curr.jitter * 1000), avgJitterBufferMs: Math.round(avgJitterBufferMs), rttMs: curr.rttMs, verdict };
}

// two inbound-rtp video snapshots taken 1 second apart (plus RTT from the candidate pair)
const t0 = { timestamp: 10_000, bytesReceived: 4_000_000, packetsReceived: 5_000, packetsLost: 20, jitter: 0.012, jitterBufferDelay: 120, jitterBufferEmittedCount: 3000, rttMs: 80 };
const t1 = { timestamp: 11_000, bytesReceived: 4_187_500, packetsReceived: 5_190, packetsLost: 30, jitter: 0.018, jitterBufferDelay: 122.4, jitterBufferEmittedCount: 3030, rttMs: 95 };

const q = computeQuality(t0, t1);
console.log(q);

test('bitrate, loss and jitter buffer from deltas', () => {
  expect(q.inboundKbps).toBe(1500);
  expect(q.lossPct).toBe(5);
  expect(q.avgJitterBufferMs).toBe(80);
  expect(q.verdict).toBe('fair');
});
```

These numbers drive the **connection quality indicator** in a conferencing UI (Jitsi shows one per participant) and help support staff diagnose problems.

### How do you debug a WebRTC call that won't connect or has bad quality? 🔥

**Tools:**

- **`chrome://webrtc-internals`**: every PeerConnection's API calls, SDPs, ICE candidates and state changes, and **live graphs** of stats. You can **download a dump** and ask users to send it.
- **`about:webrtc`** in Firefox.
- The **Trickle ICE test page** (webrtc.github.io samples) to check STUN/TURN servers.
- Server logs (Jicofo, JVB, TURN), and **rtcstats** or callstats-style telemetry.

**Connection failures (ICE `failed`):**

1. Are candidates being gathered? No srflx means STUN is unreachable. No relay means TURN is misconfigured or the credentials are wrong.
2. Were candidates exchanged through signalling? Check the timing of `addIceCandidate` before or after `setRemoteDescription`.
3. Firewall: UDP blocked means you need **TURN TCP/TLS on 443**. For an SFU, check that the media port (UDP 10000) is open and that the advertised public IP is correct (a classic JVB problem when it runs behind NAT).
4. Did DTLS fail? Look for a fingerprint mismatch or SDP munging mistakes.

**Quality problems:**

| Symptom | Likely cause | Stats to check |
|---|---|---|
| Low resolution / blurry | Bandwidth or **CPU** limitation | `qualityLimitationReason`, `availableOutgoingBitrate`, encoder FPS |
| Freezes | Packet loss, missing keyframes | `freezeCount`, `pliCount`, `packetsLost`, NACK counts |
| Robotic audio | Loss and jitter, concealment | `concealedSamples`, `jitter`, `jitterBufferDelay` |
| High latency | TURN relay far away, bufferbloat | `currentRoundTripTime`, candidate type (`relay`?) |
| Echo | AEC disabled or broken (often external speakers, Electron audio routing) | Device settings, `echoCancellation` |

### WebRTC vs WebSockets vs HLS/DASH vs WebTransport: when do you use which?

| Technology | Latency | Transport | Use |
|---|---|---|---|
| **WebRTC** | **< 500 ms** (often 100–300 ms) | UDP (SRTP/SCTP), congestion control, NAT traversal | Interactive calls, Visitor-mode audiences that need near-real-time, cloud gaming |
| **WebSocket** | Low (TCP, so head-of-line blocking) | TCP | **Signalling**, chat, notifications, collaboration events; not media |
| **HLS / DASH** | 6–30 s (LL-HLS about 2–5 s) | HTTP via CDN | Massive one-to-many broadcast (Jibri → RTMP → YouTube/CDN) |
| **WebTransport** (HTTP/3, QUIC) | Low, with datagrams and streams | QUIC (UDP) | Emerging: client-server real-time data and media (**Media over QUIC**, MoQ) with CDN-friendly fan-out |
| **WHIP / WHEP** | WebRTC latency | HTTP-based signalling for WebRTC ingest/egress | Standard way to push/pull WebRTC streams to and from media servers and CDNs (OBS supports WHIP) |

### How do autoplay policies affect conferencing apps?

- Browsers block **audible autoplay** without a **user gesture**. Muted autoplay is allowed.
- **Remote audio** might not play if the user hasn't interacted with the page, e.g. when joining through a link that auto-joins.
- **Fixes:**
  - a **pre-join screen** where the user clicks "Join" (a user gesture)
  - set `autoplay playsInline` on `<video>`. **`muted` on the local preview** prevents echo.
  - catch the `play()` promise rejection and show a "Click to enable audio" banner
- **iOS Safari quirks:**
  - `playsinline` is required, or video goes fullscreen
  - audio output device selection (`setSinkId`) is limited
  - only one capture session per app
  - background tabs stop the camera
