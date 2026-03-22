# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── j14-75/             # J14-75 AI Agent cinematic landing page (React + Vite)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `artifacts/j14-75` (`@workspace/j14-75`)

Cinematic sci-fi landing page for J14-75 AI Agent. React + Vite on port 22935, previewPath `/`.
- Dark/light mode toggle, hero video with scale(0.92) zoom-out, Act 2 text-only trust section, Act 3 "Core Capabilities" cards
- No galaxy video. Hero text always white over video. Light mode: warm cream `#f4efe8`.

### `artifacts/command-center` (`@workspace/command-center`)

J14-75 Command Center dashboard. React + Vite on port 23748, previewPath `/command-center/`.
- Pure black `#000000` background, orange `#FF6B00` / amber `#FFB300` accents, glassmorphism
- Top nav: logo + ERC-8004 badge + Connect Wallet button (shows chain after connect)
- Left sidebar: J14-75 avatar, pulsing green dot, Status/KYC/Network metrics, Reputation+Validation score bars, wallet addresses
- Center: AI chat interface with message history, quick action chips, textarea input
- Right sidebar: capability cards (Wallet Mgmt, Balance Check, CCTP Bridge, Contract Audit, KYC Verified) + score ring

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.

Key scripts:
- `pnpm --filter @workspace/scripts run start` — ERC-8004 full registration flow on Arc Testnet
- `pnpm --filter @workspace/scripts run agent` — J14-75 Multi-Tool AI Agent (requires GROQ_API_KEY)

Agent framework in `src/agent/`:
- `agent-core.ts` — Groq function-calling router (llama-3.3-70b-versatile), conversation history support
- `tools/wallet-manager.ts` — Create/list Circle Developer-Controlled SCA wallets
- `tools/check-balance.ts` — On-chain ETH + USDC balance via viem (ETH-SEPOLIA, ARC-TESTNET)
- `tools/bridge-cctp.ts` — CCTP route simulation (burn → attestation → mint)
- `tools/mock-audit.ts` — Smart contract security risk scoring

Dependencies: `@circle-fin/developer-controlled-wallets ^7.3.0`, `groq-sdk ^0.9.1`, `viem ^2.47.4`, `dotenv`

Secrets required:
- `CIRCLE_API_KEY` — Circle Developer API key
- `CIRCLE_ENTITY_SECRET` — Circle entity secret (backup in `scripts/recovery.dat`)
- `GROQ_API_KEY` — Groq API key (needed only for `agent` script)
