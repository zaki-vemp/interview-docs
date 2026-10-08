# ScaleCapacity Projects Deep Dive

ScaleCapacity is an AWS partner, and these projects show you can build **serverless, document-heavy, security-sensitive** products end-to-end. Interviewers like them because they combine React architecture, cloud integration and real business constraints (legal, privacy, government customers).

> **How to prepare:** for each project, be able to answer five things in under a minute each:
> 1. What problem did it solve, and for whom?
> 2. What was the architecture?
> 3. What did *you* own?
> 4. What was the hardest problem?
> 5. What would you improve?
>
> Placeholders in *[brackets]* need your real details.

## Overview questions

### Give me an overview of the projects you did at ScaleCapacity 🔥

> "At ScaleCapacity I was the senior frontend developer on several AWS serverless products:
>
> - **Nebraska Draw**, a document-management tool built with React, Vite and Jotai on Lambda, API Gateway and DynamoDB.
> - **RBF**, a Race-Blind redaction tool that uses Claude 3.5 Sonnet to detect and redact sensitive details such as names and descriptions of suspects and victims in PDF reports.
> - **LoadOTR**, a logistics dashboard for managing vendors and truck loaders, backed by Node.js.
> - **scQuill**, a secure transcription and translation editor for the Contra Costa County District Attorney's office. It has CKEditor with synchronised audio/video playback, confidence-based highlighting, speaker labels, Word export and Azure AD single sign-on.
> - **SCAI**, our intelligent document processing product, with search, document viewing and indexing for large datasets.
>
> The common thread was building responsive, accessible React UIs on fully serverless AWS back ends, often for government or legal customers where security and accuracy matter a lot."

### What does "serverless" mean in your projects, and what are its trade-offs? 🔥

**Serverless** here means **no servers to manage**. Compute is **AWS Lambda** (functions invoked per request or event). HTTP goes through **API Gateway**. Data lives in managed services such as **DynamoDB** and S3. You pay per request and duration, and scaling is automatic.

| Pros | Cons / what you design around |
|---|---|
| Scales to zero, so it's cheap for spiky government workloads | **Cold starts** (hundreds of ms to seconds), mitigated with provisioned concurrency, small bundles and SnapStart (Java/Python/.NET) |
| No patching or capacity planning | Execution time limit (**15 min** for Lambda; **29 s** default API Gateway integration timeout for REST APIs) |
| Fine-grained IAM per function | Long-running work (LLM calls, big PDFs) needs **async patterns**: SQS, Step Functions, polling or WebSockets |
| Built-in HA across AZs | Harder local development and debugging; distributed tracing (X-Ray) needed |
| Pay per use | Can get expensive at very high steady throughput compared with containers |

**Frontend implications you handled:**

- design for **async jobs** (submit → get job ID → poll or subscribe for status)
- handle **429 throttling** and **5xx** errors with retries and backoff
- upload large files **directly to S3 with pre-signed URLs** instead of through Lambda (API Gateway payloads are limited to 10 MB, and Lambda's synchronous payload to 6 MB)

## Nebraska Draw

### Explain the Nebraska Draw architecture 🔥

```text
React (Vite + Jotai) SPA on S3 + CloudFront
   │  HTTPS (JWT in Authorization header)
   ▼
API Gateway ──► Lambda functions (CRUD, search, permissions, pre-signed URLs)
   │                 │
   │                 ├──► DynamoDB (documents, folders, versions, audit log)
   │                 └──► S3 (file blobs)  ◄── browser uploads/downloads via pre-signed URLs
   ▼
(optional) DynamoDB Streams ──► Lambda (indexing, thumbnails, notifications)
```

**What to say:**

- The UI is a **Vite-built React SPA** hosted on S3 behind CloudFront.
- **Jotai** manages client state: the selected document, filters, upload queue, UI panels.
- Server data is fetched through a data layer *[SWR / React Query / custom hooks]* so caching and loading states stay consistent.
- Documents are stored in S3. Their **metadata lives in DynamoDB**.
- Upload flow:
  1. The client asks the API for a pre-signed PUT URL.
  2. It uploads straight to S3 with progress events.
  3. It confirms with the API, which writes the metadata.
  4. This keeps big files away from Lambda's payload limits.
- **Authorization** is checked in Lambda (or a Lambda/JWT authorizer) against the user's role and the document's permissions.

### Why Jotai instead of Redux for Nebraska Draw? 🔥

- **Atomic model:** state is split into small **atoms**. Components subscribe only to the atoms they use, so re-renders are precise by default. You don't need selectors and memoisation to avoid re-render storms.
- **Little boilerplate:** `const filterAtom = atom('')`. No actions, reducers or provider configuration (a Provider is optional).
- **Derived state** is just another atom: `const visibleDocsAtom = atom((get) => filter(get(docsAtom), get(filterAtom)))`. It's recomputed only when its dependencies change.
- **Async atoms** integrate with Suspense, and `atomFamily` handles per-document state (e.g. upload progress per file).
- **Bundle size:** a few KB.

**Trade-offs, and when you'd still choose Redux:**

- large teams wanting strict conventions
- complex cross-cutting side-effect orchestration (middleware, sagas)
- time-travel debugging needs
- an existing Redux codebase

Jotai's dev tools exist but are less mature than Redux DevTools.

```jsx
import { atom, useAtom, useAtomValue } from 'jotai';
import { atomFamily } from 'jotai/utils';

const docsAtom = atom([]);                       // fetched documents
const searchAtom = atom('');
const visibleDocsAtom = atom((get) => {
  const q = get(searchAtom).toLowerCase();
  return get(docsAtom).filter((d) => d.name.toLowerCase().includes(q));
});
const uploadProgressFamily = atomFamily((fileId) => atom(0)); // one atom per upload

function SearchBox() {
  const [q, setQ] = useAtom(searchAtom);       // re-renders only when search changes
  return <input value={q} onChange={(e) => setQ(e.target.value)} />;
}
function DocList() {
  const docs = useAtomValue(visibleDocsAtom);  // re-renders only when the derived list changes
  return docs.map((d) => <DocRow key={d.id} doc={d} />);
}
```

### Why Vite instead of Create React App or Webpack?

- **Dev server speed:** Vite serves **native ES modules** and pre-bundles dependencies with esbuild. The dev server starts in milliseconds regardless of app size, and **HMR** updates only the changed module.
- **Production build:** an optimised bundle with tree-shaking and code-splitting (historically Rollup; newer Vite versions use the Rust-based **Rolldown**).
- **Simple config**, first-class TypeScript/JSX, env variables with `import.meta.env`, and plugins compatible with the Rollup ecosystem.
- **CRA is deprecated** (the React team stopped recommending it in 2023 and officially deprecated it in early 2025).

### How did you model documents in DynamoDB? 🔥

DynamoDB is designed around **access patterns**. Start from the queries:

| Access pattern | Key design |
|---|---|
| Get a document by ID | `PK = DOC#<id>`, `SK = META` |
| List a folder's documents, newest first | `PK = FOLDER#<folderId>`, `SK = DOC#<createdAt>#<id>` |
| List a user's documents | **GSI1**: `GSI1PK = OWNER#<userId>`, `GSI1SK = <updatedAt>` |
| Document versions | `PK = DOC#<id>`, `SK = VERSION#<n>` (zero-padded so they sort) |
| Filter by status (e.g. "pending review") | **GSI2**: `GSI2PK = STATUS#<status>`, `GSI2SK = <updatedAt>` |

**Points to make:**

- `Query` (by partition key, with sort-key conditions) instead of `Scan` (which reads the whole table).
- **Pagination** with `LastEvaluatedKey` → `ExclusiveStartKey`. Return it to the frontend as an opaque cursor for "Load more" or infinite scroll.
- **Full-text search** isn't DynamoDB's job. Use OpenSearch, populated from DynamoDB Streams, or keep search simple with prefix keys.
- **Conditional writes** (`ConditionExpression: version = :expected`) give **optimistic locking** when two users edit the same metadata.

### How did you handle large file uploads? 🔥

1. The client requests `POST /uploads` → Lambda validates the type and size and returns a **pre-signed S3 PUT URL** (or a pre-signed POST with conditions such as content-length-range). It expires in 5–15 minutes.
2. The browser uploads **directly to S3** with progress tracking (`XMLHttpRequest.upload.onprogress`; `fetch` has no upload progress events).
3. For files over ~100 MB, use **multipart upload**: create the upload, pre-sign each part, upload parts in parallel with retry per part, then complete. Interrupted uploads can resume.
4. Confirm with the API → the metadata record is written (or an **S3 event → Lambda** writes it automatically).
5. Security: validate the MIME type and extension, scan for malware (S3 event → scanner), keep the bucket private, use encryption at rest, and allow downloads only via short-lived pre-signed GET URLs.

```js
// Upload with progress (XHR has upload progress; fetch doesn't)
function uploadWithProgress(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(file);
  });
}
```

## RBF — Race-Blind redaction with Claude

### What is RBF and what problem does it solve? 🔥

**RBF ("Race Blind")** is a tool for preparing **race-blind** versions of documents such as police reports. Sensitive and potentially bias-inducing details are automatically found and redacted before a reviewer reads the document: names of suspects, victims and witnesses, physical descriptions, and other tagged content. *(If this was for a prosecutor's office: California's race-blind charging law, AB 2778, requires prosecutors to use race-blind initial charging reviews, which is exactly this use case. Confirm the context you worked in.)*

**Your part:** the React application. That covers uploading and viewing PDFs, calling the AI pipeline, a **human review UI** to accept, reject or add redactions, and **file management**.

### How does the LLM-based redaction pipeline work end-to-end? 🔥

```text
PDF upload ─► text extraction with positions (PDF.js on the client, or Textract OCR for scanned PDFs)
           ─► chunk text by page/section (respecting token limits)
           ─► Claude 3.5 Sonnet: "return JSON list of entities {text, category, page, occurrence}"
           ─► validate JSON, map each entity back to text items → bounding boxes on the page
           ─► review UI: highlighted boxes, category legend, accept/reject/add manual boxes
           ─► produce the redacted PDF (true redaction: content removed, not just covered)
           ─► audit log: who approved what, model version, timestamps
```

**Key technical points:**

1. **Text with coordinates:** PDF.js `page.getTextContent()` returns text items with a `transform` matrix (x, y, font size). Join items into page text while keeping a **character-offset → item map**. Then any substring the model returns can be mapped back to rectangles.
2. **Prompt for structured output:**
   - Ask for **strict JSON** with categories (`SUSPECT_NAME`, `VICTIM_NAME`, `WITNESS_NAME`, `PHYSICAL_DESCRIPTION`, `ADDRESS`, `RACE_ETHNICITY`…).
   - Ask for the **exact verbatim text** so you can locate it.
   - Include a few examples, and instruct "if unsure, include it", because recall matters more than precision for redaction.
   - Use the API's **tool-use / structured-output** feature where possible instead of parsing free text.
3. **Validation:**
   - Parse with a schema (zod).
   - Drop entities whose text isn't found on the page; this guards against hallucination.
   - Find **all occurrences** of each name, not just the first.
4. **Consistent pseudonyms:** replace "John Smith" with "Suspect 1" everywhere, so the document stays readable while staying blind.
5. **Human in the loop:** the model is an assistant, not the final authority. A reviewer must approve, and the UI makes misses easy to add manually.

### Why is drawing a black rectangle over text not a real redaction? 🔥

The original text is **still in the PDF's content stream** underneath the rectangle. Anyone can select and copy it, search it, or extract it with a tool. Real-world data leaks have happened exactly this way.

**Real redaction must remove the content:**

- **Server-side redaction libraries** remove text, images and vector content inside the redaction areas and then burn in the boxes. Examples: PyMuPDF's `add_redact_annot()` + `apply_redactions()`, Apryse/PDFTron, iText pdfSweep.
- **Rasterise** pages: render each page to an image with boxes painted on, then rebuild the PDF from the images. The text layer disappears; run OCR afterwards if searchability is needed.
- Also strip **metadata**, annotations, bookmarks, attachments and form fields that may contain the same data.

Verify the output by extracting text from the redacted PDF in an automated test and asserting that the redacted strings are absent.

### How did you map LLM results back to positions in the PDF? 🔥

```js
// Build page text + an index from character offsets back to PDF.js text items
function buildIndex(items) {
  let text = '';
  const spans = []; // { start, end, itemIndex }
  items.forEach((it, i) => {
    const start = text.length;
    text += it.str;
    spans.push({ start, end: text.length, itemIndex: i });
    text += it.hasEOL ? '\n' : ' ';
  });
  return { text, spans };
}

// Find every occurrence of an entity and return the items it covers
function locate(entity, { text, spans }) {
  const hits = [];
  const needle = entity.toLowerCase();
  const hay = text.toLowerCase();
  for (let pos = hay.indexOf(needle); pos !== -1; pos = hay.indexOf(needle, pos + 1)) {
    const end = pos + needle.length;
    const covered = spans.filter((s) => s.start < end && s.end > pos).map((s) => s.itemIndex);
    hits.push({ start: pos, end, items: covered });
  }
  return hits;
}

const items = [
  { str: 'Officer saw John', hasEOL: false },
  { str: 'Smith near Elm St.', hasEOL: true },
  { str: 'John Smith fled.', hasEOL: true },
];
const idx = buildIndex(items);
const hits = locate('John Smith', idx);
console.log(idx.text);
console.log(hits);

test('finds both occurrences, including one split across text items', () => {
  expect(hits).toHaveLength(2);
  expect(hits[0].items).toEqual([0, 1]);
  expect(hits[1].items).toEqual([2]);
});
```

**Talking points:**

- Entities can be **split across text items**; the first occurrence above spans two items.
- For **partial-item highlights**, measure substring widths with `canvas.measureText` using the item's font size. Alternatively, cover the whole item and let the reviewer adjust.
- Convert PDF coordinates (origin bottom-left, in points) to viewport coordinates with `viewport.convertToViewportRectangle()` before drawing overlays.

### How did you handle long documents and the model's limits?

- **Chunk by page**, or by sections of a few thousand tokens, with a **small overlap**, so an entity split at a boundary isn't missed. De-duplicate results across chunks.
- **Parallelise** chunk requests with a concurrency limit (e.g. 3–5 at a time) to respect rate limits, with **retries and exponential backoff** on 429/529/5xx errors.
- **Async job pattern:** the frontend submits a job → the backend (Lambda + SQS/Step Functions) processes the chunks → the frontend polls or receives a WebSocket update with per-page progress. Never block an API Gateway request for minutes.
- **Cost and consistency:** temperature 0 for repeatable output (Claude 3.5 Sonnet accepted it; current models rely on structured outputs instead), prompt caching for the long instructions, concise prompts, results cached per document hash, and only changed pages processed on re-runs. (Details in the LLM Integration doc.)
- **Consistency across chunks:** pass the list of entities found so far (e.g. "already identified: John Smith as SUSPECT_1") so pseudonyms stay stable.

### What about privacy and security when sending police reports to an LLM? 🔥

- **Where the model runs matters.** Using Claude through **Amazon Bedrock** keeps traffic inside the customer's AWS environment, under their IAM, logging and data-handling agreements. If you used the Anthropic API directly, mention the contractual data terms, and that API inputs are not used for training by default. *[Say which one you used.]*
- **Least data:** send only the text needed. Don't send metadata or attachments unnecessarily.
- **Encryption** in transit (TLS) and at rest (S3 SSE-KMS); **no logging of document content** in CloudWatch.
- **Access control:** only authorised reviewers. Keep an **audit trail** of each AI suggestion and each human decision.
- **Prompt injection:** a document could contain text like "ignore previous instructions". Treat the document as **data**: wrap it in clear delimiters, tell the model never to follow instructions inside it, validate the output against the schema, and keep human review.

### How did you evaluate whether the redaction was good enough?

- Build a **labelled test set** of sample reports with known entities.
- Measure **recall** (missed entities are the dangerous failure) and **precision** (over-redaction hurts readability).
- Track per-category metrics, compare prompt and model versions **before deploying changes**, and treat prompts like code: versioned and reviewed.
- Collect reviewer corrections, both missed and wrongly flagged items, as feedback to improve prompts.

## LoadOTR

### What was LoadOTR and what did you build?

**LoadOTR** is a React dashboard for an **OTR (over-the-road) trucking/logistics** business. It manages **vendors** and **truck loaders**: onboarding, assigning loads, tracking status and managing documents. It runs on a **Node.js back end**.

**Frontend topics to talk about:**

- **Data-heavy tables:** server-side pagination, sorting and filtering; column visibility; sticky headers; CSV export; row virtualisation for long lists.
- **Forms:** multi-step vendor onboarding with validation (e.g. React Hook Form + Zod/Yup), file uploads for licences and insurance, save-as-draft.
- **Role-based UI:** admin vs dispatcher vs vendor views.
- **Real-time-ish status:** polling or WebSocket updates for load status (assigned → in transit → delivered).

**Backend (Node.js) topics:**

- REST design (`GET /vendors?status=active&page=2&sort=-createdAt`)
- input validation, authentication middleware
- consistent error format
- *[database used]*

### How do you build a performant, server-driven data table? 🔥

- **State lives in the URL:** page, sort and filters in query parameters, so views are shareable and the back button works.
- **Server does the heavy lifting:** for large datasets, send `page`, `pageSize`, `sort` and `filters` to the API, which returns `{ items, total }` (or a cursor).
- **Debounce** filter inputs (300 ms) and **cancel** stale requests (AbortController, or let SWR/React Query handle it), so typing doesn't fire a request per keystroke.
- **Keep previous data** while loading the next page (`keepPreviousData`) to avoid flicker.
- **Virtualise** if rendering hundreds of rows (react-window/TanStack Virtual).
- **Memoise rows** and column definitions; keep stable keys.
- **Accessibility:** a real `<table>` with `<th scope>`, `aria-sort` on sortable headers, keyboard-reachable controls.

```js
// Debounced search that ignores out-of-order responses (works in the playground)
function createSearch(fetcher, delay = 300) {
  let timer;
  let latest = 0;
  return (query, onResult) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const id = ++latest;
      const data = await fetcher(query);
      if (id === latest) onResult(data); // drop stale responses
    }, delay);
  };
}

const fakeApi = (q) => new Promise((r) => setTimeout(() => r(`results for "${q}"`), q.length === 1 ? 300 : 50));
const search = createSearch(fakeApi, 100);
const seen = [];
search('a', (r) => seen.push(r));
setTimeout(() => search('ab', (r) => seen.push(r)), 150); // the 'a' request is still in flight

test('only the latest response is applied', async () => {
  await new Promise((r) => setTimeout(r, 700));
  expect(seen).toEqual(['results for "ab"']);
});
```

## scQuill — transcription editor

### Describe scQuill and your role 🔥

**scQuill** is a secure **transcription and translation** platform for the **Contra Costa County District Attorney's office**. Staff review and edit machine-generated transcripts of audio and video evidence (interviews, body-cam footage, calls), often in multiple languages, and export court-ready Word documents.

**What you built on the frontend:**

- a **side-by-side editor**: CKEditor transcript next to an audio/video player
- **synchronised playback**: the current word is highlighted; click a word to seek
- **confidence-based word highlighting**: low-confidence words are flagged for review
- **speaker identification** display (Speaker 1, Speaker 2, or names)
- **Word (.docx) export**
- **Azure AD single sign-on** via MSAL
- a focus on **performance, accessibility and UX**, in a 100% serverless AWS environment

### How did you synchronise the transcript with media playback? 🔥

**Data:** speech-to-text engines return **word-level items** with start and end times, confidence and speaker labels. For example, Amazon Transcribe returns items with `start_time`, `end_time`, `alternatives[0].confidence`, and speaker labels when speaker identification is on.

**Media → text (highlight the current word):**

1. Listen to the media element's `timeupdate` event. It fires roughly every 15–250 ms depending on the browser, which is too coarse for smooth highlighting. Alternatively, run a `requestAnimationFrame` loop while playing, or use `requestVideoFrameCallback` for video.
2. **Binary search** the sorted word start times for `currentTime`. That's O(log n), which matters for 10k-word transcripts.
3. Toggle a highlight class **only when the active word changes**. Don't re-render the whole editor.

**Text → media (click to seek):** each word span carries `data-start`. On click (or a keyboard shortcut), set `media.currentTime = start` and play.

```js
// Find the word being spoken at time t (sorted by start time)
function activeWordIndex(words, t) {
  let lo = 0, hi = words.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans !== -1 && t <= words[ans].end ? ans : -1; // -1 = silence between words
}

const words = [
  { w: 'Where', start: 0.0, end: 0.4, conf: 0.99 },
  { w: 'were', start: 0.45, end: 0.7, conf: 0.97 },
  { w: 'you', start: 0.72, end: 0.9, conf: 0.62 },
  { w: 'Tuesday', start: 1.5, end: 2.1, conf: 0.88 },
];
console.log(activeWordIndex(words, 0.5), activeWordIndex(words, 1.2), activeWordIndex(words, 1.9));

test('binary search finds the active word or -1 in silence', () => {
  expect(activeWordIndex(words, 0.0)).toBe(0);
  expect(activeWordIndex(words, 0.8)).toBe(2);
  expect(activeWordIndex(words, 1.2)).toBe(-1);
  expect(activeWordIndex(words, 2.0)).toBe(3);
});
```

### How do you keep timing data when users edit the transcript in CKEditor? 🔥

This is the hard part. Free-text editing destroys word-to-timestamp alignment unless the data lives **in the editor model**.

- **CKEditor 5 has a model–view architecture.** Extend the schema so text can carry attributes:
  `editor.model.schema.extend('$text', { allowAttributes: ['wordStart', 'wordEnd', 'confidence', 'speaker'] })`.
- Add **conversion** (`attributeToElement`) so these attributes render as `<span data-start="…" data-conf="…">` in the editing view, and **upcast** them back when loading.
- When a user **edits inside a word**, CKEditor keeps the attribute on the remaining characters. Typed text inherits the selection's attributes, which you can control. The usual policy is:
  - edited words keep their timestamps
  - edited words are marked **human-verified**, so confidence becomes "verified" and the highlight is removed
  - inserted new words get the timestamp range of their neighbours
- **Speaker turns** are modelled as blocks (paragraphs with a `speaker` attribute) rendered with a label. Changing a speaker label updates every block for that speaker.
- **Highlighting the active word** uses CKEditor **markers** or direct view manipulation. Avoid model changes for highlighting, because they would pollute undo history.

### How did confidence-based highlighting work?

- Each word has a confidence between 0 and 1 from the speech engine.
- Thresholds such as **< 0.70 → red underline** and **0.70–0.90 → amber** mark words that need human attention. The thresholds were configurable *[fill in the real values]*.
- Highlights come from CSS classes on the word spans, **not** by changing text formatting, so they **don't export to Word**.
- **"Next low-confidence word"** navigation (a keyboard shortcut) jumps the cursor and media to the next uncertain word, which speeds up review a lot.
- Once a user edits or confirms a word, its status becomes *verified* and the highlight disappears.
- **Accessibility:** colour isn't the only signal. Use underline styles, plus a tooltip/`aria-describedby` such as "low confidence (62%)".

### How did you implement Word document export?

Options, and the trade-offs to discuss:

1. **Client-side with the `docx` npm library:** build `Document → Paragraph → TextRun` from the editor model (speaker labels in bold, timestamps, headers with case number, page numbers), then `Packer.toBlob()` and download. **Pros:** no server; the document never leaves the browser, which matters for evidence. **Cons:** large bundle (lazy-load it).
2. **CKEditor's Export to Word** (premium feature) converts the editor's HTML through a conversion service. Easy, but sending sensitive content to a third-party converter may be unacceptable for a DA's office.
3. **Server-side Lambda** (e.g. a docx library in Node, or Pandoc in a container). Central templating and headers, but it needs secure handling of the data.

*[Say which you used and why. For legal evidence, "keep content inside our AWS boundary" is a strong reason.]*

### How did you implement SSO with Microsoft Azure AD (Entra ID)? 🔥

- **Library:** MSAL.js (`@azure/msal-browser` + `@azure/msal-react`), using the **OAuth 2.0 Authorization Code flow with PKCE**. This is the recommended flow for SPAs; the implicit flow is deprecated.
- **App registration** in Entra ID: an SPA redirect URI, exposed API scopes, and app roles or group claims for authorisation.
- **Flow:**
  1. `loginRedirect()` sends the user to Microsoft.
  2. Microsoft returns an auth code.
  3. MSAL exchanges the code (with the PKCE verifier) for an **ID token** (who the user is) and an **access token** (for your API).
  4. Before each API call, `acquireTokenSilent({ scopes })` returns a cached or refreshed token. If that requires interaction (consent, MFA), fall back to `acquireTokenRedirect`.
- **API side:** API Gateway's **JWT authorizer** (HTTP API) or a Lambda authorizer validates the token's signature against Microsoft's JWKS, plus `iss` (the tenant), `aud` (your API's client ID/URI) and expiry. Lambdas then read **roles/groups claims** for authorisation.
- **Token storage:** MSAL caches in `sessionStorage` (configurable) or memory, never cookies you manage yourself. Keep tokens short-lived, and keep XSS defences strong (CSP), because XSS can read web storage.
- **Logout:** `logoutRedirect()` clears the local cache and the Entra session.

```jsx
// main.tsx
const msal = new PublicClientApplication({
  auth: { clientId: '<app-id>', authority: 'https://login.microsoftonline.com/<tenant-id>', redirectUri: '/' },
  cache: { cacheLocation: 'sessionStorage' },
});
root.render(<MsalProvider instance={msal}><App /></MsalProvider>);

// api.ts — attach a fresh access token to every request
async function authFetch(url, init = {}) {
  const account = msal.getActiveAccount();
  const { accessToken } = await msal.acquireTokenSilent({ scopes: ['api://scquill/Transcripts.ReadWrite'], account });
  return fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}` } });
}
```

### How did you make scQuill accessible and fast for long transcripts?

**Accessibility:**

- **keyboard-first workflow:** play/pause, back 5 s, forward 5 s, next low-confidence word, change speaker
- proper labels on the player controls
- focus management between the editor and the player
- sufficient contrast for highlights
- captions/transcript semantics
- screen-reader announcements of the current speaker turn

**Performance for hour-long recordings (10k+ words):**

- avoid re-rendering the editor on every `timeupdate`; update only the previously and newly active word spans
- binary search for the active word
- debounce autosave
- lazy-load the export library
- split the transcript into speaker-turn blocks
- stream or paginate loading of very long transcripts

## SCAI — Intelligent Document Processing

### What is SCAI and what did you build? 🔥

**SCAI** is ScaleCapacity's **Intelligent Document Processing (IDP)** product. Documents (forms, invoices, records) are ingested, **OCR'd and classified**, **key fields are extracted**, low-confidence results go to human review, and documents are **indexed for search**.

**Your frontend work** (React, Redux, Vite):

- **advanced search** with filters and facets
- **document viewing** with extracted fields overlaid on the page
- **data indexing** views
- real-time interaction (processing status)
- accessibility improvements
- **performance for large datasets**

You collaborated with AWS engineers on the serverless back end (Lambda, API Gateway, DynamoDB).

**A typical IDP pipeline to describe** (adapt to SCAI's real one):

```text
S3 upload ─► Lambda/Step Functions ─► Textract (OCR, forms, tables) ─► classification/extraction
         ─► confidence check ─► human review queue (low confidence) ─► DynamoDB (fields) + search index
```

### How do you show extracted fields on top of the document?

- OCR services return **geometry** for each word, line or key-value pair. Textract returns `BoundingBox: { Left, Top, Width, Height }` **normalised to 0–1** of the page size, plus polygons.
- Render the page (an image, or a PDF.js canvas) and an **absolutely positioned overlay layer**. Each box's CSS is `left: Left*100%`, `top: Top*100%`, `width: Width*100%`, `height: Height*100%`. Normalised coordinates make it **zoom-independent**.
- **Hovering or clicking** a field in the side panel highlights its box and scrolls the page into view, and the reverse works too.
- Show the **confidence** on each field. Editing a field marks it as human-corrected.
- For multi-page documents, **virtualise pages**: render only visible pages and use placeholders with known heights for the rest.

### How did you optimise search and large result sets? 🔥

- **Server-side search** (OpenSearch, or DynamoDB with GSIs for structured filters) with pagination or cursors. The browser never loads everything.
- **Debounced queries**; cancel stale requests; **cache** previous queries (SWR/RTK Query), so going back is instant.
- **Facets and filters in the URL** for shareable searches.
- **Virtualised result lists** (react-window), **skeleton loaders**, and highlighting matched terms (the server returns highlight fragments).
- **Memoised selectors** in Redux (`createSelector`) so filter and sort derivations don't recompute on unrelated updates.
- **Web Workers** for heavy client-side work, e.g. parsing a large CSV export or computing aggregates, so the UI thread stays responsive.

### How did the UI show real-time processing status?

Options:

- **Polling** with backoff: simple and good enough for jobs measured in minutes. Poll `GET /jobs/:id` every 2 s, back off to 10 s, and stop on completion.
- **API Gateway WebSocket API:** the client connects; the processing Lambda posts updates to the connection ID through the management API. True push, with more moving parts (storing connection IDs in DynamoDB, cleaning them up).
- **AppSync subscriptions** (GraphQL) if the stack uses AppSync.

The UI shows per-document stages (uploaded → OCR → extracting → needs review → done), with optimistic updates and toasts on completion.

## Cross-project questions

### How did you unit test React components with Enzyme, Jasmine and Karma?

- **Karma** is the **test runner**. It launches real browsers (ChromeHeadless), serves the bundled tests and reports results.
- **Jasmine** is the **test framework**: `describe`/`it`, `expect` matchers, and spies (`spyOn(obj, 'method').and.returnValue(...)`).
- **Enzyme** renders React components. `shallow` renders one level deep (children aren't rendered), `mount` does a full DOM render, and `render` produces static HTML. You find nodes with selectors and simulate events.
- **Today:** Enzyme is effectively **dead for React 18+** (there's no official adapter). The industry moved to **React Testing Library** with **Jest or Vitest**, testing behaviour ("user clicks Save, sees a toast") instead of implementation details (state and instance methods). Say you know both and would choose RTL for new code.

(The Testing document has examples of both.)

### How were these projects deployed? What was the CI/CD process?

A typical setup to describe (adapt to yours):

- **Git** with a branching model (feature branches → PR → main), with code review required.
- **Jenkins** pipelines (or AWS CodePipeline/GitHub Actions): install with **Yarn**, lint, type-check, unit tests, build.
- **Frontend deployment:** upload the build to **S3**, then invalidate **CloudFront**. Hashed asset filenames get long cache lifetimes; `index.html` gets `no-cache`.
- **Backend:** Lambdas and infrastructure via **SAM/CDK/Serverless Framework**, with environment stages (dev → staging → prod).
- **Docker** for services that needed containers, and for consistent build environments.

### What was the hardest technical problem across these projects, and how did you solve it? 🔥

Strong choices:

- **RBF:** reliably mapping LLM output back to PDF coordinates, and ensuring *true* redaction.
- **scQuill:** keeping timestamps aligned while users freely edit in CKEditor.
- **SCAI:** performance with large documents and result sets.

Answer with **STAR**. Include one thing that **didn't work at first**, for example: "My first approach highlighted words by re-rendering spans on every `timeupdate`, and it lagged badly on long transcripts. I moved to a binary search plus direct DOM class toggling only on change, and the lag disappeared."
