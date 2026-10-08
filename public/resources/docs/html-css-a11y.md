# HTML5, CSS3, SASS & Accessibility

Your resume lists HTML5, CSS3, SASS/LESS and Bootstrap, and the scQuill and SCAI work mentions **accessibility improvements**. Senior frontend rounds often include a **CSS deep dive** (cascade, specificity, stacking contexts, layout) and **accessibility** questions, sometimes with live layout tasks.

## HTML

### What is semantic HTML and why does it matter? 🔥

**Semantic HTML** uses elements for their **meaning**: `<header>`, `<nav>`, `<main>`, `<article>`, `<section>`, `<aside>`, `<footer>`, `<button>`, `<form>`, `<label>`, `<table>`, `<figure>`, `<time>`, `<dialog>`. Avoid `<div>` and `<span>` soup.

**Why it matters:**

1. **Accessibility:** screen readers expose **landmarks** and roles, so users can jump to `main` or `nav`. **Native interactive elements are keyboard-accessible for free**: a `<button>` gets focus, Enter/Space activation and a role, while a `<div onClick>` gets none of these.
2. **SEO:** search engines understand the structure (headings, articles).
3. **Maintainability** and less CSS and JS (native behaviours: `<details>`, `<dialog>`, form validation).

**Key distinctions:**

- `<article>` is self-contained and syndicatable (a chat message, a card). `<section>` is a thematic grouping, usually with a heading.
- **One `<h1>` per page is a convention.** The heading hierarchy must not skip levels for screen-reader navigation.
- `<a>` **navigates**; `<button>` **performs an action**. Don't mix them up.

### Explain `<script>`, `async`, `defer` and `type="module"` 🔥

| Attribute | Download | Execution | Order | Use for |
|---|---|---|---|---|
| (none) | **Blocks HTML parsing** | Immediately when downloaded | In order | Rarely (legacy) |
| `async` | In parallel with parsing | **As soon as downloaded** (pauses parsing) | **Not guaranteed** | Independent scripts: analytics |
| `defer` | In parallel | **After parsing finishes**, before `DOMContentLoaded` | **In order** | App scripts that need the DOM |
| `type="module"` | In parallel | **Deferred by default** (can add `async`); strict mode; its own scope; imports | In order (deferred) | Modern bundles, Vite output |

**Resource hints:**

- `<link rel="preload">` for current-page critical resources (fonts, the LCP image)
- `prefetch` for likely next-page resources
- `preconnect` for an early connection to critical origins
- `modulepreload` for JS modules

### What modern HTML elements and APIs should a senior frontend dev use?

- **`<dialog>`** with `showModal()`: top layer, inert background, Escape to close, focus handling. It replaces many modal libraries.
- The **Popover API** (`popover` attribute + `popovertarget`): top-layer popovers with light-dismiss and no JS. Combine with **CSS anchor positioning** for tooltips and menus.
- **`<details>`/`<summary>`:** accessible disclosure widgets.
- **The `inert` attribute:** makes a subtree non-interactive and hidden from assistive tech (for the background behind modals).
- **Form features:** input types (`email`, `tel`, `date`, `number`), **`autocomplete`** tokens (`email`, `one-time-code`, `current-password`), the **Constraint Validation API** (`required`, `pattern`, `setCustomValidity`), `<datalist>`, `<output>`.
- **`loading="lazy"`**, `decoding="async"` and **`fetchpriority`** on images and iframes.
- `<picture>` and `srcset`/`sizes` for responsive images. `<template>` and `<slot>` for Web Components.

## CSS fundamentals

### How does the cascade work, and how is specificity calculated? 🔥

When several rules set the same property on an element, the **cascade** picks the winner by comparing, in order:

1. **Origin and importance:** transitions > `!important` user-agent > `!important` user > `!important` author > animations > normal author > normal user > normal user-agent.
2. **Context** (Shadow DOM encapsulation).
3. **Inline styles** (`style=""`).
4. **Cascade layers** (`@layer`): for normal declarations, **later layers win**, and **unlayered styles beat all layers**. This order is reversed for `!important`.
5. **Specificity** `(ids, classes/attributes/pseudo-classes, elements/pseudo-elements)`, compared left to right. `*` and combinators add nothing.
6. **Source order:** the last declaration wins.

**Specificity rules for functional pseudo-classes:**

- `:is()`, `:not()` and `:has()` take the specificity of their **most specific argument**.
- **`:where()` is always 0**, which is great for overridable library defaults.
- `:nth-child(… of S)` adds the specificity of S.

```js
// A specificity calculator (handles ids, classes, attributes, pseudo-classes/elements, :is/:not/:has/:where)
function specificity(selector) {
  let a = 0, b = 0, c = 0;
  let s = selector;
  // functional pseudo-classes: :where() = 0, :is/:not/:has = max of their arguments
  s = s.replace(/:(where|is|not|has)\(((?:[^()]|\([^()]*\))*)\)/g, (_, fn, args) => {
    if (fn !== 'where') {
      const best = args.split(',').map((x) => specificity(x.trim())).sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2])[0];
      a += best[0]; b += best[1]; c += best[2];
    }
    return ' ';
  });
  s = s.replace(/\[[^\]]*\]/g, () => { b++; return ' '; });             // [attr]
  s = s.replace(/::[\w-]+/g, () => { c++; return ' '; });               // ::pseudo-element
  s = s.replace(/:[\w-]+(\([^)]*\))?/g, () => { b++; return ' '; });    // :pseudo-class
  s = s.replace(/#[\w-]+/g, () => { a++; return ' '; });                // #id
  s = s.replace(/\.[\w-]+/g, () => { b++; return ' '; });               // .class
  (s.match(/(^|[\s>+~])([a-zA-Z][\w-]*)/g) ?? []).forEach(() => c++);   // element names
  return [a, b, c];
}

const rules = [
  '#call .tile.speaking > video',
  'main nav a:hover',
  'ul li:nth-child(2)::before',
  ':where(.btn) button',
  '.toolbar :is(#mute, .btn)',
  'button:not(.primary, [disabled])',
  'input[type="text"]:focus-visible',
];
console.table(rules.map((r) => ({ selector: r, specificity: specificity(r).join(',') })));

test('specificity', () => {
  expect(specificity('#call .tile.speaking > video')).toEqual([1, 2, 1]);
  expect(specificity(':where(.btn) button')).toEqual([0, 0, 1]);
  expect(specificity('.toolbar :is(#mute, .btn)')).toEqual([1, 1, 0]);
  expect(specificity('button:not(.primary, [disabled])')).toEqual([0, 1, 1]);
  expect(specificity('ul li:nth-child(2)::before')).toEqual([0, 1, 3]);
});
```

**Practical advice:**

- Keep specificity **low and flat** (single classes, as in BEM).
- Use **`@layer`** to order resets, libraries, components and utilities instead of fighting specificity.
- Avoid IDs in selectors and avoid `!important`, except in utilities.

### Explain the box model and `box-sizing` 🔥

Every element is a box made of **content → padding → border → margin**.

- **`box-sizing: content-box`** (the default): `width` sets only the **content** width. Padding and border are **added**, so `width: 200px; padding: 20px; border: 1px` renders **242px** wide.
- **`box-sizing: border-box`:** `width` **includes** padding and border, which makes layouts predictable. Nearly every reset applies `*, *::before, *::after { box-sizing: border-box; }`.
- **Margins aren't part of the size.** **Vertical margins between blocks collapse** (they're in the same block formatting context, with no padding or border between them): the larger margin wins. **Margins don't collapse** on flex or grid items, or on elements that establish a BFC with their children.
- **Inline elements** ignore `width`/`height` and vertical margins.

### What is a stacking context? Why doesn't my `z-index: 9999` work? 🔥

`z-index` only compares elements **within the same stacking context**. A **stacking context** is created by:

- the root element
- `position: relative|absolute` **with** `z-index` other than `auto`
- `position: fixed|sticky` (always)
- **`opacity` < 1**, **`transform`**, `filter`, `perspective`, `clip-path`, `mask`
- **`isolation: isolate`**, `mix-blend-mode` other than normal
- `will-change` naming one of these properties
- `contain: layout|paint`
- flex or grid children with a `z-index` other than `auto`

**The classic bug:** a modal with `z-index: 9999` sits inside a parent with `transform: translateX(0)` or `opacity: 0.99`. The parent created a stacking context with an effective z-index lower than a sibling's, so **the child can never escape it**, whatever its z-index.

**Fixes:**

- render overlays at the top level (**portals**, or the **top layer** via `<dialog>`/popover)
- avoid creating stacking contexts on ancestors
- use `isolation: isolate` deliberately to contain z-index wars inside components

### What is a Block Formatting Context (BFC) and when do you need one?

A **BFC** is an isolated layout region. Inside it:

- floats are contained (the parent's height includes them)
- **margins of children don't collapse with the parent's margins**
- floats outside don't overlap it

**Create one with:**

- **`display: flow-root`** (the modern, side-effect-free way)
- `overflow` other than `visible`
- `display: inline-block`
- flex/grid items, `position: absolute|fixed`
- `contain: layout|paint`

**Uses:** clearing floats (instead of clearfix hacks) and preventing margin collapse between a parent and its first child.

### `position`: relative, absolute, fixed and sticky 🔥

- **`static`** (the default): normal flow; `top`/`left` have no effect.
- **`relative`:** offset from its normal position; **its original space is kept**. Also the usual **containing block** for absolute children.
- **`absolute`:** **removed from flow**, positioned relative to the **nearest positioned ancestor** (anything not static), or a `transform`/`filter`/`contain` ancestor, otherwise the initial containing block.
- **`fixed`:** relative to the **viewport**, *unless* an ancestor has `transform`, `filter` or `perspective`. Then it behaves like absolute within that ancestor, which surprises people.
- **`sticky`:** acts as relative until a scroll threshold (`top: 0`), then sticks **within its scroll container and parent's bounds**.
  - It needs a threshold (`top`/`bottom`).
  - It doesn't work if an ancestor between it and the scroller has `overflow: hidden|auto|scroll` (that ancestor becomes the scroll container).
  - It stops sticking when its parent scrolls out of view.

### Flexbox: explain `flex: 1`, alignment and common gotchas 🔥

- **Axes:** `flex-direction` sets the **main axis**. `justify-content` aligns along the main axis; `align-items`/`align-content` along the **cross axis**. `gap` controls spacing.
- **`flex: <grow> <shrink> <basis>`:**
  - **`flex: 1`** means `1 1 0%`: grow equally from a zero basis, so items get **equal widths** regardless of content
  - `flex: auto` means `1 1 auto` (sizes start from content)
  - `flex: none` means `0 0 auto` (rigid)
- **The big gotcha:** flex items have **`min-width: auto`**. They **won't shrink below their content's minimum size**. A long URL or a `<pre>` overflows the container, and text-overflow ellipsis doesn't work. **Fix:** `min-width: 0` (or `overflow: hidden`) on the flex child. Same with `min-height` in column layouts.
- `margin-left: auto` pushes an item to the far end (e.g. a toolbar's right-aligned button).
- `flex-wrap: wrap` plus `flex: 1 1 200px` gives responsive cards without media queries.

```css
/* Toolbar: left actions, spacer, right actions; text truncates instead of overflowing */
.toolbar { display: flex; align-items: center; gap: 8px; }
.toolbar .title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.toolbar .leave { margin-left: auto; }
```

### CSS Grid: how would you build a responsive video-conference tile layout? 🔥

**Grid** is two-dimensional (rows *and* columns).

- `grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))` gives a **responsive grid with no media queries**.
- **`auto-fill`** keeps empty tracks. **`auto-fit`** collapses them, so the existing items stretch.
- `fr` units distribute the remaining space.
- `grid-template-areas` gives readable layouts. `subgrid` aligns nested grids. The implicit grid handles overflow rows (`grid-auto-rows`).

```css
/* Tile view: as many 16:9 tiles as fit, each at least 240px wide */
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 8px;
  padding: 8px;
  height: 100dvh;                     /* dynamic viewport height: correct on mobile browsers */
  align-content: center;
}
.tile { aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; background: #111; position: relative; }
.tile video { width: 100%; height: 100%; object-fit: cover; }
.tile.screen-share video { object-fit: contain; }           /* never crop shared screens */

/* Stage view: big speaker + filmstrip, rearranged with areas */
.stage { display: grid; grid-template: "speaker" 1fr "strip" 120px / 1fr; height: 100dvh; }
@media (min-width: 900px) { .stage { grid-template: "speaker strip" 1fr / 1fr 220px; } }
.stage .speaker { grid-area: speaker; }
.stage .filmstrip { grid-area: strip; display: flex; gap: 8px; overflow: auto; }
```

**Flexbox vs Grid:** **Flexbox for one-dimensional** content-driven layouts (toolbars, navs, a row of chips). **Grid for two-dimensional**, layout-driven structures (pages, tile views, dashboards, forms with aligned labels). They combine well.

### How do you center an element? (Every way that matters)

- **Grid:** `display: grid; place-items: center;` (the shortest).
- **Flex:** `display: flex; justify-content: center; align-items: center;`.
- **Absolute:** `position: absolute; inset: 0; margin: auto;` (with a known size), or `top: 50%; left: 50%; transform: translate(-50%, -50%);` (unknown size).
- **Horizontal block:** `margin-inline: auto` with a width. **Text:** `text-align: center`.
- **Block layout** (newer browsers): `align-content: center` works on regular block containers too.

### Responsive design: media queries vs container queries, units and fluid type 🔥

- **Mobile-first:** base styles for small screens, then `@media (min-width: …)` enhancements.
- Media features: `prefers-color-scheme`, **`prefers-reduced-motion`**, `hover`/`pointer` (touch vs mouse), `orientation`, `resolution`.
- **Container queries:** `container-type: inline-size` on a parent, then `@container (min-width: 400px) { … }`. Components adapt to **their container**, not the viewport. That's essential for reusable components (a participant card in a sidebar vs on the stage). Container query units: `cqi`, `cqw`.
- **Units:**
  - `rem` for type and spacing (respects user font settings)
  - `em` relative to the parent font
  - `%`
  - `vw`/`vh` and the **dynamic viewport units `dvh`/`svh`/`lvh`** (fix the mobile 100vh address-bar problem)
  - `ch` for line length
- **Fluid typography:** `font-size: clamp(1rem, 0.9rem + 0.5vw, 1.25rem)`.
- **Responsive images:** `srcset`/`sizes`, `<picture>`, `object-fit`, `aspect-ratio` to prevent CLS.

### CSS custom properties vs SASS variables 🔥

| | SASS `$variables` | CSS custom properties `--vars` |
|---|---|---|
| When resolved | **Compile time** (gone in the output CSS) | **Runtime** in the browser |
| Change with JS or media queries | ❌ | ✅ `el.style.setProperty('--level', 0.7)`; redefine in `@media`/`[data-theme]` |
| Cascade and inheritance | No (lexical scope) | **Yes**: inherited and scoped to elements |
| Use for | Build-time constants, maths, loops, mixin parameters | **Theming (dark mode)**, component APIs, dynamic values (an audio-level meter driven from JS without React re-renders) |

**`@property`** registers a custom property with a type, so it can be **animated** (`syntax: '<length>'`) and has an initial value.

```css
:root { --bg: #fff; --text: #1b1d29; --accent: #4f46e5; }
:root[data-theme="dark"] { --bg: #0f1117; --text: #e6e8f0; --accent: #8b85ff; }
.meter { height: 6px; transform-origin: left; transform: scaleX(var(--level, 0)); transition: transform 80ms linear; }
```

This app's own theme uses exactly this pattern: tokens on `:root`, redefined for dark mode.

### What SASS/SCSS features do you use, and what's changed recently? 🔥

- **Variables, nesting** (with `&` for BEM modifiers and pseudo-classes), **partials** (`_buttons.scss`).
- **`@mixin`/`@include`** with parameters, e.g. a breakpoint mixin.
- **Functions** (`@function`, `math.div`, `color.adjust`), **maps and `@each` loops** for generating utility classes.
- **`@extend` with `%placeholders`**: use sparingly, because it can bloat selectors.
- **The module system:** **`@use` and `@forward`** replace `@import`. `@import` is **deprecated** in Dart Sass and being removed. `@use` namespaces variables (`@use 'tokens' as t; t.$space-2`) and loads each module once.
- **Dart Sass** is the only maintained implementation; LibSass and node-sass are deprecated.
- **LESS** (also on your resume) is similar: `@variables`, mixins as classes, guards. The ecosystem has moved mostly to SCSS or native CSS.
- **Native CSS now has nesting**, custom properties, `color-mix()` and `@layer`, so **less preprocessor work is needed**. Many teams keep SASS mainly for mixins and loops.

```scss
@use 'sass:map';
@use 'tokens' as t;

$breakpoints: (sm: 600px, md: 900px, lg: 1200px);
@mixin up($bp) {
  @media (min-width: map.get($breakpoints, $bp)) { @content; }
}

.tile {
  border-radius: t.$radius-lg;
  &--speaking { outline: 3px solid t.$accent; }      // BEM modifier via &
  &__name { font-weight: 600; }
  @include up(md) { border-radius: t.$radius-xl; }
}

@each $name, $value in (1: 4px, 2: 8px, 3: 16px) {
  .gap-#{$name} { gap: $value; }
}
```

### How do you organise CSS at scale? BEM vs CSS Modules vs CSS-in-JS vs Tailwind 🔥

| Approach | How | Pros | Cons |
|---|---|---|---|
| **BEM** (`.block__element--modifier`) | Naming convention | Flat specificity, readable, no tooling | Discipline required, verbose names, global namespace |
| **CSS Modules** | Class names **scoped per file** at build time (`styles.tile`) | Real local scope, plain CSS, zero runtime | Theming via CSS variables; composition is a bit clunky |
| **CSS-in-JS, runtime** (styled-components, Emotion) | Styles in JS, generated at runtime | Dynamic styles from props, colocated | **Runtime cost**, larger bundles, **problematic with React Server Components and streaming SSR**; teams are migrating away |
| **Zero-runtime CSS-in-JS** (vanilla-extract, Linaria, Panda, StyleX) | Styles in TS, extracted at build time | Type-safe, no runtime cost | Build setup |
| **Utility-first** (Tailwind) | Compose small utility classes in markup | Fast development, consistent design tokens, tiny CSS output (JIT), no naming | Noisy markup; needs component abstractions for reuse |
| **Bootstrap** (on your resume) | Component and utility framework | Quick and consistent | Generic look, overriding fights, heavier CSS |

**A good senior answer:** pick based on the team and the rendering model. For RSC-heavy Next.js apps, avoid runtime CSS-in-JS. Use **design tokens as CSS variables** whatever the method, so theming works everywhere.

### How do you make CSS animations performant? 🔥

- Animate **`transform` and `opacity` only** where possible. They're handled by the **compositor thread** (GPU), with no layout or paint. Animating `width`, `height`, `top`, `left` or `margin` triggers **layout** on every frame, and `box-shadow` or `background` trigger **paint**.
- **`will-change: transform`** promotes an element to its own layer ahead of time. Use it sparingly and temporarily, because layers cost memory.
- Prefer **CSS transitions and animations** (or the Web Animations API) to JS-driven per-frame style updates. If you use JS, use `requestAnimationFrame`.
- **Respect `prefers-reduced-motion`:** reduce or remove non-essential motion.
- **Modern options:**
  - **View Transitions API** (`document.startViewTransition`, and cross-document view transitions) for page and state transitions
  - **scroll-driven animations** (`animation-timeline: scroll()`), which run off the main thread

```css
.toast { transform: translateY(16px); opacity: 0; transition: transform 200ms ease, opacity 200ms ease; }
.toast.show { transform: translateY(0); opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

### Which modern CSS features should you know (2023–2026)? 🔥

- **`:has()`**, the "parent selector": `.tile:has(video[data-muted])`, `form:has(:invalid) button { opacity: .5 }`.
- **Container queries** and container units.
- **Cascade layers** (`@layer reset, base, components, utilities;`).
- **Native nesting** (`.card { &:hover { … } }`).
- **Subgrid.**
- **`color-mix()`**, relative colour syntax, `oklch()`.
- **Logical properties** (`margin-inline`, `padding-block`, `inset-inline-start`) for RTL support.
- **`@property`**, `aspect-ratio`, **`dvh`** units.
- **The View Transitions API**, scroll-driven animations.
- **Anchor positioning** (`anchor-name`, `position-anchor`, `position-area`) for tooltips and menus without JS positioning libraries.
- **The Popover API** plus `:popover-open`.
- **`text-wrap: balance | pretty`**, `field-sizing: content` (auto-growing textareas).

## Accessibility (a11y)

### What is web accessibility and what are the WCAG principles? 🔥

**Accessibility** means people with disabilities can use your product: visual (blindness, low vision, colour blindness), motor (keyboard-only, switch devices), auditory (deaf users need captions), and cognitive.

**WCAG 2.2** (the current W3C standard) organises requirements under **POUR**:

1. **Perceivable:** text alternatives (alt text), **captions** for media, sufficient **contrast**, content that adapts (zoom, reflow), not relying on colour alone.
2. **Operable:** **everything works with a keyboard**, no keyboard traps, enough time, no seizure-inducing flashes, **visible focus**, **target size** (WCAG 2.2: at least 24×24 CSS px), skip links.
3. **Understandable:** clear labels and instructions, predictable behaviour, error identification and suggestions, language declared (`<html lang>`).
4. **Robust:** valid, semantic markup that works with assistive technologies (correct name, role and value via HTML or ARIA).

**Conformance levels:** A, **AA (the usual legal and business target)**, AAA. **Legal context:** ADA/Section 508 in the US, and the **European Accessibility Act**, enforced from June 2025. Government customers such as the DA's office (scQuill) typically **require** WCAG AA or Section 508 compliance.

### What is ARIA and when should you use it? 🔥

**ARIA** (Accessible Rich Internet Applications) adds **roles**, **states** and **properties** that describe custom widgets to assistive tech, e.g. `role="tablist"`, `aria-selected`, `aria-expanded`, `aria-controls`.

- **The first rule of ARIA:** **don't use ARIA if a native element does the job.** `<button>` beats `<div role="button" tabindex="0" onKeyDown=…>`. **No ARIA is better than bad ARIA**: incorrect roles make things worse.
- **ARIA changes semantics only, never behaviour.** You must still add keyboard handling and focus management.
- **Naming:**
  - **`aria-label`:** a string label, for icon-only buttons (`aria-label="Mute microphone"`)
  - **`aria-labelledby`:** reference visible text by ID (preferred when visible text exists)
  - **`aria-describedby`:** extra description (hint and error text)
- **State:** `aria-pressed` for toggle buttons such as mute and camera, `aria-expanded` for menus and accordions, `aria-checked`, `aria-disabled`, `aria-current="page"`.
- **`aria-hidden="true"`** hides decorative content from screen readers. Never put it on focusable elements.
- **Live regions:** `aria-live="polite"` (or `role="status"`) and `aria-live="assertive"` (or `role="alert"`) announce dynamic updates **without moving focus**. In a meeting app: *"Asha joined"*, *"Recording started"*, *"You are muted"*, new chat messages.

```html
<!-- Toggle button with state, icon hidden from screen readers -->
<button type="button" aria-pressed="true" aria-label="Microphone" class="mic-btn">
  <svg aria-hidden="true" focusable="false"><!-- mic-off icon --></svg>
</button>

<!-- Polite announcements for meeting events -->
<div role="status" aria-live="polite" class="visually-hidden" id="meeting-announcer"></div>
<script>
  function announce(message) {
    const el = document.getElementById('meeting-announcer');
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = message; });   // re-set so repeats are announced
  }
  // announce('Recording started. Everyone in the meeting has been notified.');
</script>
```

### How do you make a single-page app keyboard accessible? 🔥

1. **Everything interactive is reachable and operable by keyboard:** Tab and Shift+Tab, Enter/Space on buttons, arrow keys inside composite widgets (tabs, menus, grids, toolbars).
2. **Visible focus:** never `outline: none` without a replacement. Use **`:focus-visible`** to show focus rings for keyboard users but not for mouse clicks.
3. **Logical focus order** follows the DOM order. **Avoid positive `tabindex`.** `tabindex="0"` makes custom elements focusable; `tabindex="-1"` allows programmatic focus only.
4. **Focus management:**
   - **Route changes:** move focus to the new page's `<h1>` or main region and announce the title. SPAs don't do this automatically, unlike full page loads.
   - **Modals:** move focus inside on open, **trap focus**, close with Escape, **restore focus** to the trigger on close. `<dialog>` does most of this for you.
   - **Deleting items:** move focus to a sensible neighbour.
5. **Skip link** ("Skip to main content") as the first focusable element.
6. **Roving tabindex** for composite widgets: only one item in a toolbar or grid has `tabindex=0`, and arrow keys move focus between items. One Tab stop per widget.
7. **Keyboard shortcuts** for power users (a conferencing app: `M` to mute, `V` for camera, `Space` push-to-talk). They must be **documented**, **not conflict with screen-reader keys**, and be **remappable or disableable** (WCAG 2.1.4 Character Key Shortcuts).

### How do you check colour contrast? Show the WCAG formula 🔥

WCAG contrast ratio = `(L1 + 0.05) / (L2 + 0.05)`, where L is the **relative luminance** of the lighter (L1) and darker (L2) colour.

**Requirements (AA):**

- **4.5:1** for normal text
- **3:1** for large text (≥ 24px, or ≥ 18.66px bold)
- **3:1** for **UI components and graphical objects**: focus rings, input borders, icons

AAA requires 7:1 for normal text.

```js
function relativeLuminance(hex) {
  const [r, g, b] = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16) / 255);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);   // sRGB -> linear
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(fg, bg) {
  const [l1, l2] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

function wcag(fg, bg) {
  const ratio = contrastRatio(fg, bg);
  return { pair: `${fg} on ${bg}`, ratio: ratio.toFixed(2), AA_text: ratio >= 4.5, AA_large: ratio >= 3, AAA_text: ratio >= 7 };
}

console.table([
  wcag('#000000', '#ffffff'),
  wcag('#767676', '#ffffff'),   // the classic "lightest grey that passes AA on white"
  wcag('#4f46e5', '#ffffff'),
  wcag('#9aa1b5', '#0f1117'),
  wcag('#ffcc00', '#ffffff'),   // yellow on white fails badly
]);

test('contrast ratios', () => {
  expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
});
```

Also: **don't rely on colour alone**. A red border on an invalid field also needs an icon or text. scQuill's low-confidence words used underline styles **and** tooltips, not only colour.

### How do you build accessible forms?

- Every input has a **`<label for>`** (or wraps it). **Placeholders aren't labels**: they disappear and often have low contrast.
- Group related inputs with **`<fieldset>` + `<legend>`** (radio groups, address blocks).
- **Errors:**
  - associate them with `aria-describedby`
  - set `aria-invalid="true"`
  - announce them (`role="alert"` or a summary at the top with links to the fields)
  - **move focus to the first invalid field** on submit
- Mark required fields with `required` (and visibly, not just with colour). Give **clear instructions** and formats up front.
- Use **`autocomplete` attributes** (`name`, `email`, `one-time-code`, `new-password`) to help everyone, especially users with motor or cognitive disabilities.
- Don't disable the submit button without explaining why. Allow submission and show the errors instead.

### How do you test accessibility? 🔥

1. **Automated tools** (they catch roughly 30–50% of issues):
   - **axe** (browser extension, `@axe-core/react`, `jest-axe`, Playwright axe integration)
   - Lighthouse
   - **eslint-plugin-jsx-a11y**
2. **Keyboard-only testing:** unplug the mouse. Can you reach and use everything? Is the focus always visible? Any traps?
3. **Screen readers:** **NVDA** (Windows, free) + Firefox/Chrome, **VoiceOver** (macOS/iOS), TalkBack (Android), JAWS. Navigate by headings, landmarks and form controls.
4. **Zoom to 200–400%** and check reflow at 320px width; increase text spacing; use high-contrast/forced-colours mode.
5. **Write tests that use accessible queries:** React Testing Library's `getByRole('button', { name: /mute/i })` fails when the accessibility tree is wrong, so tests double as a11y checks.
6. **Include real users with disabilities** and follow a11y acceptance criteria in the Definition of Done.

### What accessibility features matter in a video-conferencing app?

- **Captions and transcripts** (live transcription via Jigasi or a cloud ASR). Let users **pin a sign-language interpreter**, and keep the interpreter visible.
- **Screen-reader announcements** for joins and leaves, hand raises, chat messages, recording start/stop and mute state changes, all with **polite** live regions and throttling so they aren't overwhelming.
- **Full keyboard control:** documented shortcuts (mute, camera, raise hand, leave), a focusable tile grid with roving focus, and an accessible participant list.
- **Visual:** a **focus indicator** on video tiles, a speaking indicator that **isn't colour-only** (outline plus icon), reduced motion for reactions and animations, high-contrast mode.
- **Audio:** noise suppression, separate volume per participant, visual alerts for sounds (a notification banner when someone joins).
- **Cognitive:** clear labels ("Leave meeting" vs "End meeting for all"), confirmations for destructive actions, a consistent layout.
