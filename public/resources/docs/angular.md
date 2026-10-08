# Angular

Angular is a complete, opinionated framework: DI, router, forms, HTTP and testing are all built in. For a React developer, interviewers focus on **Angular's core concepts**: dependency injection, change detection (Zone.js, OnPush, **signals**, zoneless), **RxJS**, and modern Angular (standalone components, new control flow, `@defer`). This page reflects **Angular 17–21**.

## Architecture & components

### Explain Angular's architecture and building blocks 🔥

- **Components:** a TypeScript class with `@Component` (selector, template, styles) plus a template. Components form the UI tree.
- **Templates:** HTML with Angular syntax: interpolation `{{ }}`, property binding `[prop]`, event binding `(event)`, two-way binding `[(ngModel)]`, control flow (`@if`, `@for`, `@switch`), pipes (`| date`).
- **Directives:** attribute directives change appearance or behaviour (`[class]`, custom `appTooltip`). Structural directives change the DOM layout (`*ngIf` and `*ngFor`, now mostly replaced by built-in control flow).
- **Services + Dependency Injection:** reusable logic and state (HTTP, auth, the conference service), injected where needed.
- **Routing:** `@angular/router`, with lazy loading, guards and resolvers.
- **Forms:** template-driven and reactive forms.
- **HttpClient:** Observables, interceptors.
- **Modules vs standalone:** historically, `NgModule`s grouped declarations and providers. **Since v15, standalone components are stable**, and **since v19, `standalone: true` is the default**. New apps bootstrap with `bootstrapApplication(AppComponent, { providers: [provideRouter(routes), provideHttpClient()] })`.
- **Compilation:** the **Ivy** compiler with **AOT** (ahead-of-time) compilation turns templates into efficient instructions at build time, enabling tree-shaking. The modern build uses **esbuild + Vite**.

```tslib
import { Component, input, output, computed, signal } from '@angular/core';

@Component({
  selector: 'app-participant-card',
  template: `
    <div class="card" [class.speaking]="isSpeaking()">
      <span>{{ participant().name }}</span>
      @if (participant().muted) { <span aria-label="muted">🔇</span> }
      <button (click)="mute.emit(participant().id)" [disabled]="!canMute()">Mute</button>
    </div>
  `,
})
export class ParticipantCardComponent {
  participant = input.required<{ id: string; name: string; muted: boolean }>(); // signal input
  canMute = input(false);
  mute = output<string>();                                                       // replaces @Output + EventEmitter
  private level = signal(0);
  isSpeaking = computed(() => this.level() > 0.1);
}
```

### Explain the component lifecycle hooks 🔥

In order:

1. **`constructor`:** dependency injection only. Inputs aren't set yet.
2. **`ngOnChanges(changes: SimpleChanges)`:** called before `ngOnInit` and whenever an `@Input` **reference** changes. Not called for signal inputs; use `computed`/`effect` with those.
3. **`ngOnInit`:** inputs are available. Do initialisation here (fetching, subscriptions).
4. **`ngDoCheck`:** a custom change-detection hook that runs on every CD cycle. Keep it cheap or avoid it.
5. **`ngAfterContentInit` / `ngAfterContentChecked`:** projected content (`<ng-content>`) is initialised or checked.
6. **`ngAfterViewInit` / `ngAfterViewChecked`:** the component's view and children (`@ViewChild`) are ready. Use it for DOM access, but don't change bound state here (that causes `ExpressionChangedAfterItHasBeenCheckedError`).
7. **`ngOnDestroy`:** clean up subscriptions, timers and listeners.
   - Modern alternatives: inject **`DestroyRef`** and call `onDestroy(...)`, or use **`takeUntilDestroyed()`**.

**Also:** **`afterNextRender` / `afterRender`** (v17+) for DOM work after rendering, which is SSR-safe because they only run in the browser.

### How do components communicate in Angular? 🔥

| Need | Mechanism |
|---|---|
| Parent → child | **`@Input()`** or **signal `input()`** (v17.1+), `input.required()` |
| Child → parent | **`@Output()` + `EventEmitter`** or **`output()`** (v17.3+) |
| Two-way | `[(value)]` = `[value]` + `(valueChange)`; **`model()`** signal (v17.2+) |
| Parent accessing a child | **`@ViewChild` / `viewChild()`** signal query, or template reference variables (`#player`) |
| Projected content | `<ng-content select="[slot=header]">`, `@ContentChild`/`contentChild()`, `ngTemplateOutlet` for templates passed as inputs |
| Siblings / anywhere | A **shared service** with signals or a `BehaviorSubject` |
| Global state | Services + signals, **NgRx** (Store/SignalStore), NGXS |

## Dependency injection

### How does Dependency Injection work in Angular? 🔥

Angular creates and supplies dependencies through **injectors** arranged in a **hierarchy**:

1. **Environment injectors:** the root (`providedIn: 'root'` → an app-wide **singleton**, tree-shakeable if unused), plus injectors for lazy-loaded routes (`providers` on a route create a child environment injector).
2. **Element/node injectors:** `providers` in a `@Component`/`@Directive` give **a new instance per component instance**, shared with its children. Useful for per-widget state (e.g. a per-meeting-tile service).

**Resolution:** Angular looks up the element injector chain (component → parent components), then the environment injector chain (route → root). Modifiers change the lookup:

- `@Optional()` / `{ optional: true }`: return null instead of throwing if not found
- `@Self()`: only this element's injector
- `@SkipSelf()`: start at the parent
- `@Host()`: stop at the host component

**Ways to provide:**

- `useClass` (an alternative implementation, e.g. a mock)
- `useValue` (config objects)
- `useFactory` (computed, with `deps`)
- `useExisting` (an alias)
- **`InjectionToken<T>`** for non-class values (config, feature flags)
- **multi providers** (several values for one token, e.g. initialisers)

**`inject()` function:** the modern alternative to constructor injection. It works in field initialisers, factories, guards and interceptors.

```tslib
import { Injectable, InjectionToken, inject, signal } from '@angular/core';

export const MEET_CONFIG = new InjectionToken<{ domain: string; maxVisitors: number }>('MEET_CONFIG');

@Injectable({ providedIn: 'root' })                       // singleton, tree-shakeable
export class ConferenceService {
  private config = inject(MEET_CONFIG);                   // function-based DI
  readonly participants = signal<Record<string, { name: string }>>({});
  join(room: string) { console.log(`joining ${room} on ${this.config.domain}`); }
}

// bootstrap
bootstrapApplication(AppComponent, {
  providers: [
    { provide: MEET_CONFIG, useValue: { domain: 'meet.example.com', maxVisitors: 10000 } },
    provideHttpClient(withInterceptors([authInterceptor])),
    provideRouter(routes),
  ],
});
```

### What's the difference between providing a service in root vs in a component?

- **`providedIn: 'root'`:** **one instance for the whole app**, created lazily on first injection and tree-shaken if never used. Use it for global services (auth, API, a conference connection).
- **Component `providers: [Svc]`:** a **new instance per component instance**, destroyed with the component. Use it for state scoped to a widget: a form wizard, a per-tab editor, or a "meeting room" service when the app can show several rooms.
- **Route `providers`:** an instance per lazy-loaded feature (a scoped environment injector).
- **Pitfall:** providing the same service in a component **and** expecting a singleton creates **two different instances**, a classic bug where "state isn't shared".

## Change detection & signals

### How does change detection work with Zone.js? Default vs OnPush 🔥

**Zone.js** monkey-patches async APIs: DOM events, `setTimeout`, promises, XHR/fetch. When any async task finishes inside Angular's zone, Angular runs **change detection** from the **root** down the component tree. It evaluates template bindings and updates the DOM where values changed (in development, a second check verifies that nothing changed).

**`ChangeDetectionStrategy.Default`:** every component is checked on every CD cycle. Simple, but expensive for large trees.

**`ChangeDetectionStrategy.OnPush`:** a component (and its subtree) is checked **only when**:

1. an `@Input` gets a **new reference** (immutable data matters, because mutating an input object won't trigger it)
2. an **event handler in the component or its children** fires
3. an **`async` pipe** in its template emits
4. a **signal read in its template** changes (v17+)
5. it's manually marked: `ChangeDetectorRef.markForCheck()`

**`ChangeDetectorRef` APIs:**

- `detectChanges()` runs CD for this component now.
- `markForCheck()` marks it and its ancestors to be checked in the next cycle.
- `detach()`/`reattach()` give manual control, for example for a **video stats panel updated 30 times per second**.

**Performance tip for real-time apps:** run high-frequency event handlers **outside Angular** with `NgZone.runOutsideAngular()`. Examples: mousemove for annotations, WebRTC stats intervals, audio-level callbacks. Re-enter with `zone.run()` only when the UI must update.

### What is `ExpressionChangedAfterItHasBeenCheckedError`? 🔥

In **development mode**, after each change-detection pass Angular runs a **second verification pass**. If a binding's value **changed between the two passes**, it throws this error. It means your data flow isn't **unidirectional**: something updated state **during** change detection.

**Common causes:**

- changing a parent-bound value in a child's `ngAfterViewInit`/`ngAfterViewChecked`
- getters that return new values each time (`get now() { return Date.now(); }`)
- services updated synchronously during rendering

**Fixes:**

- move the logic earlier (`ngOnInit`)
- derive the value with `computed`/pure pipes
- schedule the update for the next tick (`queueMicrotask`/`setTimeout`), only as a last resort
- restructure so data flows one way

### What are Angular signals and how do they change change detection? 🔥

**Signals** (stable since v17–v20) are **reactive primitives** with automatic dependency tracking:

- **`signal(initial)`:** a writable signal. Read it with `count()`; write it with `.set(v)` or `.update(fn)`.
- **`computed(() => …)`:** a derived, **lazy and memoised** read-only signal.
- **`effect(() => …)`:** side effects that re-run when the signals they read change (logging, syncing to localStorage, imperative APIs). Avoid writing other signals in effects; use `computed`/`linkedSignal` instead.
- **`linkedSignal`:** a writable signal that **resets** when a source changes, e.g. the selected item reset when the list changes.
- **`resource()` / `httpResource()`:** async data loaded from signal-driven requests, exposing `value()`, `status()`, `error()` and `isLoading()`.
- **Signal inputs** (`input()`), **`model()`**, **signal queries** (`viewChild()`).
- **RxJS interop:** `toSignal(observable$)` and `toObservable(signal)`.

**Why signals matter:**

- Angular knows **exactly which views depend on which signals**, so it can update **only those components**. This is **fine-grained** change detection that doesn't rely on Zone.js.
- That enables **zoneless Angular**: `provideZonelessChangeDetection()`, stable in v20 and the default for new apps in v21. Benefits: smaller bundles, no monkey-patching, better performance, simpler debugging.

```tslib
@Component({
  selector: 'app-participants',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input [value]="query()" (input)="query.set($any($event.target).value)" placeholder="Search" />
    <p>{{ visible().length }} of {{ participants().length }} · {{ handsUp() }} hands raised</p>
    @for (p of visible(); track p.id) {
      <app-participant-card [participant]="p" />
    } @empty {
      <p>No one matches "{{ query() }}"</p>
    }
  `,
})
export class ParticipantsComponent {
  participants = inject(ConferenceService).participantList;   // a signal from the service
  query = signal('');
  visible = computed(() => this.participants().filter((p) => p.name.toLowerCase().includes(this.query().toLowerCase())));
  handsUp = computed(() => this.participants().filter((p) => p.handRaised).length);
  constructor() {
    effect(() => localStorage.setItem('lastQuery', this.query()));     // side effect
  }
}
```

### Signals vs RxJS: when do you use which?

- **Signals:** **synchronous state** that the UI reads: component state, derived values, store slices. They always have a current value, there's no subscription management, and they're glitch-free.
- **RxJS:** **events and async streams over time**:
  - HTTP with cancellation (`switchMap`)
  - debounced search
  - WebSocket/XMPP message streams
  - combining multiple async sources
  - retry/backoff
  - complex timing (`debounceTime`, `throttleTime`, `bufferTime`)
- **Interop:** `toSignal()` to show stream results in templates; `toObservable()` to feed signal changes into RxJS pipelines.

**Rule of thumb:** RxJS for **"when and how things happen"**, signals for **"what the state is now"**.

## RxJS

### Observable vs Promise, and hot vs cold observables 🔥

| | Promise | Observable |
|---|---|---|
| Values | **One** | **Zero to many** over time |
| Eager or lazy | **Eager**: starts immediately | **Lazy**: nothing happens until `subscribe()` |
| Cancellation | No (needs AbortController) | **Yes**: `unsubscribe()` (and operators like `switchMap` cancel automatically) |
| Operators | `then` chaining | 100+ composable operators |
| Sync/async | Always async | Can be either |

- **Cold observable:** each subscriber gets its **own execution**. Example: `HttpClient.get()` makes **a new request per subscription**, a common source of duplicate requests.
- **Hot observable:** **shared execution**. Subscribers receive values from the moment they subscribe. Examples: DOM events, WebSocket messages, `Subject`s.
- **Make cold observables hot/shared** with `share()` or **`shareReplay({ bufferSize: 1, refCount: true })`**. That caches the last value for late subscribers; use it for config or the current user.

Here's a **runnable mini Observable** showing laziness, unsubscribe and operators:

```js
class Observable {
  constructor(subscribeFn) { this._subscribe = subscribeFn; }
  subscribe(observer) {
    const o = typeof observer === 'function' ? { next: observer } : observer;
    let closed = false;
    const safe = {
      next: (v) => !closed && o.next?.(v),
      error: (e) => { if (!closed) { closed = true; o.error?.(e); } },
      complete: () => { if (!closed) { closed = true; o.complete?.(); } },
    };
    const teardown = this._subscribe(safe);
    return { unsubscribe: () => { closed = true; teardown?.(); } };
  }
  pipe(...ops) { return ops.reduce((src, op) => op(src), this); }
}

const map = (fn) => (src) => new Observable((obs) => src.subscribe({ next: (v) => obs.next(fn(v)), error: obs.error, complete: obs.complete }).unsubscribe);
const filter = (pred) => (src) => new Observable((obs) => src.subscribe({ next: (v) => pred(v) && obs.next(v), error: obs.error, complete: obs.complete }).unsubscribe);
const interval = (ms) => new Observable((obs) => { let i = 0; const id = setInterval(() => obs.next(i++), ms); return () => clearInterval(id); });

let executions = 0;
const cold = new Observable((obs) => { executions++; obs.next('data'); obs.complete(); });
console.log('created, executions =', executions);     // lazy: nothing ran yet
cold.subscribe((v) => console.log('A got', v));
cold.subscribe((v) => console.log('B got', v));
console.log('executions after 2 subscribers =', executions); // cold: one execution per subscriber

const received = [];
const sub = interval(5).pipe(filter((n) => n % 2 === 0), map((n) => n * 10)).subscribe((v) => received.push(v));
setTimeout(() => sub.unsubscribe(), 32);              // teardown clears the interval

test('lazy, cold, and unsubscribe stops the source', async () => {
  await new Promise((r) => setTimeout(r, 80));
  expect(executions).toBe(2);
  expect(received.slice(0, 3)).toEqual([0, 20, 40]);
  expect(received.length).toBeLessThanOrEqual(4);     // no values after unsubscribe
});
```

### Explain `switchMap` vs `mergeMap` vs `concatMap` vs `exhaustMap` 🔥

All four map each source value to an **inner observable** and flatten the results. They differ in **what happens when a new value arrives while an inner observable is still running**:

| Operator | Behaviour | Use case |
|---|---|---|
| **`switchMap`** | **Cancels** the previous inner observable and switches to the new one | **Search-as-you-type**, route param → load data (only the latest matters) |
| **`mergeMap`** (`flatMap`) | Runs inners **concurrently** (optional concurrency limit) | Independent parallel work: upload several files, handle each incoming message |
| **`concatMap`** | **Queues**: waits for each inner to complete, preserving order | Ordered writes: save edits in sequence, chat messages that must stay in order |
| **`exhaustMap`** | **Ignores** new values while an inner is active | **Prevent double submission**: login button, "Start recording" clicks, refresh |

```tslib
// Search box: debounce, ignore duplicates, cancel stale requests
this.results$ = this.searchControl.valueChanges.pipe(
  debounceTime(300),
  map((q) => q.trim()),
  distinctUntilChanged(),
  filter((q) => q.length >= 2),
  switchMap((q) => this.api.search(q).pipe(catchError(() => of([])))),   // the error is handled per inner stream
);

// Start-recording button: ignore clicks while a request is in flight
this.startClicks$.pipe(exhaustMap(() => this.recording.start())).subscribe();
```

**Gotcha:** put `catchError` **inside** the inner observable. If an error reaches the outer stream, the stream **completes** and stops working, so the search box would go dead after one error.

### What kinds of Subjects are there? 🔥

| Subject | Behaviour | Use |
|---|---|---|
| `Subject` | Multicast; **no initial value**; late subscribers miss earlier values | Event buses, notifications ("participant joined") |
| `BehaviorSubject` | **Requires an initial value**; new subscribers get the **current value** immediately; `.value` getter | Current state in services (current user, meeting state) before signals |
| `ReplaySubject(n, windowMs?)` | Replays the **last n values** to new subscribers | Cache recent messages, late-loaded components |
| `AsyncSubject` | Emits only the **last value on completion** | Rare; one-time computations |

Best practice: keep the subject **private** in the service and expose `asObservable()`, or a read-only signal, so consumers can't call `next()`.

### How do you avoid memory leaks from subscriptions? 🔥

1. **`async` pipe** in templates (`items$ | async`). It subscribes and unsubscribes automatically, and marks OnPush components for check.
2. **`toSignal(obs$)`** converts to a signal and is cleaned up with the component.
3. **`takeUntilDestroyed()`** (v16+) in an injection context, or pass a `DestroyRef`.
4. Finite operators: **`take(1)`**, `first()`, `takeWhile`.
5. The classic pattern: a `destroy$ = new Subject()` with `takeUntil(this.destroy$)` everywhere, completed in `ngOnDestroy`.
6. HTTP observables **complete on their own**, but if the component is destroyed mid-request you may still want to cancel; `takeUntilDestroyed` handles that.

```tslib
export class StatsPanelComponent {
  private stats = inject(StatsService);
  constructor() {
    this.stats.connectionQuality$
      .pipe(throttleTime(1000), takeUntilDestroyed())     // auto-unsubscribe on destroy
      .subscribe((q) => this.quality.set(q));
  }
  quality = signal<'good' | 'poor'>('good');
}
```

## Templates, routing, HTTP & forms

### What is the new control flow (`@if`, `@for`, `@switch`) and `@defer`? 🔥

**Built-in control flow** (v17+, stable) replaces `*ngIf`, `*ngFor` and `*ngSwitch`:

- Better type narrowing, no imports needed, faster.
- **`@for` requires `track`** (like React keys). `track item.id` lets Angular reuse DOM nodes; it's the replacement for `trackBy`.
- `@empty`, `@else if` and `@case` blocks.

**`@defer`** **lazy-loads** a part of the template (its components, directives and pipes become a separate chunk) based on **triggers**:

- `on viewport`, `on idle` (default), `on interaction`, `on hover`, `on timer(2s)`, `when condition`
- `prefetch on …` to download early
- sub-blocks: `@placeholder` (with `minimum`), `@loading` (with `after`/`minimum`), `@error`

With SSR, **incremental hydration** (`hydrate on viewport`) hydrates deferred blocks lazily.

```html
@if (user(); as u) {
  <h2>Welcome {{ u.name }}</h2>
} @else {
  <app-login />
}

@for (msg of messages(); track msg.id; let i = $index, last = $last) {
  <app-chat-message [message]="msg" [class.last]="last" />
} @empty {
  <p>No messages yet</p>
}

@defer (on viewport; prefetch on idle) {
  <app-whiteboard />                      <!-- separate lazy chunk -->
} @placeholder (minimum 300ms) {
  <div class="skeleton">Whiteboard</div>
} @loading (after 150ms) {
  <app-spinner />
} @error {
  <p>Couldn't load the whiteboard</p>
}
```

### How does Angular routing work: lazy loading, guards and resolvers? 🔥

```tslib
export const routes: Routes = [
  { path: '', loadComponent: () => import('./home/home.component').then((m) => m.HomeComponent) },
  {
    path: 'meetings/:id',
    loadComponent: () => import('./meeting/meeting.component').then((m) => m.MeetingComponent),
    canActivate: [authGuard],                             // functional guard (v15+)
    canDeactivate: [leaveMeetingGuard],                   // "Leave the meeting?" prompt
    resolve: { meeting: meetingResolver },                // data before activation
  },
  { path: 'admin', loadChildren: () => import('./admin/routes').then((m) => m.ADMIN_ROUTES), canMatch: [adminGuard] },
  { path: '**', loadComponent: () => import('./not-found.component').then((m) => m.NotFoundComponent) },
];

export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? true : inject(Router).createUrlTree(['/login'], { queryParams: { next: state.url } });
};

export const meetingResolver: ResolveFn<Meeting> = (route) => inject(MeetingApi).get(route.paramMap.get('id')!);
```

- **Guard types:**
  - `canActivate` / `canActivateChild`: can the user enter?
  - **`canMatch`**: should this route config match at all? It also prevents **downloading** a lazy chunk the user can't access.
  - `canDeactivate`: can the user leave?
- Read params with `ActivatedRoute` (`paramMap` observable), or bind them to inputs with **`withComponentInputBinding()`**.
- **Preloading strategies:** `withPreloading(PreloadAllModules)` or a custom strategy.

### How do HTTP interceptors work? Write an auth + retry interceptor 🔥

Interceptors sit in the HttpClient pipeline. They can **modify requests** (auth headers, base URLs), **handle responses and errors** globally (refresh tokens on 401, show toasts, log), add **retry** and **caching**, and show loading indicators. Modern Angular uses **functional interceptors** registered with `provideHttpClient(withInterceptors([...]))`.

```tslib
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).accessToken();               // signal
  const authReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req; // requests are immutable
  return next(authReq).pipe(
    retry({ count: 2, delay: (err, attempt) => (err.status >= 500 ? timer(2 ** attempt * 200) : throwError(() => err)) }),
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401) inject(Router).navigate(['/login']);
      return throwError(() => err);
    }),
  );
};
```

Note: `inject()` works inside functional interceptors because they run in an injection context. Call it at the top of the interceptor function, not inside asynchronous callbacks.

### Template-driven vs reactive forms 🔥

| | Template-driven (`FormsModule`) | Reactive (`ReactiveFormsModule`) |
|---|---|---|
| Model defined in | Template (`ngModel`, `#f="ngForm"`) | **Component class** (`FormGroup`, `FormControl`, `FormArray`, `FormBuilder`) |
| Data flow | Asynchronous, two-way | Synchronous, explicit; **`valueChanges` observables** |
| Validation | Directives (`required`, `minlength`) | Validator functions (sync and **async**), cross-field validators |
| Dynamic fields | Awkward | Easy with `FormArray` |
| Testing | Harder (needs a rendered template) | Easy (pure class logic) |
| Typing | Weak | **Strictly typed forms** (v14+) |
| Use for | Simple forms | **Complex, dynamic, validated forms** |

Angular 21 also introduced experimental **Signal Forms**, which model form state with signals.

```tslib
export class ScheduleMeetingComponent {
  private fb = inject(NonNullableFormBuilder);
  form = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(120)]],
    start: ['', Validators.required],
    attendees: this.fb.array<string>([], [Validators.minLength(1)]),
    password: [''],
  }, { validators: [passwordRequiredForWebinar] });

  addAttendee(email: string) { this.form.controls.attendees.push(this.fb.control(email, Validators.email)); }
  submit() { if (this.form.valid) this.api.schedule(this.form.getRawValue()); }   // fully typed value
}
```

### What are pipes? Pure vs impure pipes

Pipes transform values in templates (`{{ startedAt | date:'shortTime' }}`, `| currency`, `| async`).

- **Pure pipes** (the default) re-run **only when the input reference or primitive value changes**. Angular caches them like memoisation, so they're **efficient** and preferable to calling methods in templates, which run on every CD cycle.
- **Impure pipes** (`pure: false`) run on **every** change-detection cycle. They're needed for mutable inputs (the `async` pipe is impure), but they're expensive. Avoid custom impure pipes.

```tslib
@Pipe({ name: 'duration' })                // standalone by default in v19+
export class DurationPipe implements PipeTransform {
  transform(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}
// {{ recording.durationMs | duration }}
```

### How do you write a custom attribute directive?

```tslib
@Directive({ selector: '[appAutoFocus]' })
export class AutoFocusDirective {
  private el = inject(ElementRef<HTMLElement>);
  enabled = input(true, { alias: 'appAutoFocus' });
  constructor() {
    afterNextRender(() => { if (this.enabled()) this.el.nativeElement.focus(); }); // browser-only, after render
  }
}

@Directive({ selector: '[appHoldToTalk]', host: { '(pointerdown)': 'start()', '(pointerup)': 'stop()', '[class.talking]': 'talking()' } })
export class HoldToTalkDirective {
  talking = signal(false);
  start() { this.talking.set(true); }
  stop() { this.talking.set(false); }
}
```

The `host` metadata (or `@HostListener`/`@HostBinding`) binds events and properties on the host element. Use `Renderer2` for SSR-safe DOM manipulation.

## Performance, SSR & state

### How do you optimise an Angular app's performance? 🔥

1. **`OnPush`** everywhere plus **immutable data**, or **signals** (and **zoneless**).
2. **`track`** in `@for` (or `trackBy`) to avoid re-creating DOM.
3. **Pure pipes / `computed`** instead of method calls in templates.
4. **Lazy loading:** routes (`loadComponent`, `loadChildren`) and **`@defer`** blocks.
5. **`runOutsideAngular`** for high-frequency events (mousemove, scroll, rAF loops, WebRTC stats), re-entering only when needed.
6. **Virtual scrolling** (`@angular/cdk/scrolling`, `cdk-virtual-scroll-viewport`) for long lists.
7. **Unsubscribe properly** (async pipe, `takeUntilDestroyed`).
8. **SSR + hydration** (incremental hydration) for faster first paint. **NgOptimizedImage** (`ngSrc`) for images.
9. **Bundle budgets** in `angular.json`, source-map analysis, avoid importing heavy libraries eagerly.
10. Profile with **Angular DevTools** (component tree, change-detection profiler) and the Chrome Performance panel.

### How does SSR and hydration work in modern Angular?

- **`@angular/ssr`** renders the app on the server (Node/Express, or other runtimes) and supports **prerendering (SSG)** for static routes. Route-level render modes (server, client, prerender) are configured in server routes config.
- **Non-destructive hydration** (v16+, `provideClientHydration()`): the client **reuses the server DOM** instead of re-rendering it. That avoids flicker and improves LCP and CLS.
- **Event replay:** user events that happen before hydration are captured and replayed afterwards.
- **Incremental hydration** (stable in v20): `@defer` blocks hydrate **on demand** (`hydrate on viewport`/`interaction`), shipping less JS up front.
- **Constraints:** no direct `window`/`document` access during server rendering. Use `isPlatformBrowser`, `afterNextRender` or `inject(DOCUMENT)`. Avoid DOM manipulation that breaks hydration.

### How do you manage state in Angular? Services vs NgRx vs SignalStore

- **Services with signals** (or a `BehaviorSubject`): enough for most apps. Keep state private, expose read-only signals and methods that mutate.
- **NgRx Store:** Redux-style (actions, reducers, **effects** for side effects with RxJS, **selectors** with memoisation), with DevTools. Use it for large teams and complex, event-heavy domains. More boilerplate.
- **NgRx SignalStore:** a lighter, **signal-based** store (`signalStore(withState, withComputed, withMethods, withHooks)`). Popular for modern Angular.
- **NGXS / Elf / Akita:** alternatives.
- **Server state:** HttpClient with caching, `httpResource`, or TanStack Query for Angular.

### Angular vs React: how would you compare them? 🔥

| | Angular | React |
|---|---|---|
| Type | **Full framework** (router, forms, HTTP, DI, i18n, testing, CLI) | **UI library**; choose your own router, state and data tools (or Next.js) |
| Language | TypeScript-first | JS or TS |
| Templates | HTML templates + Angular syntax, AOT-compiled | JSX |
| Reactivity | **Signals** (fine-grained) + Zone.js legacy; RxJS for streams | `setState` + re-render; React Compiler for memoisation |
| DI | **Built-in hierarchical DI** | Context (not real DI) |
| Learning curve | Steeper (DI, RxJS, decorators) | Gentler start, but architecture decisions are left to you |
| Consistency | Very consistent across teams (enterprise favourite) | Varies per codebase |
| Mobile | Ionic/NativeScript | **React Native** |

**Balanced answer:**

> "Angular is great for large enterprise teams that want conventions and an integrated toolchain. React gives flexibility and the biggest ecosystem. With signals, Angular's reactivity is now closer to Vue and Solid than to React. Moving between them is mostly about DI and RxJS on the Angular side, and hooks discipline on the React side."

### How do you test Angular applications?

- **Unit/component tests:** **TestBed** configures a testing module (`TestBed.configureTestingModule({ imports: [Cmp], providers: [...] })`), then `fixture = TestBed.createComponent(Cmp)`, `fixture.detectChanges()`, and DOM queries.
  - Historically **Jasmine + Karma** was the default (the same stack on your resume). Karma is deprecated, and recent Angular versions support **Jest** and **Vitest** (Vitest is the default in v21).
- **`HttpTestingController`** to mock HTTP; **component harnesses** (CDK testing) for robust interactions with Material components; `fakeAsync`/`tick` for timers.
- **Services:** test them as plain classes or via `TestBed.inject`.
- **E2E:** Playwright or Cypress (Protractor is deprecated).
