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

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Funnel Dashboard (`artifacts/funnel-dashboard`)

Arabic RTL Meta Ads dashboard with two pages:

- **`/` — تحليل الحملة (Campaign Dashboard)**: Interactive decision system — KPI cards, Alert System, Priority Engine, What-if Simulator, Breakdown Analysis, Daily Trend chart. Driven by `useInsights` / `useCampaigns`.
- **`/overview` — نظرة عامة (Account Overview)**: Per-account tabs showing health status (green/yellow/red), 6 KPIs with prev-period delta, Priority Engine, Best/Worst campaigns, daily trend chart, quick action buttons. Driven by `useAccountOverview`.

### Key files
- `src/pages/Dashboard.tsx` — Campaign dashboard
- `src/pages/Overview.tsx` — Account overview
- `src/App.tsx` — WouterRouter + NavBar
- `src/lib/meta-api.ts` — All types + fetch functions
- `src/hooks/use-meta.ts` — React Query hooks
- `src/components/dashboard-controls.tsx` — Date presets + account/campaign selectors

## API Server (`artifacts/api-server`)

Express API backed by Meta Ads API.

### Key endpoints
- `GET /api/meta/accounts` — list all configured ad accounts
- `GET /api/meta/campaigns?ad_account_id=&since=&until=` — campaign summaries
- `GET /api/meta/insights?campaign_id=&since=&until=` — full campaign breakdown
- `GET /api/meta/account-overview?ad_account_id=&since=&until=` — account-level totals + daily trend + prev period comparison
- `GET /api/meta/token-health` — token validity check

### Key files
- `src/lib/meta-api.ts` — Meta Graph API client + all data functions
- `src/routes/meta.ts` — All `/api/meta/*` routes
