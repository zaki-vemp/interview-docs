# Electron Desktop Apps

You **revamped MeetHour's Electron desktop app**, adding screen sharing with annotations, Picture-in-Picture, local recording and performance work. Expect questions on Electron's **process model, IPC, security hardening, screen capture, window management, auto-updates, packaging and performance**.

> Electron code needs the Electron runtime, so the snippets are labelled **Node.js** (not runnable in the playground). The concepts are what interviewers probe.

## Architecture

### How does Electron work? Explain the process model 🔥

Electron combines **Chromium** (rendering) and **Node.js** (system access) in one app. It uses Chromium's **multi-process architecture**:

| Process | Count | Role | Has access to |
|---|---|---|---|
| **Main process** | 1 | App lifecycle (`app`), creates **`BrowserWindow`s**, native menus, tray, dialogs, global shortcuts, auto-updater, `desktopCapturer`, file system, IPC hub | **Full Node.js**, Electron main APIs |
| **Renderer process** | 1 per window/webview (roughly) | Runs your web UI (React app) in Chromium | Web APIs; **no Node by default** (`nodeIntegration: false`, `sandbox: true`) |
| **Preload script** | Runs in the renderer before page scripts, in an **isolated world** | **The bridge**: exposes a small, safe API to the page via `contextBridge` | Limited Node/Electron APIs (`ipcRenderer`, etc.) in sandboxed mode |
| **Utility process** | Optional | CPU-heavy or crash-prone work off the main process (`utilityProcess.fork`); supports `MessagePort`s | Node.js |
| GPU, network, audio services | Chromium internals | — | — |

**Key point:** the **main process must stay responsive**. It handles all windows, IPC routing and native events. Blocking it (synchronous file I/O, heavy computation) freezes **every** window.

### How does IPC work in Electron? Which pattern do you use? 🔥

**Patterns:**

1. **Renderer → main, request/response:** `ipcRenderer.invoke(channel, ...args)` ↔ `ipcMain.handle(channel, async handler)`. **Promise-based. This is the default choice.**
2. **Renderer → main, one-way:** `ipcRenderer.send` ↔ `ipcMain.on`.
3. **Main → renderer:** `win.webContents.send(channel, data)` ↔ `ipcRenderer.on` (exposed through the preload).
4. **Renderer ↔ renderer / high-frequency streams:** create a **`MessageChannelMain`** in the main process and transfer the ports to two renderers with `postMessage`. After that they talk **directly**, without routing every message through main. Good for annotation strokes and PiP state.
5. **Avoid `ipcRenderer.sendSync`** (it blocks the renderer until main replies) and the deprecated **`remote` module** (slow, insecure).

**Serialisation:** arguments use the **Structured Clone Algorithm**, so no functions, DOM nodes or class prototypes. `MediaStream` objects **can't** be sent over IPC.

```node
// preload.ts — expose a minimal, typed API (never expose ipcRenderer itself)
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  getScreenSources: () => ipcRenderer.invoke('screen:get-sources'),
  saveRecordingChunk: (id: string, chunk: ArrayBuffer) => ipcRenderer.invoke('recording:chunk', id, chunk),
  onAnnotationToggle: (cb: (enabled: boolean) => void) => {
    const listener = (_e: unknown, enabled: boolean) => cb(enabled);
    ipcRenderer.on('annotation:toggle', listener);
    return () => ipcRenderer.removeListener('annotation:toggle', listener);   // let React clean up
  },
});

// main.ts
ipcMain.handle('screen:get-sources', async (event) => {
  assertTrustedSender(event);                                    // validate who is calling
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
  return sources.map((s) => ({ id: s.id, name: s.name, displayId: s.display_id, thumbnail: s.thumbnail.toDataURL() }));
});

function assertTrustedSender(event: Electron.IpcMainInvokeEvent) {
  const url = new URL(event.senderFrame.url);
  if (url.origin !== 'https://app.meethour.example') throw new Error(`Untrusted IPC sender: ${url.origin}`);
}
```

## Security

### How do you secure an Electron app, especially one that loads remote content? 🔥

Electron's official security checklist, as you'd explain it:

1. **`contextIsolation: true`** (the default). The preload and the page run in **separate JavaScript worlds**, so page scripts can't tamper with your preload's globals or prototypes.
2. **`nodeIntegration: false`** (the default) and **`sandbox: true`** (the default since Electron 20). Renderers can't `require('fs')` or `child_process`, so an **XSS bug doesn't become remote code execution**.
3. **Expose minimal, specific APIs** via `contextBridge`, not generic `send(channel, ...)` helpers. **Validate every IPC message**: the sender's origin (`event.senderFrame.url`) and argument types and values.
4. **Load only HTTPS content you trust.** Use a strict **Content Security Policy**. Never `loadURL` a user-supplied URL.
5. **Control navigation and new windows:** `webContents.on('will-navigate', …)` and **`setWindowOpenHandler`** with allow-lists. Open external links with `shell.openExternal` only after validating the protocol (`https:`). `shell.openExternal('file:///...')` or a custom scheme can launch programs.
6. **Permission handlers:** `session.setPermissionRequestHandler` and `setPermissionCheckHandler`. Grant camera, mic and screen access **only to your origin**.
7. **Don't use `webSecurity: false`**, `allowRunningInsecureContent`, or `experimentalFeatures` in production.
8. **Avoid `<webview>`.** Prefer `BrowserView`/`WebContentsView` or iframes. If you must use it, lock it down (`will-attach-webview`).
9. **Electron Fuses:** disable `RunAsNode`, `EnableNodeCliInspectArguments` and `EnableNodeOptionsEnvironmentVariable`. Enable `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` in packaged builds.
10. **Keep Electron updated.** Each major version patches Chromium security bugs. Only the latest three stable majors get security fixes.
11. **Code signing** (Windows Authenticode, macOS Developer ID + **notarisation**) and **signed auto-updates**.
12. **Custom protocols** (`protocol.handle`) instead of `file://` for local content, with path traversal checks.

```node
const win = new BrowserWindow({
  width: 1280, height: 800,
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    backgroundThrottling: false,          // a call window must keep running when minimised
  },
});

win.webContents.setWindowOpenHandler(({ url }) => {
  if (new URL(url).protocol === 'https:') shell.openExternal(url);  // external links in the system browser
  return { action: 'deny' };
});

session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
  const trusted = new URL(wc.getURL()).origin === 'https://app.meethour.example';
  callback(trusted && ['media', 'display-capture', 'notifications', 'fullscreen'].includes(permission));
});
```

### Why is `nodeIntegration: true` dangerous?

With Node integration enabled in a renderer, **any JavaScript running in that page**, including injected scripts from an XSS bug, a compromised third-party script, malicious ad content or a remote page you navigated to, gets **full system access**: reading files, running commands (`child_process.exec`), installing malware. In a browser, XSS steals a session. In Electron with Node integration, **XSS means remote code execution on the user's machine**. For a conferencing app that renders **user-controlled content** (chat messages, display names, whiteboard text), this is critical.

## Features you built

### How does screen sharing work in Electron? 🔥

- Browsers show their own picker for `getDisplayMedia`. **Electron doesn't**, so the app must provide one.
- **`desktopCapturer.getSources({ types: ['screen', 'window'] })`** (main process) lists screens and windows with thumbnails. Show them in a custom picker window or modal.
- **Modern wiring:** `session.setDisplayMediaRequestHandler((request, callback) => …)` intercepts the renderer's `navigator.mediaDevices.getDisplayMedia()`. Show the picker, then call `callback({ video: selectedSource, audio: 'loopback' })`. **System audio loopback** works on Windows; on macOS it needs extra setup.
- **Older approach:** pass the source ID to the renderer and call `getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId } } })`.
- **macOS:** the app needs **Screen Recording permission**. Check `systemPreferences.getMediaAccessStatus('screen')` and guide the user to System Settings, because the API returns black frames or only the wallpaper without permission. macOS 15 also shows periodic re-consent prompts.
- **Wayland on Linux:** capture goes through **PipeWire / xdg-desktop-portal**. The system picker appears and the source list behaves differently.
- **Jitsi's approach:** `@jitsi/electron-sdk` provides the screen-sharing picker and the related features used by the Jitsi Meet desktop app.

### How did you implement annotations on top of the shared screen? 🔥

(The full design is in the MeetHour deep dive. Here's the Electron-specific part.)

```node
function createAnnotationOverlay(displayId: string) {
  const display = screen.getAllDisplays().find((d) => String(d.id) === displayId) ?? screen.getPrimaryDisplay();
  const overlay = new BrowserWindow({
    ...display.bounds,                     // cover the shared screen exactly
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: { preload: path.join(__dirname, 'overlay-preload.js'), sandbox: true, contextIsolation: true },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');                 // above full-screen apps
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });        // click-through until drawing mode is on
  overlay.loadFile('overlay.html');
  return overlay;
}

ipcMain.on('annotation:drawing-mode', (_e, enabled: boolean) => {
  overlay.setIgnoreMouseEvents(!enabled, { forward: true });    // capture pointer only while drawing
  overlay.setFocusable(enabled);
});

// Toolbar window is excluded from screen capture so viewers see strokes, not controls
toolbar.setContentProtection(true);
```

**Talking points:**

- Because the overlay sits **on top of the captured screen**, the strokes are **part of the shared video**. No compositing is needed.
- **`setIgnoreMouseEvents(true, { forward: true })`** makes the overlay click-through while still receiving mouse-move events (useful for a laser pointer).
- **`setContentProtection(true)`** hides the toolbar from capture (Windows/macOS).
- **Multi-monitor:** match `display_id` to `screen.getAllDisplays()`. Handle DPI scaling (`display.scaleFactor`) for crisp strokes.
- **Window shares:** the overlay isn't part of a single window's capture, so restrict annotation to full-screen shares or composite strokes yourself.

### How did you implement Picture-in-Picture / an always-on-top mini window?

Options (see the MeetHour doc for the trade-offs):

- **`video.requestPictureInPicture()`:** one video, native PiP window.
- **Document Picture-in-Picture** (`documentPictureInPicture.requestWindow()`): arbitrary HTML, always on top.
- **An Electron always-on-top `BrowserWindow`:** full control.

The Jitsi pattern uses **`window.open` from the call page** (same renderer process when allowed by `setWindowOpenHandler` with `overrideBrowserWindowOptions`), so the mini window can reuse the **same `MediaStream`** objects with no re-negotiation and no IPC of media.

```node
win.webContents.setWindowOpenHandler(({ frameName }) => {
  if (frameName === 'pip') {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 320, height: 180, alwaysOnTop: true, frame: false, resizable: true, skipTaskbar: true,
        webPreferences: { preload: path.join(__dirname, 'pip-preload.js') },
      },
    };
  }
  return { action: 'deny' };
});

// show PiP automatically when the call window is minimised or loses focus
win.on('minimize', () => win.webContents.send('pip:show'));
win.on('restore', () => win.webContents.send('pip:hide'));
```

### How did you implement local recording and save large files safely?

1. **Capture:** the call window or a composited canvas for video, plus mixed audio (Web Audio API). Feed both to **`MediaRecorder`** with timeslices (e.g. 1 s).
2. **Stream to disk:** on every `dataavailable`, send the `ArrayBuffer` chunk through IPC (`invoke('recording:chunk', id, buf)`). The **main process appends** it to a file stream (`fs.createWriteStream`, opened once per recording), or a **utility process** does it to keep main free.
3. Let the user pick the location with **`dialog.showSaveDialog`**, or default to the Videos folder (`app.getPath('videos')`).
4. **Finalise:** close the stream. Optionally fix the WebM duration metadata and remux to MP4 with ffmpeg (bundled binary, or `ffmpeg.wasm` in a worker).
5. **Robustness:** handle app quit during a recording (`before-quit`: stop the recorder and flush), disk-full errors, and crash recovery (partial files are still playable), and show a **recording indicator** for consent.

### How do auto-updates work in Electron? 🔥

- **`electron-updater`** (from electron-builder) or Electron's built-in **`autoUpdater`** (Squirrel on Windows/macOS). They check an update feed: GitHub Releases, S3, a generic HTTPS server or update.electronjs.org.
- **Flow:**
  1. `checkForUpdates()` → `update-available`
  2. download in the background (differential/blockmap downloads in electron-builder)
  3. `update-downloaded` → prompt "Restart to update" → `quitAndInstall()`
- **Requirements:**
  - **Code signing** is mandatory on macOS. On Windows it avoids SmartScreen warnings and is needed for trust.
  - **Signatures are verified** before installing.
  - HTTPS feeds only.
- **Rollout strategy:**
  - **staged rollouts** (percentage), multiple **channels** (stable/beta)
  - never auto-restart **during a call**: wait until idle or let the user choose
  - for a conferencing app, check whether the server-side web app's version is compatible with the desktop shell

### How do you package and distribute an Electron app?

- **Tools:** **electron-builder** (popular: installers, auto-update metadata, code signing) or **Electron Forge** (official, with makers and publishers).
- **Outputs:**
  - Windows: NSIS, MSI, MSIX
  - macOS: DMG/ZIP, **universal builds** (x64 + arm64)
  - Linux: AppImage, deb, rpm, snap, flatpak
- **App code** goes into an **asar** archive (with integrity checks). Unpack native modules or binaries that need real files (`asarUnpack`).
- **Signing:**
  - macOS: a **Developer ID** certificate, **hardened runtime** with **entitlements** (camera, microphone, screen capture usage descriptions), and **notarisation** with Apple's notary service (`notarytool`), followed by stapling
  - Windows: an OV/EV certificate (cloud HSM signing is now common)
- **Native modules** (e.g. a native audio module) must be **rebuilt for Electron's Node ABI** (`@electron/rebuild`). N-API/node-addon-api modules are ABI-stable across versions.
- **Deep links:** `app.setAsDefaultProtocolClient('meethour')` handles `meethour://join/123`. On Windows/Linux the URL arrives in `second-instance` argv; on macOS, through the `open-url` event. Use `app.requestSingleInstanceLock()` so a link opens in the running instance.

## Performance

### How do you improve Electron app performance and memory usage? 🔥

1. **Startup:**
   - load the window quickly (`show: false` + `ready-to-show` to avoid a white flash)
   - lazy-require heavy modules in main
   - keep preload scripts tiny
   - use V8 snapshots or code caching where possible
   - defer non-critical windows such as the PiP or tray UI
2. **Main process:** never block it. Move CPU work to **utility processes**/worker threads. Use async fs APIs. Avoid synchronous IPC.
3. **Renderer:** the same rules as web performance (React render optimisation, virtualisation, workers, code splitting). Avoid memory leaks from listeners registered through the preload; return unsubscribe functions.
4. **Background throttling:** Chromium throttles timers and rAF in hidden or minimised windows. For a call window, set **`backgroundThrottling: false`**, or move timing-critical work (audio meters, stats, effects) into **Web Workers**.
5. **Memory:**
   - each `BrowserWindow` is a renderer process (often 100 MB+), so **reuse or destroy** hidden windows instead of keeping many alive
   - stop `MediaStream` tracks
   - close `AudioContext`s and `RTCPeerConnection`s
   - watch `process.getProcessMemoryInfo()` and `app.getAppMetrics()`
6. **GPU:** keep hardware acceleration on for video. Check `chrome://gpu` in a dev build. Some old GPUs need workarounds (blocklists, `--disable-gpu-*` flags as a last resort).
7. **Upgrade Electron** regularly. Newer Chromium versions bring WebRTC and memory improvements, and security fixes.
8. **Measure:** `contentTracing` (Chromium traces), DevTools Performance and Memory in each renderer, `app.getAppMetrics()` per process.

### Electron vs Tauri vs a PWA: when would you choose each?

| | Electron | Tauri | PWA |
|---|---|---|---|
| Engine | Bundled Chromium + Node | **System WebView** (WebView2, WKWebView, WebKitGTK) + Rust backend | The user's browser |
| Bundle size | Large (~80–150 MB) | Small (a few MB) | None (installable from the web) |
| Rendering consistency | **Identical everywhere** (same Chromium) | Varies per OS WebView (WebRTC support differs) | Varies per browser |
| Native access | Full Node.js + Electron APIs | Rust commands with a capability-based permission model | Limited to web APIs (File System Access, Badging…) |
| Best for | Complex apps needing consistent **WebRTC/screen capture**, mature ecosystem (Slack, VS Code, Teams classic, Jitsi Meet desktop) | Lightweight tools, security-sensitive apps | Apps that the web already serves well |

**For MeetHour:** Electron's bundled Chromium guarantees **consistent WebRTC, codec and screen-capture behaviour** across Windows, macOS and Linux, plus OS-level features (always-on-top PiP, overlays for annotations, global shortcuts for push-to-talk). Those are hard or impossible with system WebViews or a PWA.

### How do you debug and test an Electron app?

- **Renderer:** DevTools (`win.webContents.openDevTools()`), React DevTools (install as an extension in dev builds).
- **Main process:** `--inspect` or `--inspect-brk` → `chrome://inspect`, or VS Code launch configs. Use `electron-log` for file logs users can send.
- **Crash reporting:** `crashReporter.start()` (minidumps → Sentry/Backtrace). Handle `render-process-gone` and `child-process-gone` events to show recovery UI and reload.
- **Testing:**
  - unit-test main and renderer logic separately (Jest/Vitest)
  - **E2E with Playwright's Electron support** (`_electron.launch()`) or WebdriverIO
  - test IPC handlers as pure functions with mocked `event` objects
  - run CI on all three OSes; screen capture and permissions differ a lot between them
