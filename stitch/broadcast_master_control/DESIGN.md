---
name: Broadcast Master Control
colors:
  surface: '#11131b'
  surface-dim: '#11131b'
  surface-bright: '#373942'
  surface-container-lowest: '#0b0e16'
  surface-container-low: '#191b23'
  surface-container: '#1d1f27'
  surface-container-high: '#272a32'
  surface-container-highest: '#32343d'
  on-surface: '#e1e2ed'
  on-surface-variant: '#c2c6d6'
  inverse-surface: '#e1e2ed'
  inverse-on-surface: '#2e3039'
  outline: '#8c909f'
  outline-variant: '#424754'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e6a'
  primary-container: '#4d8eff'
  on-primary-container: '#00285d'
  inverse-primary: '#005ac2'
  secondary: '#ffb4aa'
  on-secondary: '#690003'
  secondary-container: '#c5020b'
  on-secondary-container: '#ffd2cc'
  tertiary: '#ffb874'
  on-tertiary: '#4b2800'
  tertiary-container: '#d47b00'
  on-tertiary-container: '#412200'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#ffdad5'
  secondary-fixed-dim: '#ffb4aa'
  on-secondary-fixed: '#410001'
  on-secondary-fixed-variant: '#930005'
  tertiary-fixed: '#ffdcbf'
  tertiary-fixed-dim: '#ffb874'
  on-tertiary-fixed: '#2d1600'
  on-tertiary-fixed-variant: '#6a3b00'
  background: '#11131b'
  on-background: '#e1e2ed'
  surface-variant: '#32343d'
  surface-base: '#05070E'
  surface-card: '#111827'
  surface-panel: '#121A2B'
  border-subtle: '#28354E'
  border-strong: '#5570AB'
  on-air-crimson: '#FF3B30'
  on-air-glow: '#FF5F5F'
  armed-amber: '#FF9500'
  armed-glow: '#FFB340'
  status-ok: '#34C759'
  status-ok-bright: '#3DDBA0'
  accent-ice: '#3B82F6'
  accent-ice-bright: '#5B9BFF'
typography:
  headline-xl:
    fontFamily: Barlow Condensed
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: 0.04em
  headline-lg:
    fontFamily: Barlow Condensed
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 28px
    letterSpacing: 0.03em
  headline-md:
    fontFamily: Barlow Condensed
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: 0.02em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '500'
    lineHeight: 20px
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 15px
  timecode-display:
    fontFamily: JetBrains Mono
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: 0.05em
  timecode-table:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-caps:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0.08em
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 12px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.5rem
  margin: 0.75rem
  space-xs: 0.125rem
  space-sm: 0.25rem
  space-md: 0.5rem
  space-lg: 0.75rem
  space-xl: 1rem
---

## Brand & Style

This design system is engineered for mission-critical linear television playout, master control rooms (MCR), and high-reliability broadcast operations. The target users are master control operators, broadcast transmission engineers, and live automation supervisors working long shifts under low-light control gallery conditions and high-glare multi-screen monitoring environments.

The visual direction merges **High-Contrast Utilitarianism** with **Tactile Broadcast Instrumentation**:
- **Zero-Latency Readability**: Zero ambiguity between "On-Air" (Program), "Armed/Cued" (Preview), and "Standby/OK" system states.
- **Mission-Critical Ergonomics**: High information density, dense spatial packing, frame-accurate tabular metrics, and physical rackmount console cues.
- **Visual Discipline**: Deep void surfaces eliminate ambient light bleed in dark control rooms, while hyper-saturated signal lamps and crisp 1px mechanical containment borders establish instantaneous situational awareness adhering to WCAG AAA contrast standards.

## Colors

The color architecture is strictly semantic, rooted in traditional broadcast tally hardware (Red = PGM/Air, Amber = PVW/Preset, Green = Sync/Genlock/Normal).

### Tally & Hardware Semantics
- **Primary (`#3B82F6` / `#5B9BFF`)**: Operator selection, active focus rings, cursor positions, and transport navigation.
- **Secondary (`#FF3B30` / `#FF5F5F`)**: Tally On-Air, live transmission output, emergency alert system triggers, and active override.
- **Tertiary (`#FF9500` / `#FFB340`)**: Armed events, cued rundown items, warning thresholds, and preroll buffers.
- **Neutral (`#05070E`)**: Absorptive deep-void canvas that eliminates display backlight wash in dim broadcast bays.

### Functional Roles & Contrast
- `surface-card` (`#111827`) and `surface-panel` (`#121A2B`) structure dense multi-channel arrays.
- `border-subtle` (`#28354E`) provides sharp 1px division without visual clutter. `border-strong` (`#5570AB`) frames active focus cards and split-screen video preview viewports.
- `status-ok` (`#34C759` / `#3DDBA0`) verifies SDI/NDI feeds, SCTE-35 marker sync, and reference clock locking.

## Typography

Typography balances high-density information layout with sub-second numerical verification.

- **Barlow Condensed (Headlines & Channel Banners)**: High-impact, vertical-efficient header structure suited for channel identifiers (e.g., `CH-01 MAIN PGM`), event names, and control panel group titling.
- **Inter (Interface & Grid Metadata)**: High legibility at small sizes (11px–13px) for event descriptions, segment metadata, server routes, and system logs.
- **JetBrains Mono (Timecodes, Durations & Offsets)**: Used strictly with tabular figures (`tnum`) and slashed zeros (`zero`) to guarantee that frame counters (`HH:MM:SS:FF`), millisecond countdowns, and countdown bars never cause horizontal visual jitter.

## Layout & Spacing

Master control setups prioritize maximum viewable canvas on dual 4K/QHD multi-viewers and rack-mounted touchscreens. Whitespace is compressed to prevent scrolling during live broadcasts.

### Layout Model
- **Dense Modular Grid**: A fluid 24-column grid with compact 8px (`0.5rem`) gutters and 12px (`0.75rem`) outer boundaries.
- **Fixed Master Panels**: PGM/PVW monitors occupy dedicated upper quadrants; the automated event list (rundown grid) commands full horizontal spans with fixed row heights (28px to 32px per event).
- **Responsive Adaptations**:
  - **Desktop / Multi-Monitor (>1920px)**: Multi-channel horizontal matrix displaying simultaneous rundown timelines, live audio VU meters, and routing switchers.
  - **Single Console (1280px - 1919px)**: Split-screen orientation with collapsed sidebars and docked audio monitors.
  - **Field Tablet / Touch Rack (<=1279px)**: Single channel focus mode; expands touch targets to a minimum of 40px while maintaining the 8px grid baseline.

## Elevation & Depth

To prevent eye fatigue and maintain pure optical contrast, depth is conveyed through **mechanical containment borders** and **inset hardware panels** rather than diffuse ambient drop shadows.

- **Flat Mechanical Plane**: Ground level rests at `#05070E`. Workspace bays and control banks sit on `surface-card` (`#111827`) with a 1px border of `#28354E`.
- **Active / Tally Elevation**: When a block enters the On-Air or Armed state, depth is asserted via high-voltage border shifts (`#FF3B30` or `#FF9500`) and a constrained, crisp glow (`0 0 10px rgba(255, 59, 48, 0.35)` or `0 0 10px rgba(255, 149, 0, 0.3)`).
- **Recessed Insets (VU Meters, Waveforms, Video Preview)**: Inset panels use a deep background (`#080C14`) framed by a 1px solid border (`#1A2438`) with an inner shadow `inset 0 1px 3px rgba(0,0,0,0.8)` simulating physical broadcast rack gear.

## Shapes

The interface embraces an industrial, rackmount instrument aesthetic:
- **`roundedness: 1` (Soft - 2px to 4px)**: Core buttons, rundown cells, and status indicators utilize small corner radii (`2px` base, `4px` maximum on primary containment panels).
- **Sharp Geometry**: Timecode counters, VU meter segments, and video viewports use 0px sharp corners to honor broadcast raster boundaries.
- **Pill Exceptions**: Small hardware status LED pips and tally capsules use fully rounded borders (`rounded-full`) to emulate optical push-button lamps.

## Components

### Buttons & Transport Triggers
- **Take / Cue Buttons**: Substantial tactile triggers. The `TAKE` button is high-voltage crimson (`#FF3B30`), bold uppercase label, 36px height, with an active border highlight. `CUE / NEXT` uses vivid amber (`#FF9500`).
- **Standard Controls**: `#121A2B` background with a crisp 1px `#28354E` border. Hover changes border to `#5570AB` and text to `#FFFFFF`.

### Rundown List & Grid Rows
- **Row Heights**: Compressed 30px height with monospace timecode alignment.
- **States**:
  - *On-Air*: Left-edge 4px solid `#FF3B30` bar, row background tinted `rgba(255, 59, 48, 0.08)`, text in high-contrast white.
  - *Next/Armed*: Left-edge 4px solid `#FF9500` bar, row background tinted `rgba(255, 149, 0, 0.08)`.
  - *Standby*: Neutral `#111827` alternating zebra striping (`#0D1320`), text `#94A3B8`.

### Status Badges & Chips
- **Tally Badges**: High-contrast, all-caps micro-badges (`font-size: 10px`, `letter-spacing: 0.08em`).
- **Variants**:
  - `ON-AIR`: Red solid `#FF3B30`, black text `#000000`, bold.
  - `ARMED`: Amber solid `#FF9500`, black text `#000000`, bold.
  - `LIVE`: Flashing crimson pip indicator.
  - `GENLOCK OK`: Emerald green outline `#34C759` on `#051A0E`.

### Input Fields & Trim Controls
- **Numeric Trim Fields**: Recessed dark background (`#080C14`), 1px `#28354E` border, JetBrains Mono tabular font. Direct click-to-scrub timecode input with increment/decrement steppers.

### Audio VU Meters & Hardware Cards
- **Audio Bars**: Segmented LED ladder layout. Green up to -18 dBFS (`#34C759`), yellow between -18 and -6 dBFS (`#FF9500`), red clip over -6 dBFS (`#FF3B30`).
- **Cards & Bays**: Rigid containers with explicit title banners in Barlow Condensed, complete with an auxiliary status dot in the upper-right corner.