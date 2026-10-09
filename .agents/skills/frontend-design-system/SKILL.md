---
name: frontend-design-system
description: >-
  Modern web component architecture, responsive layouts, container queries, CSS variables,
  and cutting-edge frontend patterns (Tailwind, View Transitions, :has(), subgrid).
---

# Frontend Design System & Architecture

This skill governs modern frontend development practices across HTML, CSS, JavaScript, and frameworks.

## 1. Modern CSS & Responsive Layouts
- **Container Queries**:
  ```css
  .card-container {
    container-type: inline-size;
  }
  @container (min-width: 400px) {
    .card {
      display: grid;
      grid-template-columns: 120px 1fr;
    }
  }
  ```
- **Parent Selector `:has()`**:
  ```css
  /* Style card when it contains a featured badge */
  .card:has(.badge-featured) {
    border-color: var(--accent-color);
  }
  ```
- **Clamp for Fluid Typography & Spacing**:
  ```css
  font-size: clamp(1rem, 0.9rem + 0.5vw, 1.25rem);
  padding: clamp(1rem, 2vw, 2rem);
  ```

## 2. Component Architecture
- **Atomic Principles**:
  - `Tokens`: Color variables, typography tokens, spacing tokens.
  - `Atoms`: Buttons, badges, icons, inputs, tooltips.
  - `Molecules`: Search bars, user avatar chips, form input groups.
  - `Organisms`: Navigation bars, sidebars, data tables, modals.
  - `Templates / Pages`: View layouts and dashboards.
- **Controlled vs Uncontrolled Components**: Ensure form components propagate state cleanly without memory leaks or race conditions.

## 3. Performance & Asset Delivery
- `loading="lazy"` on non-critical images and `decoding="async"`.
- `fetchpriority="high"` on hero images and critical assets.
- Preconnect critical fonts and CDN domains.
