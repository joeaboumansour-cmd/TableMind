# GoldenSquirrel POS

An offline-first, mobile-first retail Point of Sale PWA for shops in **Lebanon**, handling **dual currency (Lebanese Pound + USD)**. Live in production on Vercel.

> **Note on naming:** the repo folder is `TableMind`, an abandoned predecessor product. The application is **GoldenSquirrel POS** everywhere it matters — package name, PWA manifest, database, UI. Treat "TableMind", "restaurant", "reservation", or "merchant" in the codebase as signals of dead code.

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill in the values
npm run dev                    # http://localhost:3000 (also bound to 0.0.0.0 for phone testing)
```

The app redirects `/` → `/pos`. You'll need a store account in Supabase to log in.

## Environment

Copy `.env.example` to `.env.local` and fill in from your Supabase project settings:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key. **Server-only — never expose to the client.** |

`.env.local` is gitignored. Production values live in Vercel's environment settings.

## Commands

```bash
npm run dev          # dev server
npm run build        # production build + service-worker verification
npm run verify:sw    # assert the generated public/sw.js has the required rules
npm run analyze      # production build with the bundle treemap
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .
```

There is **no automated test suite** — verification is done by a human QA team. `typecheck` and `lint` are the only automated gates.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind v4 (CSS-first — no `tailwind.config.ts`) · shadcn/ui · Zustand 5 · Dexie 4 (IndexedDB) · Supabase (Postgres) · `@ducanh2912/next-pwa`

Builds use **webpack, not Turbopack** — the `--webpack` flag is deliberate, as the PWA plugin is incompatible with Turbopack. Don't remove it.

## Layout

```
src/
  app/          routes + API routes — every page is a client component
  components/   shared components; ui/ is hand-copied shadcn
  hooks/        useFeatureFlags, useToastManager, …
  lib/
    auth/       login, permissions, guards  (roles.ts is dead)
    db/         Dexie / IndexedDB layer
    sync/       offline sync engine
    supabase/   Supabase clients
    stores/     Zustand (cart)
    utils/      format.ts — money + date formatting, single source of truth
scripts/        build-time checks (verify-sw.mjs)
supabase/       SQL migrations
docs/           documentation (archive/ holds superseded docs)
```

## Database

Schema lives in `supabase/migrations/`, applied manually to the hosted Supabase project — **not** part of the Vercel deploy. Ship a migration before the code that depends on it.

Note that the migrations in this repo do not fully describe production state; verify against the live database before changing policies or existing tables.

## Documentation

Start with **`CLAUDE.md`** — it's the ground-truth summary of how this system actually works, including which of the other docs to trust.

| Document | What it is |
|---|---|
| `CLAUDE.md` | Conventions, money rules, offline model, gotchas. **Read first.** |
| `ARCHITECTURE.md` | System architecture |
| `docs/AUDIT-2026-08.md` | Live bug and tech-debt backlog |
| `docs/CSV_IMPORT_EXPORT_GUIDE.md` | CSV import/export reference |
| `docs/FEATURE_FLAG_ARCHITECTURE.md` | Feature flag design and playbook |
| `FUNCTIONAL_REQUIREMENTS.md` | Aspirational wishlist — ~40% built |
| `docs/archive/` | Superseded docs. Historical only — do not plan from them. |

## Status

This is a **live POS handling real money for paying stores**. There are known critical issues in the authorization layer — see P0 in `docs/AUDIT-2026-08.md` before working on auth or API routes.
