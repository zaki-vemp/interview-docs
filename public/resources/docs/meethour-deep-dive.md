# MeetHour Project Deep Dive

MeetHour is your strongest differentiator: very few frontend candidates have shipped WebRTC conferencing features across the web app, the Electron desktop app, Prosody and Jibri. Expect an interviewer to spend **20–40 minutes** here. They will start broad ("explain the architecture") and keep drilling down until you reach the edge of your knowledge.

> **Accuracy note:** the architecture below describes the open-source Jitsi stack that MeetHour builds on. Where MeetHour's own implementation may differ (custom services, exact numbers, which component you changed), answers say *"adapt to your implementation"* or use *[brackets]*. Fill those in **My notes** with what you actually built, because interviewers can tell when someone describes a design they didn't implement.

## Architecture fundamentals

### Explain the overall architecture of MeetHour / a Jitsi-based platform 🔥

Draw this on the whiteboard. It's the anchor for every other question.

```text
                    ┌──────────────────────────────────────────────┐
  Browser / Electron│  React app (jitsi-meet)  +  lib-jitsi-meet    │
  / React Native    │  Redux state, UI, WebRTC (RTCPeerConnection)  │
                    └──────┬───────────────────────────┬────────────┘
             XMPP signalling (WebSocket /xmpp-websocket │ media: SRTP over UDP 10000
             or BOSH /http-bind)                        │ (TCP/TURN fallback)
                    ┌──────▼───────┐            ┌───────▼─────────┐
                    │   Prosody    │◄──XMPP────►│      JVB        │  SFU: forwards
                    │ (XMPP server)│            │ Jitsi Videobridge│  RTP, simulcast,
                    └──┬────────┬──┘            └───────▲─────────┘  last-N, BWE
                       │        │                       │ Colibri2 (allocate endpoints)
                 ┌─────▼──┐  ┌──▼─────┐          ┌──────┴──────┐
                 │ Jibri  │  │ Jigasi │          │   Jicofo    │  conference focus:
                 │recorder│  │ SIP gw │◄────────►│ (Kotlin/Java)│  Jingle, bridge &
                 └────────┘  └────────┘  XMPP    └─────────────┘  Jibri selection
```

**Talking points, in order:**

1. **Client:** the React app (`jitsi-meet`) handles UI and Redux state. `lib-jitsi-meet` is the low-level JS library that wraps XMPP signalling (Strophe.js) and WebRTC (`RTCPeerConnection`, tracks, stats).
2. **Prosody** is the XMPP server and the signalling backbone. Every participant is an XMPP client, and every meeting is a **MUC room** (Multi-User Chat, XEP-0045). Presence in the room carries participant state such as display name, mute status and role.
3. **Jicofo** (JItsi COnference FOcus) joins every room as the special *focus* participant and owns the conference. It selects a videobridge, allocates media resources on it via **Colibri2**, and negotiates a **Jingle** session with each participant. Jicofo sends the offer; the client answers.
4. **JVB** (Jitsi Videobridge) is an **SFU** (Selective Forwarding Unit). It receives each participant's RTP streams once and forwards them selectively. It never mixes or transcodes. This is what makes 50-person calls feasible.
5. **Jibri** (JItsi BRoadcasting Infrastructure) records or live-streams. It runs a real Chrome in a virtual display, joins the meeting as a hidden participant, and captures screen and audio with **ffmpeg**.
6. **Jigasi** is the SIP gateway (dial-in/out) and can also do transcription.

**Closing line:** "So the signalling plane is XMPP through Prosody, the control plane is Jicofo, and the media plane is the JVB. My work touched all three: React and lib-jitsi-meet on the client, Prosody for signalling and permissions, and Jibri for recording."

### Walk me through what happens when a participant joins a meeting 🔥

This is the most common deep-dive question for anyone with Jitsi on their resume.

1. **Load and configure.** The browser loads the app and its `config.js`/`interface_config.js`, or the MeetHour equivalent.
2. **XMPP connection.** `JitsiConnection` connects to Prosody over **WebSocket** (`wss://host/xmpp-websocket`) or, for legacy setups, **BOSH** (`/http-bind`). It authenticates either anonymously or with a **JWT** (`?jwt=…`, validated by Prosody's token auth module).
3. **Conference request.** The client sends a `<conference/>` IQ to the focus component (`focus.<domain>`). If the room is new, Jicofo creates its conference state and joins the MUC as **owner**.
4. **Join the MUC.** The client sends presence to `room@conference.<domain>/<nick>`. The presence includes extensions: display name, `stats-id`, audio/video muted flags, codec preferences, avatar, and custom fields such as role or visitor flag.
5. **Bridge selection and allocation.** Jicofo chooses a JVB. It reads bridges' presence in the JVB brewery room, which reports stress level and region. It then sends a **Colibri2 `conference-modify`** request to allocate an *endpoint* for the participant (ICE ufrag/pwd, candidates, DTLS fingerprint).
6. **Jingle offer.** Jicofo sends a Jingle `session-initiate` to the participant. It contains the bridge's transport (ICE candidates, DTLS fingerprint) and the **sources** (SSRCs, source names) of everyone already in the call. lib-jitsi-meet converts this to SDP and calls `setRemoteDescription`.
7. **Answer.** The client creates an answer, converts it back to Jingle `session-accept` (its own SSRCs/sources), and sends it to Jicofo. Jicofo updates the bridge and sends `source-add` to all other participants so they learn about the newcomer's streams.
8. **Media.** ICE connectivity checks run against the JVB (usually UDP port 10000; TCP or TURN as fallback). Then the DTLS handshake runs and SRTP keys are derived, and media flows.
9. **Bridge channel.** The client opens a bridge channel (a WebSocket to the JVB, `colibri-ws`, or an SCTP data channel). It carries dominant-speaker events, **receiver video constraints** (which streams at what resolution), last-N and endpoint stats.
10. **P2P optimisation.** With exactly two participants, Jitsi can switch to a **direct P2P connection** that bypasses the bridge for lower latency. It moves back to the JVB when a third person joins.

**Follow-up:** *"Why does Jicofo send the offer instead of the client?"* Because the focus knows the full picture (bridge transport and all existing sources), and keeping one offerer avoids glare. The client is always the answerer for the JVB session.

### What is an SFU and why do Jitsi/MeetHour use one instead of mesh or MCU? 🔥

| Topology | How it works | Upload per client | Server CPU | Good for |
|---|---|---|---|---|
| **Mesh (P2P)** | Every client sends to every other | N−1 streams | none | 2–4 people |
| **SFU** | Each client uploads once; server *forwards* | 1 stream (or simulcast layers) | low (no transcoding) | 3–100+ interactive |
| **MCU** | Server decodes, *mixes*, re-encodes one composite | 1 stream | very high | legacy/SIP, very weak clients |

An SFU wins for interactive meetings because:

- clients upload once
- the server does no transcoding, so it's cheap and adds little latency
- each receiver can get a **different quality per stream**, using simulcast or SVC layer selection

The trade-off is **download**: each client receives multiple streams. The JVB manages this with **last-N** (forward only the N most recent speakers' video), **receiver constraints** (send the thumbnail layer for small tiles) and **bandwidth estimation**.

### How does simulcast work with the JVB?

- The sender encodes the **same camera at 3 resolutions/bitrates** (for example 180p, 360p, 720p) as separate RTP encodings (`sendEncodings` with `rid`s or SSRC groups).
- The bridge receives all three and, **per receiver**, forwards only one layer. The choice depends on that receiver's available bandwidth (estimated with transport-wide congestion control feedback) and the constraints the receiver sent ("I'm showing this person at 180p").
- Layer switches happen on **keyframes**. The bridge rewrites SSRCs, sequence numbers and timestamps so the receiver sees one continuous stream.
- With **VP9/AV1 SVC**, there is one stream with spatial and temporal layers, and the bridge drops layers instead of switching streams. That's more efficient on the uplink.

### What is Colibri and what replaced it?

**Colibri** (COnferences with LIghtweight BRIdging) is the protocol Jicofo uses to allocate resources on the videobridge. The original Colibri used XMPP IQs describing *channels* per media type. **Colibri2** replaced it with an endpoint-centric model (`conference-modify` IQs that create, update or expire *endpoints* and their transports and sources). It also supports **relays** between bridges for cascading. **Colibri WebSockets** (`colibri-ws`) is the separate bridge channel between client and JVB for real-time messages.

## Multi-Jibri recording & live streaming

### How does Jibri work? 🔥

1. Each Jibri instance (a Java service) connects to Prosody and **joins a "brewery" MUC**, a control room on the internal MUC domain such as `JibriBrewery@internal.auth.<domain>` or `jibribrewery@internal-muc.<domain>` in Docker setups. In its presence it advertises its status (`idle` or `busy`) and health.
2. Jicofo watches the brewery. When a moderator clicks *Start recording*, the client sends a **Jibri IQ** to the focus, e.g. `<jibri action="start" recording_mode="file"/>` or `recording_mode="stream" streamid="<rtmp key>"`.
3. Jicofo picks an **idle** Jibri and forwards the start request, including the room name and credentials for the hidden **recorder domain**, so Jibri doesn't appear as a normal participant.
4. Jibri launches **Chrome via Selenium/ChromeDriver** in a virtual X display (**Xvfb**) and loads the meeting URL. Audio goes to an **ALSA loopback device** (`snd-aloop` kernel module).
5. **ffmpeg** captures the display (`x11grab`) and the loopback audio, encodes **H.264 + AAC**, and either writes an MP4 file or pushes **RTMP/FLV** to YouTube or another endpoint.
6. Jibri reports status back. Jicofo publishes the recording status in the room (a `jibri-recording-status` presence extension) so every client can show the "Recording" indicator.
7. On stop, a **finalize script** runs. Typically it uploads the file to S3 or other storage and notifies the backend so the recording appears in the user's dashboard.

Simplified version of what ffmpeg is doing:

```bash
ffmpeg -f x11grab -draw_mouse 0 -r 30 -s 1280x720 -i :0.0+0,0 \
       -f alsa -i plug:bsnoop \
       -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p -g 60 -maxrate 2976k -bufsize 5952k \
       -c:a aac -b:a 128k -ar 44100 \
       -f flv rtmp://a.rtmp.youtube.com/live2/<stream-key>
```

**Key insight for interviews:** Jibri is a *headless participant*. It records exactly what a viewer would see. That's simple and layout-accurate, but each instance needs a full Chrome, ffmpeg encoding and a dedicated audio loopback. In practice that means **one session per Jibri machine/container**, which is why it's expensive.

### What problem did multi-Jibri solve, and how did you design it? 🔥

**Problem statement:**

- Out of the box, Jicofo manages **one Jibri recording-or-streaming session per conference at a time**.
- Customers wanted, for example, to **record and live-stream at the same time**, or **stream to several destinations** (YouTube + Facebook + a custom RTMP).
- A naive "one Jibri per destination" approach multiplies cost: each Jibri is a full Chrome + encoder instance.

**Design space (discuss these, then say which one you built):**

| Approach | How | Pros | Cons |
|---|---|---|---|
| **A. One Jibri per output** | Extend the focus to hold *multiple sessions per conference* (a map keyed by session ID); the client tracks each session's status separately | Isolation: one failing stream doesn't affect others; simple per-session lifecycle | N× cost; needs pool capacity; more recorder participants in the room |
| **B. One Jibri, many outputs** | One capture/encode, fan-out with ffmpeg's **`tee` muxer** to a file plus several RTMP URLs | Encode once → big cost saving; one hidden participant | One instance is a single point of failure; must isolate per-output failures (`onfail=ignore`); more egress bandwidth on that host |
| **C. A + B hybrid with pool management** | Use B for "record + stream" bundles, A for independent sessions; autoscale the Jibri pool on idle count; scale down idle instances | Balanced cost/reliability | More moving parts |

Fan-out with a single encode looks like this:

```bash
ffmpeg ...inputs... -c:v libx264 ... -c:a aac ... -map 0:v -map 1:a -f tee \
  "[f=mp4]/recordings/room-123.mp4|[f=flv:onfail=ignore]rtmp://youtube/live2/KEY|[f=flv:onfail=ignore]rtmp://facebook/rtmp/KEY"
```

**Changes across the stack** (adapt to what you actually changed):

- **Client (React/Redux):** the recording state changed from a single `session` to a **map of sessions keyed by session ID**, each with `mode` (file/stream), `status` (pending/on/off/failed), `initiator` and `streamTarget`. The UI got per-session controls (stop one stream without stopping the recording) and clear error states.
- **Signalling:** start/stop IQs carry a **session ID**. Status presence updates are **per session**, so every participant's UI shows the correct indicators.
- **Focus/back end:** handle concurrent sessions, pick an idle Jibri for each, release correctly on failure, and **retry or fail over** if a Jibri dies mid-session.
- **Infrastructure:** size the pool with a target of *K idle Jibris*, autoscale on the brewery's idle count, and scale down after a cool-down so you don't pay for idle recorders.

**Model answer (summary):**

> "Stock Jitsi only allows one recording-or-streaming Jibri session per meeting, and our customers wanted to record and stream at the same time, sometimes to multiple platforms. I changed the client from a single recording state to a map of sessions keyed by ID, extended the signalling so start/stop/status carried session IDs, and *[worked with the backend to let the focus allocate multiple Jibris per conference / implemented fan-out so one Jibri encodes once and pushes to several outputs]*. To keep costs down we *[autoscaled the Jibri pool on idle count / used fan-out instead of extra instances]*, which *[reduced recorder infrastructure cost by ~X%]*."

### How do you handle a Jibri failing in the middle of a recording or stream?

- **Detection:** Jibri publishes health and status. If it crashes, it drops out of the brewery MUC and its session goes to `OFF` with a failure reason. Jicofo detects this and updates the conference's recording status.
- **Client UX:** show "Recording stopped unexpectedly" with a **Retry** button. Don't leave a stale "Recording" indicator, because that's a trust problem (people think they're being recorded when they're not, or the reverse).
- **Retry/failover:** request another idle Jibri. For recordings, the result is **multiple files** (part 1 and part 2). The finalize step can concatenate them (`ffmpeg -f concat`) or present them as parts.
- **With fan-out (approach B):** use `onfail=ignore` so one bad RTMP destination (wrong stream key, platform outage) doesn't kill the recording or the other streams.
- **Prevention:** health checks, ffmpeg watchdogs, enough disk space, alerting on `failed` sessions, and a minimum idle pool so a start request never waits for an instance to boot.

### How is the recording file processed after the meeting?

Typical pipeline:

1. Jibri writes MP4 to local disk while recording. Having it all local means no network dependency during the meeting.
2. On stop, the **finalize script** gets the recording directory. It uploads to object storage (S3), optionally with multipart upload for large files.
3. It notifies the backend with a webhook or queue message: meeting ID, duration, size, S3 key.
4. The backend creates a recording entry. Users download via **pre-signed URLs** that expire after a short time.
5. Optional: transcoding to smaller renditions, thumbnail generation, transcription, retention policies (S3 lifecycle rules).

## Meeting modes & roles

### What is Visitor mode and how does it scale? 🔥

**Concept:** visitors are **view-only attendees**. They receive audio and video but don't send media, and they don't appear in the participant list as full participants. This lets a meeting have a small interactive group (speakers) and a large audience.

**Why it's needed:** in a normal MUC, every participant's presence is broadcast to every other participant. That's O(N²) presence traffic. Jicofo also negotiates a full Jingle session with each participant, and every client renders a participant list. Past a few hundred people, signalling becomes the bottleneck, not media.

**How Jitsi's visitors feature scales it:**

- The main Prosody hosts the "real" room. When it reaches a configured participant limit, or when someone joins with a visitor role, the joiner is **redirected to a visitor node**: a separate Prosody instance (a *vnode*) linked to the main Prosody through **XMPP server-to-server (s2s) federation**.
- Visitors on a vnode see the main room's participants (presence is relayed), but **visitor presence is not broadcast back to the main room**. That keeps the speakers' clients light.
- Jicofo still sets up media sessions for visitors: they **receive** streams from the JVB (bridges can be cascaded for capacity) and send nothing.
- A visitor can **raise a hand / request to join**. If a moderator approves, they're **promoted** and move into the main room as a full participant.
- Visitors may also wait until the meeting is **live** before media starts.

**Your answer should add MeetHour-specific details:** how you surfaced the visitor role in the UI (hiding unmute/share/chat as configured, showing a visitor counter instead of the full list), the promote flow, and what you changed in Prosody or signalling. *[Fill in.]*

### What is Backstage mode and how would you implement it?

**Concept** (adapt to MeetHour's exact definition): a **green room**. Hosts and presenters can join, test their audio and video, and coordinate **before** the audience sees them. The host clicks **"Go live"** and the audience starts receiving the presenters' media.

**Implementation sketch:**

- **State:** a room-level flag such as `backstage: true` or `live: false` stored on the server (room metadata, or a custom presence or IQ handled by a Prosody module). It's broadcast to all participants.
- **Enforcement on the server, not just the UI:**
  - Audience members (visitors) either aren't allowed to receive presenters' streams until live, or they wait in a waiting state with no media session.
  - Only moderators or hosts can flip the flag; the Prosody module checks the occupant's role or affiliation.
- **Client:**
  - Presenters see a "Backstage — not live" banner, a preview and a Go live button.
  - The audience sees "The event will start soon".
  - On going live, the clients react to the state change, the audience sets up media, and the UI transitions.
- **Edge cases:** the host disconnects during backstage (keep state on the server, let co-hosts take over), late joiners (they read the current state on join), and going *back* to backstage.

### How did you implement multiple user roles (host, co-host, presenter, participant, visitor)? 🔥

**Model the roles in two layers:**

1. **XMPP MUC primitives** (XEP-0045):
   - **Affiliations** are persistent: `owner`, `admin`, `member`, `none`, `outcast`.
   - **Roles** are per session: `moderator`, `participant`, `visitor`.
   - Jitsi grants moderator rights by role and affiliation. With JWT auth, the token's `context.user` (e.g. `"moderator": true` or an `affiliation` claim) decides it.
2. **Application roles** (host, co-host, presenter…) live on top as **capabilities**: can mute others, can record, can share screen, can admit from lobby, can promote visitors, and so on.

**Design principles to mention:**

- **Single source of truth on the server.** Roles come from the signed JWT or the Prosody module. The client never decides its own permissions.
- **Capability map, not role checks scattered in the UI.** A `can(user, 'START_RECORDING')` selector derived from the role. UI components read capabilities, which makes adding a role a one-line change.
- **Enforce on the server too.** A Prosody module hook (e.g. on `muc-occupant-pre-join` or on IQ handling) rejects a recording request from a non-moderator, even if someone tampers with the client.
- **Role changes at runtime** (promote/demote) are broadcast via presence. The Redux reducer updates the capability set, and the UI reacts immediately.

```ts
type Role = 'host' | 'cohost' | 'presenter' | 'participant' | 'visitor';
type Capability = 'muteOthers' | 'record' | 'shareScreen' | 'admitLobby' | 'promoteVisitor' | 'unmuteSelf';

const CAPABILITIES: Record<Role, ReadonlySet<Capability>> = {
  host: new Set(['muteOthers', 'record', 'shareScreen', 'admitLobby', 'promoteVisitor', 'unmuteSelf']),
  cohost: new Set(['muteOthers', 'shareScreen', 'admitLobby', 'promoteVisitor', 'unmuteSelf']),
  presenter: new Set(['shareScreen', 'unmuteSelf']),
  participant: new Set(['unmuteSelf']),
  visitor: new Set(),
};

const can = (role: Role, cap: Capability) => CAPABILITIES[role].has(cap);

console.log(can('presenter', 'shareScreen'), can('visitor', 'unmuteSelf'), can('cohost', 'record'));

test('capabilities derive from role', () => {
  expect(can('host', 'record')).toBe(true);
  expect(can('cohost', 'record')).toBe(false);
  expect(can('visitor', 'unmuteSelf')).toBe(false);
});
```

### Explain how you architected Webinar mode for large audiences 🔥

**Requirements:**

- **Presenters** (a few) are fully interactive.
- **Attendees** (hundreds to thousands) watch, with optional Q&A, chat, polls and raise-hand.
- Low latency is preferred.
- It must not degrade the presenters' experience.

**Architecture:**

1. **Separation:** presenters join the main room as participants. Attendees join as **visitors** on visitor nodes, so signalling load is isolated from the presenters' room.
2. **Media scale:** attendees only *receive*. The JVB forwards presenters' streams, and bridges are **cascaded** (relays) so load spreads across several JVBs and regions. Receiver constraints keep attendees on suitable layers.
3. **Interaction channel:** Q&A, chat and polls go through a channel that doesn't broadcast every attendee's presence (moderated chat, or a separate service). Moderators approve questions before they're shown.
4. **Promotion:** an attendee can be promoted to speaker (raise hand → approve → joins the main room).
5. **Fallback for very large events:** for 10k+ viewers, or viewers on poor networks, offer **live streaming via Jibri → RTMP → CDN/HLS**. Latency is higher (seconds), but scale is effectively unlimited.
6. **UI:** a dedicated attendee layout (stage view of presenters plus a Q&A panel) with no tile grid of attendees, and presenter controls for spotlighting and screen-share priority.

**Trade-offs to articulate:**

- WebRTC visitors give sub-second latency, but each viewer costs SFU egress.
- HLS is cheap at scale but has 5–30 s latency and no interactivity.
- A hybrid gives the best of both.

### What is the lobby feature and how does it work in Jitsi?

When the lobby is enabled, a joiner is placed in a **separate lobby MUC** (Prosody module `muc_lobby_rooms`, `lobby.<domain>`) instead of the main room. Moderators get a "knocking" notification and can **admit** or **reject**. On admit, the joiner is added to the main room's member list and can join. Moderators can also set a password so people with it skip the lobby. In interviews, mention that the **server enforces membership**. Members-only rooms reject non-admitted users, so it isn't just a UI gate.

## Electron desktop app

### How did you implement screen sharing in the Electron app? 🔥

- Browser `getDisplayMedia()` needs a **picker UI**. Chrome provides one, but in Electron **you** provide it.
- **Main process:** `desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize })` returns sources with `id`, `name`, `display_id` and thumbnail. In modern Electron this API is only available in the main process.
- **Two wiring options:**
  1. **Modern:** in the main process, call `session.setDisplayMediaRequestHandler((request, callback) => …)`. Show your picker, then call `callback({ video: chosenSource, audio: 'loopback' })` (system audio on Windows). The renderer just calls `navigator.mediaDevices.getDisplayMedia()`.
  2. **Classic:** send the sources to the renderer over IPC. The renderer calls `getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id } } })`.
- **macOS:** screen recording needs the user's permission (System Settings → Privacy → Screen Recording). Check it with `systemPreferences.getMediaAccessStatus('screen')` and guide the user.
- Then the track is added to the conference as a **desktop** video source (with multi-stream, alongside the camera).

```node
// main.js (simplified)
const { app, desktopCapturer, session } = require('electron');

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    const chosen = await showPicker(sources); // your own picker window / IPC round-trip
    if (chosen) callback({ video: chosen, audio: 'loopback' });
    else callback({}); // user cancelled -> getDisplayMedia rejects
  });
});
```

> This block uses the `node` label because it needs Electron APIs. It's illustrative, not runnable in the playground.

### How did you build "Screen Sharing with Annotations"? 🔥

The idea: the presenter draws on top of their screen, and **because the screen is being captured, the drawings appear in the shared stream automatically**.

1. **Overlay window:**
   - A `BrowserWindow` with `transparent: true`, `frame: false`, `alwaysOnTop: true` (level `'screen-saver'` so it sits above full-screen apps), `skipTaskbar: true` and `hasShadow: false`.
   - Its bounds match the shared display's bounds. Find the right display with `screen.getAllDisplays()` and match it to the source's `display_id`.
2. **Click-through:** when the user isn't drawing, `win.setIgnoreMouseEvents(true, { forward: true })` passes clicks to the apps underneath (`forward` still delivers mouse-move events for hover effects). Toggling drawing mode turns it off so the canvas gets pointer events.
3. **Drawing engine:**
   - A full-window `<canvas>` with pointer events (supports pen pressure via `PointerEvent.pressure`).
   - Tools: pen, highlighter, arrow, rectangle, text, eraser, undo/redo (a command stack) and clear.
   - Optional fade-out ("laser pointer" strokes that disappear after 2 s).
   - Store strokes as **vectors** (arrays of points) rather than pixels, so undo and re-render are cheap and resolution-independent (handle DPI with `devicePixelRatio`).
4. **Toolbar window:** a small separate always-on-top window holding the controls, created with **`setContentProtection(true)`** so it's **excluded from the capture**. Viewers see the drawings but not the toolbar.
5. **IPC:** the main window, overlay and toolbar communicate via the main process (`ipcMain`/`ipcRenderer`, or `MessageChannelMain` ports for a direct high-frequency channel).
6. **Limitation and answer:** if the user shares a **single window** instead of a screen, the overlay isn't part of that window's capture. Options:
   - restrict annotation to full-screen shares
   - composite the window capture and the strokes on a canvas, and send that canvas's `captureStream()`
   - track the window's position and redraw

**Optional: remote annotations.** Viewers drawing on the presenter's screen means sending normalised coordinates (0–1 relative to the shared surface) over the conference data channel or XMPP messages, then rendering them in the presenter's overlay.

### How did you implement Picture-in-Picture in the desktop app?

Three possible approaches. Say which one you used:

1. **Video element PiP:** `videoEl.requestPictureInPicture()` works in Chromium/Electron, but it shows **one video** and has limited controls.
2. **Document Picture-in-Picture API** (`documentPictureInPicture.requestWindow()`, Chromium 116+) opens an always-on-top window with **arbitrary HTML**: several tiles, mute and hang-up buttons. You move or clone DOM into it and attach the same `MediaStream`s.
3. **Electron always-on-top mini window:** a small frameless `BrowserWindow` with `alwaysOnTop: true`. It shows automatically when the main window is minimised or loses focus during a call, and hides when the call window is focused again.
   - Jitsi's desktop app uses a variation: a child window opened with `window.open` from the call page, so it shares the renderer process and can reuse the **same `MediaStream` objects** (`miniVideo.srcObject = mainVideo.srcObject`).
   - That works without re-negotiating or decoding twice.

Details worth mentioning:

- Show the **dominant speaker**, falling back to a screen share if one is active.
- Remember the window's position.
- Make sure the PiP window doesn't steal focus (`showInactive()`).
- Clean up when the call ends.

### How did you implement Local Recording?

Local recording means saving the meeting on the user's machine with **no server and no Jibri**.

1. **Video:** capture the call window itself (`desktopCapturer` source for your own window, or `getDisplayMedia` with the current window/tab), or composite the tiles onto a `<canvas>` and use `canvas.captureStream(30)`.
2. **Audio:** mix all participants plus the local mic with the **Web Audio API**. Create an `AudioContext`, call `createMediaStreamSource()` for each track, connect them all to one `createMediaStreamDestination()`, and use `destination.stream` as the audio track.
   - Re-wire the graph when participants join or leave.
3. **Recorder:** `new MediaRecorder(new MediaStream([videoTrack, mixedAudioTrack]), { mimeType: 'video/webm;codecs=vp9,opus' })` with `start(1000)` to get 1-second chunks.
4. **Persist incrementally:** send each chunk to the main process over IPC and append it to a file with `fs.createWriteStream`. Never keep a one-hour recording in renderer memory.
   - Handle crashes: the file is still playable up to the last chunk, though WebM duration metadata may be missing.
   - Post-process with `ffmpeg -c copy` or `ts-ebml` to fix seeking.
5. **Consent and indicator:** notify participants that a local recording is happening (Jitsi shows a "local recording" indicator). This is a legal and privacy requirement in many places.

```js
// Mixing several audio tracks into one (works in any modern browser)
function mixAudio(streams) {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const sources = streams
    .filter((s) => s.getAudioTracks().length)
    .map((s) => {
      const src = ctx.createMediaStreamSource(s);
      src.connect(dest);
      return src;
    });
  return { stream: dest.stream, stop: () => { sources.forEach((s) => s.disconnect()); ctx.close(); } };
}
```

> Running this in the playground only defines the function: Web Audio isn't available inside the playground's worker. Try it in a browser console during a call.

### What performance improvements did you make in the Electron app? 🔥

Pick the ones you actually did and attach numbers:

- **Upgrade Electron/Chromium.** This brings WebRTC fixes, better codecs and memory improvements. Each major version also tightens security defaults.
- **Avoid synchronous IPC** (`ipcRenderer.sendSync`, the `remote` module). It blocks the renderer. Use `invoke`/`handle`, which is async.
- **Background throttling:** when minimised, Chromium throttles timers in background windows, which can break audio-level meters or stats loops. Use `webPreferences.backgroundThrottling: false` for the call window, and move periodic work to Web Workers. Workers aren't throttled the same way; Jitsi uses a timer worker for its video effects.
- **Memory:** clean up `MediaStream` tracks (`track.stop()`), remove IPC and event listeners on unmount, destroy hidden windows you don't need, and watch for detached DOM nodes in heap snapshots.
- **Startup time:** lazy-load heavy modules, defer non-critical windows, use V8 code caching, and keep the preload script small.
- **GPU:** keep hardware acceleration on (video decode/encode). Diagnose with `chrome://gpu`, which you can open in a dev build.
- **Rendering:** the same React optimisations as on the web (memoised tiles, fewer re-renders on audio-level updates).

### How do you secure an Electron app that loads a remote web app?

- `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true` (defaults in modern Electron) for any window that loads remote content.
- Expose a **minimal, typed API** via `contextBridge.exposeInMainWorld` in the preload. Never expose `ipcRenderer` directly.
- **Validate the sender** in `ipcMain.handle` (`event.senderFrame.url`) and validate all arguments.
- Use `setWindowOpenHandler` and `will-navigate` to block navigation to unexpected origins. Open external links with `shell.openExternal` after an **allow-list** check.
- Use a **Content Security Policy**, keep Electron updated, sign and notarise builds, use secure auto-updates over HTTPS with signature verification, and enable **Electron Fuses** to disable `RunAsNode` and Node CLI inspect in production.

(The Electron document has the full security checklist.)

## Media features

### What does "multi-stream for individual participants" mean, and how does it work? 🔥

Historically, each Jitsi participant could send **one video stream**: camera *or* screen share. Starting a screen share **replaced** the camera. **Multi-stream** lets one participant send **several video sources at once**, typically camera **and** screen share, which other participants see as **two separate tiles**.

**How it works:**

- **Source names:** every source is identified as `<endpointId>-v0` (camera) and `<endpointId>-v1` (screen share). They're signalled in Jingle (`source-add` with `<source name="…">` and SSRC groups for simulcast `SIM` and RTX `FID`) and in presence (`SourceInfo`: muted state, video type per source).
- **Receiver-driven quality:** each receiver sends **receiver video constraints** to the JVB, per source name: `onStageSources`, `selectedSources`, `lastN`, `defaultConstraints`, `constraints: { "abcd-v1": { maxHeight: 1080 } }`. The bridge allocates bandwidth across all *sources*, not just endpoints.
- **Client:**
  - Redux tracks **sources per participant** (not one track per participant).
  - The tile view renders one tile per *source*.
  - Screen-share tiles get priority on stage.
  - Separate mute/unmute state per source.
- **Encoding:** screen share is usually high resolution and low frame rate (`contentHint = 'detail'`, 5–15 fps). The camera keeps simulcast.

### How did you improve Virtual Background performance? 🔥

**How the virtual background works (Jitsi's approach):**

1. Draw each camera frame onto a canvas.
2. Run a **person-segmentation model**: a TFLite model similar to MediaPipe's selfie segmentation, compiled to **WebAssembly** and using **SIMD** when available. It produces a mask at low resolution (e.g. 256×144).
3. Composite: draw the person through the mask over a blurred copy of the frame or a background image (canvas `filter: blur()` plus `globalCompositeOperation`).
4. Send `canvas.captureStream()` as the new video track.

**Bottlenecks:**

- the segmentation inference
- **main-thread** canvas work competing with React rendering
- `getImageData` readbacks (GPU→CPU copies)
- timers being throttled in background tabs

**Optimisations (claim the ones you did, with numbers):**

| Optimisation | Why it helps |
|---|---|
| Run inference at **lower resolution** and fewer FPS (segment every 2nd frame, reuse the mask) | Inference cost scales with pixels; masks change slowly |
| Use the **WASM SIMD** build; fall back gracefully | Several times faster inference where supported |
| Move processing to a **Web Worker + OffscreenCanvas** | Frees the main thread, so the UI stays smooth |
| Use **`MediaStreamTrackProcessor` / `VideoFrame`** (Insertable Streams for raw media, Chromium) instead of canvas + `requestAnimationFrame` loops | Zero-copy frame access; frames come at the camera's rate, even in background tabs |
| **WebGL/WebGPU compositing and blur** instead of the 2D canvas `filter` | The GPU does the blur and blend cheaply |
| Drive the loop with a **worker timer** or `requestVideoFrameCallback` | Avoids `setTimeout` throttling and dropped frames |
| **Edge smoothing** (feathering the mask, temporal smoothing) | Better quality without a bigger model |
| Disable automatically on low-end devices (CPU-pressure detection, frame-time budget) | Protects call quality |

**Model answer:**

> "Profiling showed the segmentation and canvas compositing on the main thread were taking *[N]* ms per frame, causing jank and dropped frames. I *[moved the pipeline to a worker with OffscreenCanvas / reduced segmentation resolution and reused masks between frames / switched compositing to WebGL]*, which brought per-frame cost down to *[M]* ms and cut CPU usage by *[X%]* on our reference laptop."

### How did you build URL-parameter-based participant tracking for Excalidraw sessions?

**Context:**

- Jitsi integrates **Excalidraw** as a collaborative whiteboard. Excalidraw's collaboration uses a **room ID and an encryption key**. Public excalidraw.com links look like `#room=<roomId>,<key>`.
- Scene updates are **end-to-end encrypted** (AES-GCM) and relayed through a small **socket.io server** (`excalidraw-room`).
- Collaborators broadcast pointer positions and usernames so others can see labelled cursors.

**The problem:** inside a meeting, you need to know *which meeting participant* is which whiteboard collaborator. The uses are labelled cursors, "who's drawing", analytics ("who joined the whiteboard, when"), and possibly attributing elements to authors.

**Approach:**

1. When opening the whiteboard, the app builds the whiteboard URL with **participant identity in URL parameters**, such as `participantId`, `displayName` and the meeting ID, alongside the collab room/key.
   - Keep the encryption key in the **hash fragment** (`#…`), because the fragment is never sent to servers.
2. On load, the whiteboard reads the parameters with `URLSearchParams`. It sets the Excalidraw collaborator `username` and attaches the participant ID to collaboration events.
3. **Attribution:** each element can carry `customData` (e.g. `{ createdBy, lastEditedBy }`), updated in `onChange` when the local user modifies elements.
4. **Tracking:** emit join, leave and active-drawing events to the meeting (XMPP message or REST) so the host can see who's on the whiteboard.

```js
// Parse identity safely from the URL and keep secrets in the hash
function readWhiteboardParams(href) {
  const url = new URL(href);
  const params = url.searchParams;
  const hash = new URLSearchParams(url.hash.slice(1));
  const clean = (s, max = 64) => (s ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, max);
  return {
    participantId: clean(params.get('participantId'), 36),
    displayName: clean(params.get('displayName')) || 'Guest',
    meetingId: clean(params.get('meetingId'), 64),
    roomKey: hash.get('key'), // never sent to any server
  };
}

const p = readWhiteboardParams('https://wb.example.com/board?participantId=ab12cd&displayName=Zaki%20<script>&meetingId=m-77#key=s3cr3t');
console.log(p);

test('sanitises display name and keeps key in hash', () => {
  expect(p.displayName).toBe('Zaki script');
  expect(p.roomKey).toBe('s3cr3t');
});
```

**Security points interviewers like:**

- **Never trust URL parameters for authorisation.** They're for identification and labelling only. Real permissions come from the meeting's signed token.
- Sanitise or escape anything you render (display names can contain HTML).
- Keep secrets in the fragment.

## React architecture & performance on MeetHour

### You "refactored the React architecture to improve rendering performance". What was wrong and what did you change? 🔥

**Typical problems in a large conferencing React app:**

- **High-frequency state in global Redux.** Audio levels, dominant-speaker changes and connection stats update many times per second. When `useSelector` calls return new objects, those updates re-render large parts of the tree.
- **Selectors returning new references** (`state.participants.filter(...)` inside `useSelector`) make `useSelector` see a change on *every* dispatch, so components always re-render.
- **Tile components receiving whole participant objects**, so any field change re-renders every tile.
- **Rendering all tiles**, including those off-screen in a 100-person meeting.
- **Large Context values** that change often.

**Fixes (with the reasoning interviewers want):**

1. **Normalised state** (participants by ID) plus **memoised selectors** (`createSelector` from Reselect/RTK) that return stable references. Components select **primitives or IDs**.
2. **Tile = `React.memo(Tile)` given only a `participantId`.** Each tile selects its own small slice, so one participant's change re-renders one tile.
3. **Move high-frequency data out of React render:**
   - Audio-level indicators subscribe directly (an event emitter or `useSyncExternalStore` with a fine-grained subscription) and update via **refs/CSS variables** or a tiny isolated component.
   - Stats are throttled (e.g. 1 Hz).
4. **Virtualise the filmstrip/tile view** so only visible tiles mount. Also tell the bridge not to send video for invisible tiles (receiver constraints). This saves both CPU and bandwidth.
5. **Code-split** rarely used features (whiteboard, settings dialogs, virtual background models) with `React.lazy`.
6. **Measure:** React Profiler (commits per second, render durations), the Chrome Performance panel, and "Highlight updates when components render".

```jsx
// Before: every tile re-renders on any participant change
const participants = useSelector((s) => Object.values(s.participants.byId)); // new array every time!

// After: the list selects stable ids; each memoised tile selects its own data
const ids = useSelector(selectParticipantIds); // createSelector -> stable array reference
return ids.map((id) => <Tile key={id} participantId={id} />);

const Tile = React.memo(function Tile({ participantId }) {
  const name = useSelector((s) => s.participants.byId[participantId].name);
  const videoMuted = useSelector((s) => s.participants.byId[participantId].videoMuted);
  return <div className="tile">{name}{videoMuted && <Avatar />}</div>;
});
```

### How is state managed in the Jitsi/MeetHour client?

- **Redux** with a "feature folder" structure: each feature (`base/participants`, `recording`, `filmstrip`, `lobby`…) has its own actions, reducer, selectors and **middleware**.
- **Middleware is where side effects live.** For example, the recording middleware listens for conference events from lib-jitsi-meet and dispatches Redux actions, or reacts to `START_RECORDING` by sending the IQ.
- **`StateListenerRegistry`** (a Jitsi utility) subscribes to *derived* state changes. For example, "when the selected participant changes, update receiver constraints".
- **The boundary:** lib-jitsi-meet emits events (`TRACK_ADDED`, `USER_JOINED`, `RECORDER_STATE_CHANGED`…). Thin adapters convert them into Redux actions, so React components never talk to WebRTC objects directly.

Explaining this boundary (event-driven media layer ↔ Redux ↔ React) shows architectural maturity.

## Debugging & production

### A user says "I can't see anyone's video". How do you debug it? 🔥

Work from the **network** up to the **UI**:

1. **Is media connected?**
   - Check the connection indicator and stats (`RTCPeerConnection.getStats()`: `bytesReceived` increasing on inbound-rtp video?).
   - Use `chrome://webrtc-internals` for the ICE connection state.
   - **ICE failure** usually means a firewall is blocking UDP 10000 → check TCP/TURN fallback (TURN on 443/TLS for corporate networks).
2. **Is the bridge forwarding?**
   - Is the user over **last-N**?
   - Are receiver constraints asking for 0 height (a hidden tile)?
   - Is bandwidth estimation very low (the bridge suspended video)?
3. **Signalling:**
   - Did `source-add` arrive?
   - Does the remote track exist in lib-jitsi-meet (`TRACK_ADDED`)?
   - Is the participant's video actually muted (presence `videomuted=true`)?
4. **Codec mismatch:** the receiver can't decode the sender's codec (e.g. a Safari/H.264 vs VP9 preference issue). Check the negotiated codec in stats.
5. **UI:**
   - Is the `<video>` attached to the right track, with `autoplay` and `playsInline` (iOS)?
   - Did the `<video>` element fail `play()` because of autoplay policy?
   - Is the tile mounted?
6. **Device or OS:** GPU decode issues, outdated browser, too many tabs.

Say that you **reproduce with network throttling** and multiple clients, and use **logs plus `webrtc-internals` dumps** from the user.

### How do you scale a Jitsi deployment? 🔥

- **Shards:** one shard = Prosody + Jicofo + a pool of JVBs. A front proxy (e.g. **HAProxy**) routes by **room name** using consistent hashing on the `room` URL parameter, so all participants of a room land on the same shard.
- **JVB autoscaling:** bridges report **stress** (packet rate relative to capacity). Jicofo spreads conferences across bridges by stress and region, and an autoscaler adds bridges when average stress exceeds a threshold.
- **Cascading (relays, formerly Octo):** one conference can span multiple JVBs, for capacity or **geographic proximity** (each user connects to the nearest bridge and bridges relay between regions).
- **Jibri pool:** scale on the idle count in the brewery.
- **Visitors** for signalling scale in huge meetings.
- **Stateless frontends** (static web app on a CDN) and **TURN** servers close to users.
- **Observability:** JVB/Jicofo REST stats endpoints, Prometheus/Grafana, client-side callstats (`rtcstats`).

### What would you do differently if you rebuilt the recording system today?

This tests reflection. Good options:

- **Server-side compositing without a browser.** Subscribe to the SFU's streams directly and compose with GStreamer/ffmpeg or a media server. That avoids Chrome-per-session cost, but loses "what you see is what you get" layout fidelity.
- **Per-track recording.** Record each participant's raw RTP (no compositing) and compose later on demand. Cheaper during the meeting, flexible after it.
- **Containerised Jibri on Kubernetes** with a pre-warmed pool, autoscaling and spot instances for cost.
- **Better observability:** per-session tracing from button click → Jicofo → Jibri → upload, with alerts on failure rates.

### Describe a production incident on MeetHour and how you handled it 🔥

Use STAR and pick a real one. Strong candidates:

- recordings failing for a subset of meetings
- desktop app crashing on a particular OS update
- screen share broken after a Chrome/Electron upgrade
- visitors not receiving video under load

Structure:

1. **Detection:** customer report or monitoring.
2. **Mitigation first:** a workaround or rollback, communicated to the team.
3. **Root cause:** the logs and tools used.
4. **Fix:** what you changed.
5. **Prevention:** a test, an alert, a runbook.

> Template: "After an Electron upgrade, screen sharing on macOS failed for some users. I mitigated by *[rolling back the update channel]*, then found that *[the new version required `setDisplayMediaRequestHandler` / a changed permission flow]*. I fixed it, added a release checklist item to test screen sharing on all three OSes, and added error telemetry for `getDisplayMedia` failures."

## Earlier MeetHour work (2019–2022)

### You worked on "multiple live streaming and recording, audio/video moderation, Donorbox, whiteboard and Etherpad integration". Explain these.

- **Multiple live streaming & recording:** the earlier version of the multi-session problem (see above). It's useful to show how your understanding grew between 2019 and 2025.
- **Audio/video moderation (AV moderation):**
  - Moderators can set the room so participants **can't unmute themselves** without approval.
  - Participants raise a hand to ask to speak; moderators approve per participant.
  - Implemented with room-level moderation state, per-participant "approved" lists and a Prosody module enforcing it (Jitsi has `muc_av_moderation`).
  - The client disables unmute and shows "ask to unmute".
  - **Enforcement belongs on the server/bridge** so a modified client can't bypass it.
- **Donorbox integration:** embedding a donation form or button in the meeting (e.g. for non-profit or church webinars). Load the Donorbox embed/iframe securely (sandboxed iframe, CSP allow-list) and show it to participants on the host's command.
- **Whiteboard:** embedding a collaborative whiteboard (Excalidraw in newer Jitsi) and syncing who's using it.
- **Etherpad:** shared document editing alongside the meeting. Jitsi integrates Etherpad by mapping each meeting to a pad (`etherpad_base` in config) and showing it in a side panel. The pad name is derived from the room name, so all participants open the same pad.

### What did you learn from working on the same product across two stints?

> "Coming back in 2025, I could see the long-term cost of earlier shortcuts. For example, the recording state was modelled as a single boolean-ish session, and that made multi-Jibri harder. It taught me to model domain state for the future without over-engineering: use maps keyed by ID instead of singletons when multiplicity is plausible, and enforce permissions on the server from day one. I also appreciated documentation and tests much more, because they're what let a returning engineer move fast."
