# Technology Stack

**Analysis Date:** 2026-06-09

## Languages

**Primary:**
- TypeScript — all source files under `src/` (`.ts` and `.tsx`)

**Secondary:**
- TSX (React JSX) — UI components under `src/components/ui/` and `src/pages/`

## Runtime

**Environment:**
- Node.js (ESNext target, `"type": "module"` — pure ESM package)

**Package Manager:**
- npm (`.npmrc` present; no lockfile committed to this repo — consumed as a library)

## Frameworks

**Core:**
- React 19 (peer dependency) — UI components and settings page (`src/components/ui/`, `src/pages/nango-settings-page.tsx`, `src/nango-operations-card.tsx`)

**Testing:**
- Vitest — test runner; config at `vitest.config.ts`; tests in `src/__tests__/`

**Build/Dev:**
- TypeScript compiler — `tsconfig.json` targets ES2023, `moduleResolution: bundler`, emits to `dist/`
- No bundler is invoked directly; the package is consumed by a host app that handles bundling

## Key Dependencies

**Critical:**
- `@nangohq/node` ^0.70.3 — server-side Nango SDK; used throughout `src/nango.ts` to manage integrations, connections, credentials, and token refresh
- `@nangohq/frontend` ^0.70.3 — client-side Nango SDK for triggering OAuth Connect UI flows (`src/nango-connect-ui.ts`)
- `zod` ^4.4.3 — runtime schema validation for route handler request bodies (`src/route-handlers.ts`)

**UI Utilities:**
- `radix-ui` ^1.4.3 — headless primitives for `src/components/ui/` components (alert, button, card, etc.)
- `class-variance-authority` ^0.7.1 — variant-based className composition
- `clsx` ^2.1.1 — conditional className utility
- `tailwind-merge` ^3.5.0 — Tailwind CSS class deduplication

**Peer (optional):**
- `@cinatra-ai/sdk-extensions` — host app extension registration hooks
- `@cinatra-ai/sdk-ui` — re-exports `NangoUserConnectButton`, `NangoUserConnectCard`, `NangoManagedApiCard` from `@cinatra-ai/sdk-ui/nango` for back-compat

## Configuration

**Environment:**
- `NANGO_SECRET_KEY` — Nango server-side secret key (read in `src/nango.ts` via `process.env`; takes precedence over DB-stored value)
- `NANGO_SERVER_URL` — Optional self-hosted Nango server URL (fallback: `https://api.nango.dev`)
- `NANGO_PUBLIC_CONNECT_URL` — Optional override for the Connect UI base URL
- No `.env` file detected in this repo

**Build:**
- `tsconfig.json` — standalone strict config; `outDir: dist`, `rootDir: src`; path alias `@/` resolved by Vitest config pointing to repo-root `src/`
- `package.json` `cinatra.kind: "connector"` — Cinatra platform manifest metadata

## Platform Requirements

**Development:**
- Node.js with ESM support
- Host monorepo must provide `@/lib/database` (connector config DB read/write) and `@/lib/nango` path aliases resolved at the consuming app level

**Production:**
- Deployed as part of the Cinatra host application (not standalone)
- Nango service accessible at `https://api.nango.dev` or a self-hosted instance

---

*Stack analysis: 2026-06-09*
