---
name: impeccable-design
description: >-
  Precision visual aesthetics, glassmorphism, micro-animations (60fps), and typography refinement.
  Use when elevating UI quality from standard to award-winning aesthetic standards.
---

# Impeccable Design Guidelines & Micro-Aesthetics

This skill provides design craftsmanship rules to create visually stunning, modern software interfaces.

## 1. Glassmorphism & Depth
- **Subtle Blur**: Use `backdrop-filter: blur(12px) saturate(180%)` with low-opacity alpha backgrounds (`rgba(255, 255, 255, 0.05)` for dark mode, `rgba(255, 255, 255, 0.8)` for light mode).
- **Hairline Borders**: `border: 1px solid rgba(255, 255, 255, 0.08)` on dark backgrounds gives a crisp definition without visual noise.
- **Layered Shadows**:
  ```css
  box-shadow: 
    0 1px 2px 0 rgba(0, 0, 0, 0.05),
    0 4px 6px -1px rgba(0, 0, 0, 0.1),
    0 20px 25px -5px rgba(0, 0, 0, 0.15);
  ```

## 2. Fluid Micro-Animations (60 FPS)
- Use CSS transitions on hardware-accelerated properties: `transform`, `opacity`, `filter`.
- Standard cubic bezier: `cubic-bezier(0.16, 1, 0.3, 1)` (spring-like ease out).
- Micro durations:
  - Fast feedback (hover/click): `120ms` - `180ms`
  - Panel reveals / slide-overs: `240ms` - `320ms`
  - Modal entries: `200ms` scale + fade
- Avoid animating `width`, `height`, `margin`, `padding`, `top`, `left` directly; use flex/grid or `transform: translate3d(...)` instead.

## 3. Typography & Editorial Rhythm
- Use system native font stacks or premium sans-serifs (Inter, SF Pro, Segoe UI):
  ```css
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  ```
- Balance line lengths: Keep paragraph text between `45` and `75` characters per line (`max-width: 65ch`).
- Tabular numbers for currencies, stats, and counters: `font-variant-numeric: tabular-nums;`.
