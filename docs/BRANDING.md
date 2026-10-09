# Cube Core Branding

Official brand tokens for UI apps (`cube-core-admin`, and later tenant/website).

## Colors

| Token | Hex | Usage |
| --- | --- | --- |
| Primary Blue | `#0866F5` | Primary buttons, active nav, links, highlights |
| Deep Blue | `#0047D9` | Hover / strong emphasis |
| Cyan Accent | `#38BDF8` | Accent accents, chart secondary |
| Light Blue | `#DBEAFE` | Soft surfaces, icon chips, hover fills |
| Page Background | `#F8FAFC` | App canvas |
| Surface / Card | `#FFFFFF` | Cards, panels |
| Primary Text | `#0F172A` | Headings / body |
| Secondary Text | `#64748B` | Muted copy |
| Border | `#E2E8F0` | Dividers / inputs |
| Success | `#16A34A` | Positive status |
| Warning | `#F59E0B` | Warning status |
| Error | `#DC2626` | Destructive / errors |

Sidebar uses deep navy (`#0F172A`) with light foreground text.

## Typography

| Role | Font | Source |
| --- | --- | --- |
| Sans / UI | **Inter** (variable, opsz + wght) | `public/fonts/Inter-VariableFont_opsz,wght.ttf` |
| Italic | **Inter Italic** (variable) | `public/fonts/Inter-Italic-VariableFont_opsz,wght.ttf` |
| Mono | Geist Mono | `next/font/google` (code only) |

Configured via `next/font/local` in:

- `cube-core-admin/app/layout.tsx`
- `cube-core-tenant/app/layout.tsx`
- `cube-core-website/app/layout.tsx`

CSS variables:
- `--font-inter` from `next/font/local`
- `--font-sans` / `--font-heading` map to `var(--font-inter)` in `globals.css`

## Implementation

- Color tokens live in each UI app `app/globals.css`
- Prefer existing shadcn components + these CSS variables
- Avoid decorative glow / heavy shadows on every component
