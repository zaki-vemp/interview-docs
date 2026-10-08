# Testing: Jest, RTL, Enzyme, Jasmine/Karma, E2E

Your resume explicitly mentions **unit testing React components with Enzyme, the Jasmine framework and the Karma runner**. Interviewers will ask about those, **and** about the modern stack (**Jest/Vitest + React Testing Library + MSW + Playwright**). This page covers both, plus testing strategy for real-time apps.

> The playground has a Jest-compatible API (`describe`, `test`, `expect`, `jest.fn()`, `beforeEach`), so the plain-JS examples here are runnable. React/RTL examples need a DOM, so they're shown as JSX.

## Strategy

### What is the testing pyramid (and the testing trophy)? What do you test at each level? 🔥

- **Testing pyramid** (the classic model): **many unit tests** (fast, isolated), fewer **integration tests**, very few **E2E tests** (slow, brittle, expensive).
- **Testing trophy** (Kent C. Dodds, popular in frontend):
  1. **Static analysis** (TypeScript, ESLint) at the base
  2. some **unit** tests
  3. **the most integration tests**: components rendered with their children, real hooks and state, and a mocked network
  4. a thin layer of **E2E**
  
  The rationale: *"The more your tests resemble the way your software is used, the more confidence they give you."*

| Level | Tools | Examples from your projects |
|---|---|---|
| Static | TypeScript strict, ESLint (react-hooks, jsx-a11y) | Catch wrong prop shapes and missing effect dependencies |
| Unit | Jest/Vitest | Reducers (recording-session state machine), selectors, utilities (SDP parsing, word-timestamp binary search, redaction locating) |
| Integration/component | React Testing Library + MSW | "Clicking *Start recording* shows *Starting…* then *Recording*"; scQuill: "clicking a word seeks the player" |
| E2E | Playwright/Cypress | Two browsers join the same meeting with fake media; one mutes and the other sees the muted icon |
| Visual/a11y/perf | Chromatic/Playwright screenshots, axe, Lighthouse CI | Theme regressions, contrast, bundle budgets |

### What makes a good unit test? Explain AAA and FIRST 🔥

- **AAA:** **Arrange** (set up inputs and state) → **Act** (do one thing) → **Assert** (check the outcome). One behaviour per test, with a descriptive name ("returns -1 during silence between words").
- **FIRST:**
  - **F**ast
  - **I**ndependent (no order dependence or shared mutable state)
  - **R**epeatable (deterministic: control time, randomness and network)
  - **S**elf-validating (pass/fail, no manual inspection)
  - **T**imely (written with the code)
- **Test behaviour, not implementation.** Assert on outputs and observable effects, not private state or how many times an internal helper was called. Implementation-detail tests break on refactors without catching bugs.
- **Make code testable:** inject dependencies (clock, fetch, random, media APIs) so tests can control them.

```js
// Arrange-Act-Assert with an injected dependency (fetch), no global mocking needed
async function loadParticipants(meetingId, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`/api/meetings/${meetingId}/participants`);
  if (!res.ok) throw new Error(`Failed to load participants (${res.status})`);
  const list = await res.json();
  return list.filter((p) => !p.hidden).sort((a, b) => a.name.localeCompare(b.name));
}

const fakeResponse = (status, body) => ({ ok: status < 400, status, json: async () => body });

describe('loadParticipants', () => {
  test('returns visible participants sorted by name', async () => {
    // Arrange
    const fetchImpl = jest.fn(async () => fakeResponse(200, [{ name: 'Ravi' }, { name: 'jibri', hidden: true }, { name: 'Asha' }]));
    // Act
    const result = await loadParticipants('m1', { fetchImpl });
    // Assert
    expect(result.map((p) => p.name)).toEqual(['Asha', 'Ravi']);
    expect(fetchImpl).toHaveBeenCalledWith('/api/meetings/m1/participants');
  });

  test('throws a helpful error on HTTP failure', async () => {
    const fetchImpl = async () => fakeResponse(503, null);
    await expect(loadParticipants('m1', { fetchImpl })).rejects.toThrow('Failed to load participants (503)');
  });
});
```

### Mocks vs stubs vs spies vs fakes: what's the difference?

- **Stub:** returns canned answers (`getUser = () => ({ id: 1 })`). No assertions about calls.
- **Spy:** records calls (arguments, count) and often wraps the real implementation (`jest.spyOn(obj, 'method')`).
- **Mock:** a stub plus **expectations** about how it's called (`expect(mock).toHaveBeenCalledWith(...)`). `jest.fn()` is both a spy and a configurable mock.
- **Fake:** a **working lightweight implementation**: an in-memory repository, a fake clock, a fake WebSocket server, **MSW** handlers, or the fake media devices in Chrome.
- **Guideline:** prefer **fakes at the boundaries** (network, time, media) and real code inside. Over-mocking internal modules produces tests that pass while the app is broken.

### How do you test time-based code (debounce, timers, retries) deterministically? 🔥

Real timers make tests **slow and flaky**. Options:

1. **Jest/Vitest fake timers:** `jest.useFakeTimers()`, then `jest.advanceTimersByTime(300)` or `jest.runAllTimers()`. Use `await jest.advanceTimersByTimeAsync()` when promises are involved. In Jasmine, `jasmine.clock().install()` and `tick()`.
2. **Inject a scheduler or clock** into your code, which is even more robust and framework-free:

```js
// A tiny fake clock you can inject — the idea behind jest.useFakeTimers()
function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => timers.delete(id),
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
  };
}

function debounce(fn, wait, clock) {
  let id = null;
  return (...args) => {
    clock.clearTimeout(id);
    id = clock.setTimeout(() => fn(...args), wait);
  };
}

describe('debounce with a fake clock', () => {
  let clock;
  beforeEach(() => { clock = createFakeClock(); });

  test('fires once after the quiet period with the latest args', () => {
    const save = jest.fn();
    const debouncedSave = debounce(save, 300, clock);
    debouncedSave('a');
    clock.advance(100);
    debouncedSave('b');
    clock.advance(299);
    expect(save).not.toHaveBeenCalled();
    clock.advance(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith('b');
  });
});
```

## React Testing Library

### What is React Testing Library's philosophy, and which queries should you use? 🔥

RTL renders components into a real DOM (jsdom or happy-dom) and encourages **testing the way users interact**: finding elements by **accessible role and name**, typing, clicking, and asserting on **what's visible**, not on component internals (state, props, instance methods).

**Query priority** (from the docs):

1. **`getByRole`** (with `{ name }`) is the best choice and **doubles as an accessibility check**.
2. `getByLabelText` (form fields).
3. `getByPlaceholderText`, `getByText`, `getByDisplayValue`.
4. `getByAltText`, `getByTitle`.
5. **`getByTestId`** as the **last resort**.

**Query variants:**

- **`getBy*`** throws if the element isn't found (use it for elements that should exist).
- **`queryBy*`** returns `null` (use it to assert **absence**: `expect(queryByText('Error')).not.toBeInTheDocument()`).
- **`findBy*`** is **async**: it waits (polling up to 1 s by default) for elements that appear after async work.
- `*AllBy*` returns arrays.

**Interactions:** prefer **`@testing-library/user-event`** (`await user.click()`, `user.type()`, `user.keyboard()`), which simulates real event sequences (focus, keydown, input, keyup) over the low-level `fireEvent`.

```jsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

test('starts a recording and shows the status', async () => {
  const user = userEvent.setup();
  const startRecording = vi.fn().mockResolvedValue({ id: 'rec-1' });
  render(<RecordingControls startRecording={startRecording} canRecord />);

  await user.click(screen.getByRole('button', { name: /start recording/i }));

  expect(startRecording).toHaveBeenCalledWith({ mode: 'file' });
  expect(screen.getByRole('status')).toHaveTextContent(/starting/i);          // live region
  expect(await screen.findByText(/recording/i)).toBeInTheDocument();         // async update
  expect(screen.queryByRole('button', { name: /start recording/i })).not.toBeInTheDocument();
});

test('participants list shows a muted icon with an accessible label', () => {
  render(<ParticipantList participants={[{ id: 'a', name: 'Asha', muted: true }]} />);
  const row = screen.getByRole('listitem', { name: /asha/i });
  expect(within(row).getByLabelText(/muted/i)).toBeInTheDocument();
});
```

### What are `act()` warnings and how do you fix them?

"An update to X inside a test was not wrapped in act(...)" means **state updated after the test thought it was done**, typically from an async effect, timer or promise resolving after your assertions.

**Fixes:**

- **Wait for the result:** `await screen.findBy…` or `await waitFor(() => expect(…))`.
- Advance fake timers inside act (RTL does this for you when using its utilities).
- Make sure mocked promises resolve **before** the test ends, and clean up subscriptions on unmount.

**Don't** just wrap things in `act` blindly to silence the warning. It usually means the test isn't asserting on the final UI state. RTL's `render`, `userEvent` and `waitFor` already wrap updates in `act`.

### How do you mock network requests in component tests? Why MSW? 🔥

**MSW (Mock Service Worker)** intercepts requests **at the network layer**: a Service Worker in the browser, request interception in Node/jsdom. Your components use the **real `fetch` or axios and the real data libraries** (SWR, React Query) while MSW returns mocked responses.

**Benefits:**

- No need to mock `fetch` or modules.
- The **same handlers** work in unit and integration tests, Storybook, local development and E2E.
- **Realistic** behaviour: status codes, delays, errors.
- Per-test **overrides** for error cases.

```jsx
// handlers.ts
import { http, HttpResponse, delay } from 'msw';
export const handlers = [
  http.get('/api/meetings/:id/recordings', async ({ params }) => {
    await delay(50);
    return HttpResponse.json([{ id: 'r1', meetingId: params.id, durationMs: 65000 }]);
  }),
];

// setupTests.ts
import { setupServer } from 'msw/node';
export const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Recordings.test.tsx — override for the error path
test('shows an error with retry', async () => {
  server.use(http.get('/api/meetings/:id/recordings', () => new HttpResponse(null, { status: 500 })));
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Recordings meetingId="m1" /></SWRConfig>);
  expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load recordings/i);
});
```

**SWR/React Query gotcha:** reset the **cache between tests**. For SWR, `provider: () => new Map()`; for TanStack, a new `QueryClient` per test with `retry: false`. Otherwise data leaks between tests.

### How do you test custom hooks?

- **`renderHook`** (from `@testing-library/react`): `const { result, rerender, unmount } = renderHook(() => useDebounce(value, 300), { initialProps })`. Assert on `result.current`. Use `act` for updates and fake timers for time.
- **Better still:** test hooks **through a component** that uses them, as part of a feature test. Use `renderHook` for reusable library-style hooks.
- **Keep logic in pure functions** (reducers, calculators) that you can test without React. The hook becomes a thin wrapper.

### How do you test Redux code?

- **Reducers** are pure functions: `expect(reducer(state, action)).toEqual(next)`. They're cheap and valuable. Test the **state machine transitions**, including the invalid ones.
- **Selectors:** test with state fixtures, including **memoisation** where it matters (same input → same reference).
- **Thunks/async logic:** dispatch against a **real store** (`configureStore` with the real reducers and mocked services through `extraArgument`, or MSW), then assert on the resulting state. Don't assert on the exact sequence of internal actions.
- **Components:** render with a real store (a `renderWithProviders` helper that takes `preloadedState`) and test through the UI. The Redux docs recommend this integration style over mocking `useSelector`.

## Legacy stack on the resume: Enzyme, Jasmine & Karma

### Explain Enzyme: `shallow` vs `mount` vs `render`. Why did the ecosystem move away from it? 🔥

**Enzyme** (Airbnb) renders React components and provides a jQuery-like API to traverse and manipulate the output.

- **`shallow(<Comp />)`** renders **one level deep**: child components aren't rendered (they appear as placeholders). It's fast and isolates the unit, but it **doesn't run effects** (`useEffect` doesn't run in the shallow renderer), and it couples tests to the component's structure.
- **`mount(<Comp />)`** does a **full DOM render** (jsdom) including children and lifecycles. Use it for integration-like tests, refs and DOM APIs.
- **`render(<Comp />)`** produces static HTML (Cheerio) for assertions on markup.
- **APIs:** `wrapper.find('Button')`, `.simulate('click')`, `.props()`, `.state()`, `.setProps()`, `.instance()` (class components), `.update()`.

**Why it declined:**

1. It **encourages implementation-detail testing** (`state()`, `instance()`, finding by component name), so refactors such as converting a class to hooks break tests without any behaviour change.
2. It needs **adapters per React version**. There's **no official adapter for React 18/19**, so Enzyme is effectively dead for modern React.
3. Hooks and concurrent features don't fit its model.

**How to talk about it:**

> "I wrote Enzyme tests earlier in my career. On the newer projects we moved to React Testing Library, which tests behaviour through accessible queries. When migrating, I replaced `shallow` and state assertions with user-level interactions and MSW-mocked network calls, and the tests became much more refactor-proof."

```jsx
// Enzyme (legacy) — implementation-detail style
const wrapper = mount(<Counter />);
wrapper.find('button.increment').simulate('click');
expect(wrapper.find(Counter).state('count')).toBe(1);          // reads internal state: brittle

// RTL equivalent — behaviour style
render(<Counter />);
await userEvent.click(screen.getByRole('button', { name: /increment/i }));
expect(screen.getByText('Count: 1')).toBeInTheDocument();
```

### How do Jasmine and Karma fit together? 🔥

- **Jasmine** is a **BDD test framework**: `describe`/`it`, `beforeEach`/`afterEach`, matchers (`toBe`, `toEqual`, `toContain`, `toHaveBeenCalledWith`), and built-in **spies**:
  - `spyOn(service, 'save').and.returnValue(of(true))`
  - `.and.callFake(fn)`, `.and.callThrough()`
  - `jasmine.createSpyObj('Api', ['get', 'post'])`
  - `jasmine.any(Number)`
  - async support with `done` callbacks or async/await
  - the fake clock: **`jasmine.clock().install(); jasmine.clock().tick(300)`**
- **Karma** is a **test runner**:
  - it **launches real browsers** (ChromeHeadless, Firefox), serves your bundled test files (via a preprocessor such as `karma-webpack`), runs them with a framework adapter (`karma-jasmine`) and reports results (progress, JUnit for CI, coverage through istanbul)
  - `karma.conf.js` configures `frameworks`, `files`, `preprocessors`, `browsers`, `reporters`, `singleRun`
- **Pros:** tests run in **real browsers**, so they're faithful to real DOM and browser APIs.
- **Cons:** slow startup, complex configuration, flaky browser launches in CI.
- **Status:** **Karma was deprecated** in 2023. Angular moved its defaults to other runners (Jest, Web Test Runner, and **Vitest** in recent versions). For React, Jest/Vitest with jsdom took over long ago. **Vitest browser mode** and **Playwright component testing** now cover the "real browser" use case.

```js
// Jasmine-style spies expressed with this playground's Jest API (the concepts map 1:1)
const api = { save: jest.fn().mockResolvedValue({ ok: true }), log: jest.fn() };

async function saveTranscript(text, deps) {
  if (!text.trim()) throw new Error('Empty transcript');
  const res = await deps.save({ text, savedAt: 'now' });
  deps.log(`saved ${text.length} chars`);
  return res.ok;
}

describe('saveTranscript', () => {
  beforeEach(() => { api.save.mockClear(); api.log.mockClear(); });

  it('saves and logs', async () => {
    await expect(saveTranscript('hello', api)).resolves.toBe(true);
    expect(api.save).toHaveBeenCalledWith({ text: 'hello', savedAt: 'now' });   // jasmine: toHaveBeenCalledWith
    expect(api.log).toHaveBeenCalledTimes(1);
  });

  it('rejects empty input without calling the API', async () => {
    await expect(saveTranscript('   ', api)).rejects.toThrow('Empty transcript');
    expect(api.save).not.toHaveBeenCalled();
  });
});
```

### Jest vs Vitest: what's different?

- **Jest** is mature, with a huge ecosystem. It has historically been slow with ESM and TypeScript, and needs Babel or ts-jest transforms.
- **Vitest** uses **Vite's pipeline**: **native ESM, TypeScript and JSX** with the same config and plugins as the app. It has a **Jest-compatible API** (`vi.fn`, `vi.mock`, `vi.useFakeTimers`), is very fast (worker threads, smart watch mode), and offers **browser mode** (real browsers through Playwright) and in-source testing.
- **Migration** is usually straightforward: replace `jest` with `vi`, and adjust `jest.mock` hoisting semantics and config.
- **Choose Vitest** for Vite projects such as Nebraska Draw and SCAI. Jest remains common in older CRA and Next.js setups (Next supports both).

### What about snapshot tests? When are they useful?

- `expect(tree).toMatchSnapshot()` stores serialised output and fails when it changes.
- **Useful for:** small, stable outputs: serialisers, error messages, generated config, small pure components, **inline snapshots** for data structures.
- **Problems:** large snapshots get **rubber-stamped** ("update all snapshots"), they assert everything (so they're brittle) and nothing specific (so they catch little), and they're noisy in code review.
- **Prefer explicit assertions** on what matters. Use **visual regression tools** (Chromatic, Percy, Playwright `toHaveScreenshot`) for styling changes.

## End-to-end & special cases

### Cypress vs Playwright: how do they compare? 🔥

| | Cypress | Playwright |
|---|---|---|
| Architecture | Runs **inside the browser** alongside the app (same run loop) | Drives browsers **from outside** via CDP and browser-specific protocols |
| Browsers | Chromium family, Firefox, WebKit (experimental) | **Chromium, Firefox, WebKit** (Safari engine) as first-class targets |
| Multiple tabs, windows, origins | Limited (`cy.origin` for multiple origins) | **Full support**: multiple **browser contexts and pages** in one test, which suits **multi-participant meeting tests** |
| Language | JS/TS | JS/TS, Python, Java, .NET |
| Waiting | Automatic retries | **Auto-waiting** locators, web-first assertions |
| Parallelism | Paid Dashboard (Cypress Cloud) or community tools | **Built-in sharding and workers**, free |
| Debugging | Excellent time-travel UI | **Trace Viewer** (DOM snapshots, network, console per step), UI mode, codegen |
| Component testing | Yes | Yes (experimental) |
| Electron | — | **`_electron.launch()`** for desktop app E2E |

**For MeetHour, Playwright fits better:** multiple participants in separate contexts, fake media devices, an Electron app, and WebKit coverage for Safari.

### How would you write an E2E test for a multi-participant video call? 🔥

- Launch Chromium with **fake media**: `--use-fake-ui-for-media-stream` (auto-accept permissions) and `--use-fake-device-for-media-stream` (synthetic camera and mic). Optionally pass `--use-file-for-fake-video-capture=video.y4m` for deterministic video.
- Create **two (or more) browser contexts**, one per participant, each with separate storage and cookies.
- Join the same room. Assert on **UI state** (participant count, muted icons, the recording indicator) and on **media flowing**: check the `<video>` has `videoWidth > 0`, or read `getStats()` through `page.evaluate` (`bytesReceived` increasing).
- Keep E2E tests **few and focused** on critical journeys. Use **unique room names** per test to avoid interference, and **traces and video on failure** for debugging.

```node
import { test, expect, chromium } from '@playwright/test';

test('mute state propagates to other participants', async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const room = `e2e-${Date.now()}`;
  const [alice, bob] = await Promise.all([browser.newContext(), browser.newContext()].map(async (c) => (await c).newPage()));

  await alice.goto(`https://meet.staging.example.com/${room}#userInfo.displayName="Alice"`);
  await bob.goto(`https://meet.staging.example.com/${room}#userInfo.displayName="Bob"`);
  await alice.getByRole('button', { name: /join/i }).click();
  await bob.getByRole('button', { name: /join/i }).click();

  await expect(alice.getByRole('listitem', { name: /bob/i })).toBeVisible();           // presence propagated
  await alice.getByRole('button', { name: /mute microphone/i }).click();
  await expect(bob.getByRole('listitem', { name: /alice/i }).getByLabel(/muted/i)).toBeVisible();

  // media is actually flowing to Bob
  const bytes = await bob.evaluate(async () => {
    const pc = window.__pcs?.[0];                       // test hook exposed in staging builds
    const stats = await pc.getStats();
    return [...stats.values()].filter((s) => s.type === 'inbound-rtp').reduce((n, s) => n + s.bytesReceived, 0);
  });
  expect(bytes).toBeGreaterThan(0);
  await browser.close();
});
```

### What causes flaky tests and how do you fix them? 🔥

| Cause | Fix |
|---|---|
| **Timing assumptions** (`sleep(500)`, animations) | Wait for **conditions** (`findBy`, `waitFor`, Playwright web-first assertions); disable animations in tests |
| **Shared state between tests** (caches, singletons, DB rows, localStorage) | Reset everything per test; unique data (room names); isolated contexts |
| **Real time, dates, randomness, time zones** | Fake timers or an injected clock, a seeded random, fixed TZ (`TZ=UTC`) |
| **Network dependencies** | MSW / mocked services; for E2E, stable test environments and seeded data |
| **Order dependence** | Run in random order (`--randomize`), with independent setup |
| **Resource contention in CI** | Fewer workers, generous but bounded timeouts, retries **only** as a stop-gap, with flake tracking |
| **Async leaks** (unawaited promises, open handles) | Await everything; clean up subscriptions, intervals and sockets in `afterEach` |

**Process:** quarantine flaky tests, track flake rates, and **fix the root cause**. Never just add retries forever.

### What is TDD and do you practise it?

**Test-Driven Development:** **Red** (write a failing test for the next small behaviour) → **Green** (minimal code to pass) → **Refactor** (clean up with the tests as a safety net).

- **Benefits:** design pressure toward small, testable units; executable specifications; fewer regressions.
- **Where it fits best:** pure logic such as reducers, parsers, algorithms and the redaction entity locator.
- It's harder for exploratory UI or spikes. Many teams do "test-first for logic, test-after for UI".

**Honest answer template:**

> "I use TDD for logic-heavy code, like the recording-session reducer or transcript timing utilities, where writing the cases first clarifies the edge cases. For UI, I usually build the component and then write RTL tests for the important behaviours, plus a regression test for every bug I fix."

### How much code coverage is enough?

- Coverage measures **which lines or branches executed**, not whether behaviour is **verified**. 100% coverage with weak assertions proves little.
- **Reasonable targets:** around 70–80% overall, **higher for critical logic** (auth, payments, permission checks, state machines). Lower is fine for glue code and generated code.
- Use coverage to **find untested critical paths**, not as a vanity metric. **Branch coverage** is more meaningful than line coverage.
- Complement it with **mutation testing** (Stryker) to check that tests actually fail when code changes.
