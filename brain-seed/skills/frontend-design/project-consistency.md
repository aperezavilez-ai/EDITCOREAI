# Keeping a project visually consistent across sessions

A single well-designed screen is easy. What makes a multi-screen project look
professionally designed (the v0 effect) is that every screen draws
from the *same* small set of decisions instead of reinventing them each time.

## The rule

Before generating any UI in a project, look for `design-tokens.css` (or
`design-tokens.json` for non-CSS stacks) at the project root or in
`src/styles/`. If it exists, use its values — don't invent new colors, fonts,
or spacing. If it doesn't exist and this is the first UI screen in the
project, create one from the template below (adapted to the aesthetic
direction you chose per the main skill), then use it.

## Starter template (`design-tokens.css`)

```css
:root {
  /* Color — one dominant hue, one sharp accent, neutrals for the rest.
     Replace these placeholders with the actual palette for this project's
     aesthetic direction; never ship the placeholders verbatim. */
  --color-bg: #0b0b0f;
  --color-surface: #16161d;
  --color-text: #f2f1ec;
  --color-text-muted: #a3a1ab;
  --color-accent: #ff5a36;
  --color-border: #2a2a33;

  /* Type — a distinctive display face + a refined body face, not the same
     font for both. Pick real font names, not "sans-serif". */
  --font-display: "Replace Me Display", serif;
  --font-body: "Replace Me Body", sans-serif;
  --font-size-base: 16px;
  --scale-ratio: 1.25; /* type scale: base * ratio^n per step */

  /* Spacing — one scale, reused everywhere instead of ad-hoc px values. */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 16px;
  --space-4: 24px;
  --space-5: 40px;
  --space-6: 64px;

  /* Motion — one easing curve and one duration family, reused. */
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-fast: 150ms;
  --duration-base: 300ms;
}
```

For a JS/TS-driven design system (Tailwind config, styled-components theme,
CSS-in-JS), translate the same categories — color/type/spacing/motion — into
that project's native token format instead of adding a parallel CSS file.

## Applying it

- Every new component reads from these variables — no inline hex codes, no
  one-off font-family declarations, no magic spacing numbers.
- Extending the palette (e.g. a success/error state) means adding a token,
  not picking a color that "looks close enough" inline.
- If a later screen genuinely needs to break the system (a landing page vs.
  an app shell, say), that's a second token file for that context — not
  silent drift in the first one.
