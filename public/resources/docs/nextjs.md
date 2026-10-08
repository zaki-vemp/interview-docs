# Next.js (App Router)

Next.js is on your skills list, and many product companies use it, so expect questions on **rendering strategies, Server vs Client Components, data fetching and caching, Server Actions, middleware and deployment**. This page focuses on the **App Router** (the default since Next.js 13.4) and notes the **Pages Router** equivalents, because many existing codebases still use it.

> Next.js changes quickly. Caching defaults changed in **v15**, and **v16** introduced Cache Components (`'use cache'`) and renamed `middleware.ts` to `proxy.ts`. In interviews, say which version you're describing, and check the version the company uses.

## Fundamentals

### What is Next.js and why use it over a plain React SPA? 🔥

Next.js is a **full-stack React framework**. It adds:

- **File-system routing** with nested layouts
- **Multiple rendering strategies per route:** static (SSG), incremental static regeneration (ISR), server-side rendering (SSR), streaming, and client-side rendering
- **React Server Components** and **Server Actions**
- **Backend endpoints** (Route Handlers)
- **Middleware/proxy** that runs before requests
- **Built-in optimisations:** `next/image`, `next/font`, `next/script`, automatic code splitting, prefetching
- Bundling with **Turbopack**/webpack, TypeScript, CSS Modules and Tailwind out of the box
- Deployment anywhere (Vercel, Node server, Docker, static export)

**Why it matters:** **SEO and fast first loads** (HTML from the server), **less client JavaScript** (RSC), and **one codebase** for UI plus backend-for-frontend.

**When you might *not* use it:**

- a pure **app behind a login** where SEO is irrelevant and the experience is highly interactive and real-time, like the MeetHour meeting UI itself
- **Electron/desktop** apps
- teams that want a simple **Vite SPA** with a separate API

A hybrid is common: Next.js for marketing, docs and dashboards, and a SPA for the real-time core.

### App Router vs Pages Router: what's the difference? 🔥

| | Pages Router (`pages/`) | App Router (`app/`) |
|---|---|---|
| Components | All client components (hydrated) | **Server Components by default**; opt in with `'use client'` |
| Data fetching | `getStaticProps`, `getServerSideProps`, `getStaticPaths`, client fetch | `async` server components + `fetch`/DB calls, `generateStaticParams`, caching config |
| Layouts | `_app.js`/`_document.js`, manual per-page layouts | **Nested `layout.tsx`** that persists state across navigation |
| Loading/error UI | Manual | `loading.tsx` (Suspense) and `error.tsx` (error boundary) per segment |
| Streaming | Limited | Built-in (Suspense) |
| Mutations | API routes | **Server Actions** + Route Handlers |
| Backend endpoints | `pages/api/*` | `app/**/route.ts` (Route Handlers, Web `Request`/`Response`) |
| Router hooks | `next/router` | `next/navigation` (`useRouter`, `usePathname`, `useSearchParams`) |

Both can coexist in one project during migration.

### Explain the App Router file conventions 🔥

```text
app/
├─ layout.tsx            # root layout (required): <html><body>, persists across navigations
├─ page.tsx              # "/" — a route is public only if it has page.tsx (or route.ts)
├─ loading.tsx           # Suspense fallback for this segment (instant loading state while streaming)
├─ error.tsx             # error boundary for this segment ('use client'), gets { error, reset }
├─ not-found.tsx         # rendered by notFound()
├─ global-error.tsx      # catches errors in the root layout
├─ (marketing)/          # route group: organises routes / layouts without affecting the URL
│   └─ pricing/page.tsx  # "/pricing"
├─ meetings/
│   ├─ layout.tsx        # nested layout shared by /meetings/*
│   ├─ page.tsx          # "/meetings"
│   ├─ [id]/page.tsx     # dynamic segment: "/meetings/123" -> params.id
│   └─ [id]/recordings/[...slug]/page.tsx   # catch-all
├─ docs/[[...slug]]/page.tsx                 # optional catch-all ("/docs" too)
├─ @modal/(.)photo/[id]/page.tsx             # parallel route slot + intercepting route (modal over a feed)
├─ api/webhooks/route.ts # Route Handler: export async function POST(req: Request) {}
└─ template.tsx          # like layout but re-mounts on navigation (no persisted state)
```

**Also:** `middleware.ts`/`proxy.ts` at the project root, `instrumentation.ts` (OpenTelemetry, startup hooks), `opengraph-image.tsx`, `sitemap.ts`, `robots.ts`.

### Server Components vs Client Components in Next.js 🔥

**Server Components** (the default in `app/`):

- Render on the server and send **no JS** to the client for themselves.
- Can be `async` and fetch data directly: databases, internal APIs, secrets.
- Can't use state, effects, event handlers or browser APIs.

**Client Components** (`'use client'` at the top of the file):

- Interactive: hooks, event handlers, browser APIs.
- They are **still pre-rendered to HTML on the server**, then hydrated.
- **`'use client'` marks a boundary.** Every module imported *from* a client component becomes client code too.

**Composition rules:**

- **Push `'use client'` to the leaves.** Keep pages and layouts as server components and make small interactive islands client components (`<LikeButton>`, `<VideoPlayer>`).
- Server components **can pass server components as `children`** to client components (the "donut" pattern, e.g. a client `<Modal>` wrapping server-rendered content).
- Props from server to client components must be **serialisable**: no functions except Server Actions, no class instances, no Dates in some versions (pass ISO strings).
- Protect server-only code with **`import 'server-only'`**, so an accidental client import fails the build. Never send secrets in props.

```tsx
// app/meetings/[id]/page.tsx — Server Component
import { getMeeting } from '@/lib/db';          // runs on the server only
import { JoinButton } from './JoinButton';      // client component

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;                  // Next 15+: params is async
  const meeting = await getMeeting(id);         // direct DB access, no API round trip
  if (!meeting) notFound();
  return (
    <article>
      <h1>{meeting.title}</h1>
      <JoinButton meetingId={meeting.id} />      {/* only this ships JS */}
    </article>
  );
}

// app/meetings/[id]/JoinButton.tsx
'use client';
export function JoinButton({ meetingId }: { meetingId: string }) {
  const [joining, setJoining] = useState(false);
  return <button disabled={joining} onClick={() => { setJoining(true); location.href = `/m/${meetingId}`; }}>Join</button>;
}
```

## Rendering & data

### Explain SSG, ISR, SSR, CSR, streaming and PPR in Next.js 🔥

| Strategy | When HTML is generated | App Router trigger | Pages Router | Use for |
|---|---|---|---|---|
| **SSG (static)** | At **build** time | Default when the route uses no dynamic APIs and its data is cached/static; `generateStaticParams` for dynamic segments | `getStaticProps` + `getStaticPaths` | Marketing, docs, blogs |
| **ISR** | At build time, then **regenerated in the background** after N seconds or on demand | `export const revalidate = 60`, `fetch(url, { next: { revalidate: 60 } })`, or `revalidatePath`/`revalidateTag` | `revalidate` in `getStaticProps` | Product pages, catalogues, CMS content |
| **SSR (dynamic)** | **Per request** | Using `cookies()`, `headers()`, `searchParams`, uncached fetches, `connection()`, or `export const dynamic = 'force-dynamic'` | `getServerSideProps` | Personalised, real-time, auth-dependent pages |
| **CSR** | In the browser | Client components fetching in effects (or SWR) | same | Highly interactive, private views |
| **Streaming** | Shell first, then chunks as data resolves | `loading.tsx` or `<Suspense>` around slow parts | limited | Pages with slow sections |
| **PPR** (Partial Prerendering) | **Static shell** at build time + **dynamic holes** streamed per request | Suspense boundaries around dynamic parts (Cache Components in v16) | — | Mostly-static pages with personalised bits (cart, user menu) |

**Talking point:** in the App Router, rendering is decided **per route, from what the code uses**. Calling `cookies()` makes the route dynamic. With PPR / Cache Components the decision becomes **per component**: static by default, with dynamic parts wrapped in Suspense.

### How does data fetching work in the App Router? How do you avoid waterfalls? 🔥

- Fetch **in server components** with `await`, close to where the data is used. Use `fetch` or a DB/ORM client directly.
- **Request memoisation:** identical `fetch` calls (same URL and options) during **one render pass** are **deduplicated**. Several components can request the same data without prop drilling. For non-fetch functions, wrap them in **React `cache()`**.
- **Avoid sequential waterfalls:** start independent requests in parallel with `Promise.all`, or start promises early and `await` them later.
- **Stream slow parts:** wrap the slow component in `<Suspense>` so the rest of the page renders immediately.
- **Client-side fetching** (SWR/TanStack Query in client components) for user-specific, frequently changing or interactive data.

```tsx
export default async function Dashboard() {
  // ❌ Waterfall: total time = user + meetings + recordings
  // const user = await getUser(); const meetings = await getMeetings(); ...

  // ✅ Parallel
  const [user, meetings] = await Promise.all([getUser(), getMeetings()]);
  return (
    <>
      <Header user={user} />
      <MeetingList meetings={meetings} />
      <Suspense fallback={<RecordingsSkeleton />}>
        <Recordings userId={user.id} />   {/* async server component, streams in later */}
      </Suspense>
    </>
  );
}

const getUser = cache(async () => db.user.findUnique({ where: { id: await currentUserId() } })); // dedupe per request
```

### Explain Next.js caching layers and how invalidation works 🔥

The App Router has (or had) **four** caching mechanisms:

| Cache | Where | What | Duration | Invalidate with |
|---|---|---|---|---|
| **Request memoisation** | Server, per request | Return values of identical `fetch` calls / `cache()`-wrapped functions in one render | One request | — (automatic) |
| **Data Cache** | Server, persistent across requests and deploys | `fetch` responses (when opted in with `cache: 'force-cache'` or `next.revalidate`) | Until revalidated | `revalidate` time, `revalidateTag(tag)`, `revalidatePath(path)` |
| **Full Route Cache** | Server | Rendered HTML + RSC payload of **static** routes | Until revalidated or redeployed | Revalidating the data it depends on |
| **Router Cache** | **Client**, in memory | RSC payloads of visited/prefetched segments for instant back/forward navigation | Session (stale times configurable) | `router.refresh()`, Server Action revalidation, `cookies.set` |

**Version changes to mention:**

- **Next 15:** `fetch` is **not cached by default** (`no-store`), **GET Route Handlers aren't cached by default**, and the **client Router Cache doesn't reuse page segments by default** (`staleTimes.dynamic = 0`). This reversed the very aggressive v13/14 defaults that confused people.
- **Next 16 (Cache Components):** the explicit **`'use cache'` directive** caches a component, function or page, with `cacheLife()` profiles and `cacheTag()` for invalidation. Everything else is dynamic by default and streams through Suspense. Caching becomes opt-in and explicit.

```tsx
// Tag-based on-demand revalidation (works in 14/15)
const res = await fetch(`${API}/meetings`, { next: { tags: ['meetings'], revalidate: 3600 } });

// In a Server Action or webhook Route Handler after a change:
import { revalidateTag, revalidatePath } from 'next/cache';
revalidateTag('meetings');            // every fetch tagged 'meetings' is refetched on next request
revalidatePath('/meetings');          // re-render this path
```

### What are Server Actions and how do you use them safely? 🔥

**Server Actions** (Server Functions) are `async` functions marked **`'use server'`**. Next.js turns them into **POST endpoints** that you can call from forms or client code.

- **Forms:** `<form action={createMeeting}>` works **without JS** (progressive enhancement), and the action receives `FormData`.
- **After a mutation:** `revalidatePath`/`revalidateTag` refresh the data, and `redirect()` navigates.
- **With React 19 hooks:** `useActionState` (result and pending state), `useFormStatus`, `useOptimistic`.

**Security (very important):**

- **Every Server Action is a public endpoint**, callable by anyone who finds its ID.
- **Authenticate and authorise inside the action**, every time. A hidden button is not a permission check.
- **Validate input** with zod. Never trust `FormData` or arguments.
- Return **minimal, non-sensitive data**.
- Next.js includes **CSRF protection** (Origin vs Host check for POST requests) and encrypts closed-over variables, but authorisation is your responsibility.

```tsx
// app/meetings/actions.ts
'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

const Schema = z.object({ title: z.string().min(3).max(120), startsAt: z.coerce.date() });

export async function createMeeting(_prev: { error?: string } | null, formData: FormData) {
  const session = await auth();                               // 1. authenticate
  if (!session?.user.canSchedule) return { error: 'Not allowed' }; // 2. authorise
  const parsed = Schema.safeParse(Object.fromEntries(formData));   // 3. validate
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const meeting = await db.meeting.create({ data: { ...parsed.data, ownerId: session.user.id } });
  revalidatePath('/meetings');                                // 4. refresh cached data
  redirect(`/meetings/${meeting.id}`);                        // 5. navigate (throws internally)
}

// app/meetings/new/page.tsx
'use client';
export default function NewMeeting() {
  const [state, action, pending] = useActionState(createMeeting, null);
  return (
    <form action={action}>
      <input name="title" required />
      <input name="startsAt" type="datetime-local" required />
      <button disabled={pending}>{pending ? 'Scheduling…' : 'Schedule'}</button>
      {state?.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
```

### Route Handlers vs Server Actions: when do you use each?

- **Server Actions** handle **mutations triggered by your own UI**: forms, buttons. They're tightly integrated with revalidation and React's action hooks. They use POST only and aren't meant as a public API contract.
- **Route Handlers** (`app/api/**/route.ts`, exporting `GET`/`POST`/…) are **HTTP endpoints for anyone**:
  - webhooks (Stripe, Jibri finalize callbacks)
  - **public or mobile APIs**
  - **GET** endpoints for client-side fetching (SWR)
  - file downloads and streaming responses (SSE, LLM streaming)
  - OAuth callbacks
  - things needing custom headers or status codes
- **Don't** call your own Route Handlers from Server Components. Call the underlying function directly, which avoids an extra HTTP hop.

## Routing, middleware & runtime

### What is middleware (proxy) in Next.js and what is it good for? 🔥

`middleware.ts` (renamed **`proxy.ts`** in Next.js 16) runs **before a request is matched to a route**, for paths selected with `config.matcher`. It can **rewrite, redirect, set headers and cookies, or return a response early**.

**Good uses:**

- **auth gating** (redirect to `/login` if there's no session cookie)
- **i18n locale detection**
- **A/B testing and feature flags** (rewrite to variants)
- bot protection and geo-based routing
- adding security headers

**Limitations:**

- It runs on **every matched request**, so keep it **fast**. Historically it ran on the **Edge runtime**, with no full Node APIs and no heavy DB calls; newer versions allow the Node runtime.
- **Don't rely on middleware alone for authorisation.** Check again in the data layer, Server Actions and Route Handlers. A security advisory in 2025 (CVE-2025-29927) showed that middleware could be bypassed with a crafted header in vulnerable versions, which is a good real-world example of defence in depth.

```tslib
// middleware.ts (proxy.ts in v16)
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const session = req.cookies.get('session')?.value;
  if (!session && req.nextUrl.pathname.startsWith('/dashboard')) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  res.headers.set('X-Frame-Options', 'DENY');
  return res;
}
export const config = { matcher: ['/dashboard/:path*', '/meetings/:path*'] };
```

### How does navigation and prefetching work in the App Router?

- **`<Link href>`** does client-side navigation. It **prefetches** routes when the link enters the viewport, in production only. For dynamic routes, it prefetches the shared layout and `loading.tsx` boundary, so navigation shows an instant loading state.
- **Navigation is soft:** only the segments that change are re-rendered and fetched as RSC payloads. **Shared layouts keep their state** (an open sidebar, a playing video).
- **Hooks from `next/navigation`:**
  - `useRouter()` (`push`, `replace`, `refresh`, `back`, `prefetch`)
  - `usePathname()`, `useSearchParams()` (wrap the component in `<Suspense>` on static routes), `useParams()`, `useSelectedLayoutSegment()`
- **Server-side:** `redirect('/x')`, `permanentRedirect()` and `notFound()` throw special errors that Next.js handles.

### How do you handle authentication in a Next.js App Router app? 🔥

**Layered approach:**

1. **Session:** an **HTTP-only, Secure, SameSite cookie**, either an encrypted session or a JWT. Use **Auth.js (NextAuth)**, Clerk, Lucia-style session libraries, or the company's IdP via **OIDC** (e.g. Azure AD/Entra ID, as in scQuill).
2. **Middleware/proxy:** a **fast optimistic check** (cookie present?) and redirect unauthenticated users early.
3. **Data Access Layer (DAL):** a server-only module (`import 'server-only'`) where **every data function verifies the session and permissions**. Pages, Server Actions and Route Handlers all call it. This is the real security boundary.
4. **Don't only check in `layout.tsx`.** Layouts **don't re-render on client navigation between child pages**, so a check there isn't evaluated for every request to a child page.
5. **Client:** expose a minimal user object to client components through a provider, for UI decisions only.

### What do `next/image`, `next/font` and `next/script` do?

- **`next/image`:**
  - automatic **responsive `srcset`** and on-the-fly **resizing and format conversion** (WebP/AVIF)
  - **lazy loading** by default
  - **prevents CLS** by requiring `width`/`height` or `fill` with a sized parent
  - `priority` for the LCP image, which preloads it and turns off lazy loading
  - placeholders (`blur`)
  - remote images need `images.remotePatterns` in config
- **`next/font`:**
  - **self-hosts** Google or local fonts at build time, with no request to Google at runtime (privacy and performance)
  - automatic `font-display` and preloading
  - **fallback metric adjustment** to minimise layout shift
- **`next/script`:**
  - loading **strategies**: `beforeInteractive`, `afterInteractive` (the default), `lazyOnload`, `worker` (Partytown, experimental)
  - keeps third-party scripts from blocking rendering

### What is the Metadata API?

Export a **`metadata` object** or an async **`generateMetadata({ params })`** function from a layout or page to define `<title>`, description, Open Graph and Twitter cards, canonical URLs, robots, icons and similar. Metadata **merges** down the layout tree (with `title.template` such as `'%s | MeetHour'`). File conventions such as `opengraph-image.tsx` (generated with `ImageResponse`), `sitemap.ts`, `robots.ts` and `manifest.ts` produce SEO assets. Metadata is server-only and streams correctly. In React 19 you can also render `<title>` directly in components.

### Edge runtime vs Node.js runtime

- **Node.js runtime:** the full Node API, every npm package, DB drivers, longer execution. It's the default for most routes.
- **Edge runtime:** a V8 isolate with **Web APIs only**. It starts very fast and runs close to users (CDN edge), but it has **limited APIs** (no `fs`, limited Node built-ins), size limits, and **DB access needs HTTP-based or edge-compatible drivers**. Good for middleware, light personalisation, redirects and streaming responses.
- Choose per route: `export const runtime = 'edge' | 'nodejs'`. The trend has moved back toward **Node by default**, using edge only where latency truly matters.

## Production & operations

### How do you deploy Next.js outside Vercel? 🔥

- **Node server:** `next build && next start`, behind Nginx or a load balancer. Use `output: 'standalone'` for a minimal server bundle, ideal for **Docker**.
- **Containers:** multi-stage Dockerfile (deps → build → runner with `.next/standalone` + `.next/static` + `public`), running as a non-root user.
- **Static export:** `output: 'export'` produces plain HTML, CSS and JS for S3/CloudFront or any CDN. There's **no SSR, ISR, middleware, Server Actions or image optimisation**, so it's essentially an SSG/SPA.
- **AWS:** OpenNext (SST) for Lambda + CloudFront, Amplify Hosting, or ECS/Fargate with the standalone build.
- **Self-hosting considerations:**
  - the ISR/Data Cache is on the **local filesystem** by default. With **multiple instances**, configure a **shared cache handler** (e.g. Redis) or revalidation won't be consistent.
  - image optimisation needs `sharp`
  - set `Cache-Control` correctly for static assets via a CDN

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build            # next.config: { output: 'standalone' }

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
```

### How do environment variables work in Next.js?

- `.env`, `.env.local`, `.env.development` and `.env.production` are loaded automatically. `.env*.local` files are for secrets and are git-ignored.
- **Server-only by default:** `process.env.DB_URL` is available only on the server.
- **`NEXT_PUBLIC_` prefix** variables are **inlined into the client bundle at build time**. Never put secrets in them, and remember that changing them requires a rebuild, unless you read runtime config on the server and pass it down.
- Validate env variables at startup with zod (e.g. `@t3-oss/env-nextjs`) to fail fast.

### What causes hydration errors in Next.js and how do you fix them? 🔥

They're the same causes as in any SSR React app: **server and client render different output**.

- **Time and randomness:** `new Date().toLocaleString()`, `Math.random()`.
- **Browser-only branches:** `typeof window !== 'undefined'`, reading `localStorage` during render.
- **Locale or time-zone differences** between the server and the user.
- **Invalid HTML nesting** (`<p><div/></p>`, `<a>` inside `<a>`).
- **Browser extensions** injecting attributes (Grammarly, password managers).

**Fixes:**

- Move client-only values into `useEffect`/state after mount.
- Use `dynamic(() => import('./Chart'), { ssr: false })` for client-only components.
- Use `suppressHydrationWarning` for intentional differences such as timestamps.
- Format dates with an explicit time zone.
- Fix the HTML structure.

React 19 and Next 15+ show a **diff** of the mismatch, which makes debugging much easier.

### How do you optimise a slow Next.js app?

1. **Measure:** the Vercel/Next.js Speed Insights or `web-vitals`, `@next/bundle-analyzer`, the build output (route sizes, static vs dynamic markers).
2. **Make more routes static or partially static.** Avoid accidentally dynamic routes (a stray `cookies()` call in a layout makes every child dynamic).
3. **Cache data deliberately:** tags, `revalidate`, `'use cache'`. Deduplicate with `cache()`.
4. **Stream:** Suspense around slow components; `loading.tsx`.
5. **Reduce client JS:** push `'use client'` to the leaves, use `next/dynamic` for heavy client widgets, and avoid huge client providers wrapping the whole app.
6. **Images and fonts:** `next/image` with `priority` on the LCP image, `next/font`.
7. **Avoid waterfalls:** parallel fetching, preloading patterns.
8. **Third-party scripts:** `next/script` with `lazyOnload`/`afterInteractive`.
