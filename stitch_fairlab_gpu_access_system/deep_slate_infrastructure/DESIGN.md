---
name: Deep Slate Infrastructure
colors:
  surface: '#0f131c'
  surface-dim: '#0f131c'
  surface-bright: '#353942'
  surface-container-lowest: '#0a0e16'
  surface-container-low: '#181c24'
  surface-container: '#1c2028'
  surface-container-high: '#262a33'
  surface-container-highest: '#31353e'
  on-surface: '#dfe2ee'
  on-surface-variant: '#c2c6d6'
  inverse-surface: '#dfe2ee'
  inverse-on-surface: '#2c3039'
  outline: '#8c909f'
  outline-variant: '#424754'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e6a'
  primary-container: '#4d8eff'
  on-primary-container: '#00285d'
  inverse-primary: '#005ac2'
  secondary: '#4edea3'
  on-secondary: '#003824'
  secondary-container: '#00a572'
  on-secondary-container: '#00311f'
  tertiary: '#ffb95f'
  on-tertiary: '#472a00'
  tertiary-container: '#ca8100'
  on-tertiary-container: '#3e2400'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#0f131c'
  on-background: '#dfe2ee'
  surface-variant: '#31353e'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-code-lg:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-code-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-code-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 14px
  label-metric:
    fontFamily: JetBrains Mono
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 28px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

The design system embodies an academic-engineering hybrid ethos: rigorous, high-throughput, and strictly egalitarian. Built specifically for institutional laboratory governance, it bridges developer platform agility (inspired by Linear and Vercel) with the robust operational observability of infrastructure dashboards (such as Datadog). 

The emotional signature is one of objective fairness, scientific utility, and zero-latency clarity. Visual noise is stripped away in favor of dense tabular metrics, real-time node state telemetry, and explicit priority-queue calculations. The design style combines:
- **High-Density Technical Utility:** Grid-aligned data, explicit system telemetry, and high contrast against dark terminal states.
- **Instrumental Glass & Tonal Layering:** Deep slate backgrounds hosting subtly bordered, translucent cards to represent physical workstations and server racks without visual clutter.
- **Micro-Status Telegraphy:** Vivid semantic color strikes indicating node viability, live reservations, and priority allocations at a glance.

## Colors

The system uses a dark-first operational mode to reduce fatigue in dimly lit computer labs while providing high legibility for computational telemetry. 

- **Surface Tiers:**
  - `Base Canvas`: `#0B0F17` (Deep Slate Void)
  - `Node/Card Elevation`: `#111827` (Charcoal Slate)
  - `Surface Interactive`: `#1E293B` (Border & Active Highlight)
  - `Surface Raised/Overlay`: `#0F172A` with 80% opacity and 12px blur for access modals and passcards.
- **Semantic Accents:**
  - `Primary (Cyber Cobalt / Indigo)`: `#3B82F6` and `#4F46E5`. Anchors primary interactions, GPU allocation progress, and compute job submission.
  - `Success / Available (Electric Emerald)`: `#10B981`. Denotes node availability, verified access tokens, and high fair-share priority ratings.
  - `Warning / Queue (Warm Amber)`: `#F59E0B`. Reserved for active timeouts, pending fairness-queue allocations, and preemptible session limits.
  - `Danger / Alert (Crimson)`: `#EF4444`. Strictly demarcates node hardware locks, maintenance flags, VRAM thermal cutoffs, and lab policy violations.
- **Foreground & Text:**
  - High-priority specs and labels: `#F8FAFC`
  - Body and secondary readouts: `#94A3B8`
  - De-emphasized labels and architectural delimiters: `#475569`

## Typography

The typographic hierarchy separates structured textual content from dense technical telemetry:

- **Structural UI (Inter & Plus Jakarta Sans):** Plus Jakarta Sans drives dashboard overview headers and physical lab signage banners, providing contemporary, humanized framing. Inter handles running data, settings forms, user profiles, and systemic instructional text with neutral clarity.
- **Hardware & Telemetry (JetBrains Mono):** Dedicated exclusively to node hardware identifiers (`L106-PC-04`), raw VRAM consumption counters (`11.4 / 12.0 GB`), active fairness formulas (`Pu = max(0, 100 - 10Bu)`), and alphanumeric access tokens. All metric counters must employ tabular figures (`tnum`) to eliminate layout shift during live WebSocket updates.

## Layout & Spacing

This design system uses a fluid layout model optimized for high-density, multi-rig monitoring:

- **Desktop (>= 1280px):** 12-column grid with 24px gutters and 32px canvas margins. Lab floor layouts use continuous grid arrays spanning 2, 3, or 4 columns per physical computer bank. Side panels for real-time queue priority calculations hold a locked 360px column.
- **Tablet (768px - 1279px):** 8-column grid with 16px gutters and 24px canvas margins. Metrics collapse into 2-wide analytical cards.
- **Mobile (< 768px):** Single-column stack with 16px margins. Focused strictly on physical entry authentication, personal reservation countdowns, and digital lab access passes with QR display.
- **Rhythm:** Spacing follows a strict 4px sub-grid with an 8px primary baseline. Internal padding inside telemetry cards is compressed (`space-sm` to `space-md`) to ensure full visibility of all 12GB VRAM rigs without excessive vertical scrolling.

## Elevation & Depth

Visual hierarchy relies on structural, dark-mode tonal layering paired with razor-sharp borders rather than diffuse, heavy dropshadows:

- **Level 0 (Floor Canvas):** Solid `#0B0F17`. 
- **Level 1 (Rig Tiles & Data Containers):** Background `#111827` enclosed by a 1px uniform outline of `rgba(255, 255, 255, 0.08)`. Hovering or selecting a node shifts the border to the rig's semantic state (`#3B82F6` for allocated, `#10B981` for ready).
- **Level 2 (Popovers, Sticky Inspection Trays, and QR Passes):** Background `#1E293B` with a backdrop blur of `16px` and an ambient shadow: `0 12px 32px -4px rgba(0, 0, 0, 0.65)`.
- **Level 3 (Modal Dialogs & Critical Hardware Alerts):** Background `rgba(15, 23, 42, 0.95)`, framed with a dual border: an inner 1px translucent highlight (`rgba(255, 255, 255, 0.12)`) and an outer 1px structural frame (`#0F172A`).

## Shapes

The design system maintains a controlled, engineered silhouette (`roundedness: 1`):
- Standard interactive elements, hardware cards, badges, and inputs utilize `0.25rem` (4px) corner radii.
- High-level laboratory visualizers, floorplan containers, and access modals adopt `0.5rem` (8px).
- Telemetry pills and real-time status pulses retain pure geometry; circular indicators are fixed at 50% radius, while data badges use 4px to maintain an industrial, chassis-mounted aesthetic.

## Components

### Hardware Rig Cards (Workstation Visualizer)
- Container: Surface `#111827`, border 1px `rgba(255, 255, 255, 0.08)`.
- Header: Workstation Node ID (`L106-PC-01`) in `label-code-md` (`JetBrains Mono`) with a live semantic pulse indicator (e.g., `#10B981` for Idle/Available).
- Body: VRAM gauge showing live memory utilization (e.g., `8.2 / 12.0 GB`) visualized through a segmented 12-bar progress track.
- Footer: Fair-share status or active user pseudonym with priority score.

### Buttons & Interactive Controls
- Primary Action: Cyber Cobalt (`#3B82F6`) background, white text (`#F8FAFC`), 4px border radius. Hover introduces a subtle glow (`box-shadow: 0 0 12px rgba(59, 130, 246, 0.4)`).
- Secondary / Ghost Action: `#1E293B` background with a 1px border of `rgba(255, 255, 255, 0.1)`.
- Destructive Action: Pure `#EF4444` background or transparent with `#EF4444` border for emergency rig lockouts and session cancellations.

### Telemetry Badges & Priority Chips
- Height: 22px fixed. Font: `label-code-sm` (`JetBrains Mono`, uppercase).
- Available / High-Priority: Background `rgba(16, 185, 129, 0.12)`, text `#10B981`, border 1px `rgba(16, 185, 129, 0.25)`.
- Active Job / Pending: Background `rgba(245, 158, 11, 0.12)`, text `#F59E0B`, border 1px `rgba(245, 158, 11, 0.25)`.
- Offline / Fault: Background `rgba(239, 68, 68, 0.12)`, text `#EF4444`, border 1px `rgba(239, 68, 68, 0.25)`.

### Input Fields & Terminal Selectors
- Background: `#0B0F17`. Border: 1px `rgba(255, 255, 255, 0.15)`.
- Focus state: Border transitions to `#3B82F6` with a 1px outline offset.
- Typography: `label-code-md` for compute parameters (epochs, batch sizes, execution scripts) and `body-md` for standard forms.

### Physical Access Pass & QR Token Card
- Container: Inverted crisp card surface (`#F8FAFC`) with dark text (`#0F172A`) for immediate contrast under optical laboratory barcode scanners.
- Token readout: QR Matrix centered, bordered by high-contrast registration corners, flanked by user identity, session validity window, and assigned node ID in bold `JetBrains Mono`.