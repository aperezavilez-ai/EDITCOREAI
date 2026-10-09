---
name: ui-ux-pro-max
description: >-
  Advanced UI/UX engineering system for high-converting, accessible, and polished user interfaces.
  Covers visual hierarchy, semantic spacing, atomic layout, interaction states, theme management,
  and accessible color palettes (WCAG AAA). Use when building or refining web and app interfaces.
---

# UI/UX Pro Max Design System & Guidelines

This skill guides the creation and refinement of world-class user interfaces with meticulous attention to detail.

## 1. Visual Hierarchy & Spacing
- **4pt/8pt Spatial System**: Use predictable multi-step scales (`4px`, `8px`, `12px`, `16px`, `24px`, `32px`, `48px`, `64px`).
- **Typographic Scale**:
  - `Display / Hero`: 36px - 48px, bold, tight letter-spacing (`-0.02em`).
  - `H1 / Page Title`: 24px - 30px, semi-bold.
  - `H2 / Section Title`: 18px - 20px, medium/semi-bold.
  - `Body / Primary`: 14px - 15px, line-height 1.5 - 1.6.
  - `Caption / Metadata`: 12px - 13px, muted color, line-height 1.4.
- **Z-Index System**:
  - Background/Canvas: `0`
  - Cards/Containers: `1` - `5`
  - Sticky Headers/Navbars: `10` - `50`
  - Dropdowns & Popovers: `100` - `500`
  - Modals & Dialogs: `1000` - `2000`
  - Toast Notifications: `5000`+

## 2. Complete Interaction States
Every interactive element (button, input, row, card) must implement all 5 critical states:
1. **Default**: Clean, distinct resting state with appropriate elevation.
2. **Hover**: Subtle brightness change (+5% to +10%) or border accentuation, scale `1.01` with smooth easing.
3. **Focus / Active**: High-contrast outline (`2px solid var(--accent)` with `2px offset`) for keyboard navigation and instant tactile feedback on click (`scale(0.98)`).
4. **Loading / Pending**: Spinner or skeleton shimmer, disabled click events, preserved element dimensions.
5. **Disabled / Error**: Clear opacity reduction (`0.5`), `cursor: not-allowed`, or red outline (`#ef4444`) with descriptive error text underneath.

## 3. Dark Mode & Semantic Palette
- Never use pure black (`#000000`) for surfaces; use deep slate/zinc (`#090d16`, `#0f172a`, `#1e293b`).
- Establish semantic token variables:
  - `--bg-primary`, `--bg-surface`, `--bg-elevated`
  - `--text-primary`, `--text-secondary`, `--text-muted`
  - `--border-subtle`, `--border-strong`
  - `--accent-primary`, `--accent-hover`, `--accent-subtle`
  - `--status-success`, `--status-warning`, `--status-error`, `--status-info`

## 4. Accessibility & Touch Targets
- Minimum touch/click target size: `44x44px` on mobile/touch interfaces.
- Contrast ratio: Minimum `4.5:1` for body text and `3:1` for large headers against backgrounds.
- Explicit `aria-label`, `role`, and keyboard traps inside modals with `Escape` to close.
