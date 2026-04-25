# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL (`pg` pool — `src/lib/db.ts`)
- **Build**: esbuild (ESM bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Funnel Dashboard (`artifacts/funnel-dashboard`)

Arabic RTL Meta Ads dashboard. All amounts in EGP. UI fully Arabic RTL.

### Pages

- **`/` — تحليل الحملة (Campaign Dashboard)**: Interactive decision system — KPI cards, Alert System, Priority Engine, What-if Simulator, Breakdown Analysis, Daily Trend chart. Driven by `useInsights` / `useCampaigns`.
- **`/overview` — نظرة عامة (Account Overview)**: Per-account tabs showing health status (green/yellow/red), 6 KPIs with prev-period delta, `AccountHealthPanel` (6-metric diagnostic panel with campaign breakdown), Priority Engine, Best/Worst campaigns, daily trend chart. Auto-snapshots alerts to DB on every data load. Driven by `useAccountOverview`.
- **`/activity` — نشاط الفريق (Team Activity Monitor)**: Shows unresolved alerts (with age + urgency), action logging form per alert, and 14-day action history with outcome tracking.
- **`/how-to` — دليل الحلول (Diagnostic Guide)**: Actionable fix guides per metric problem + What-If Calculator.

### Key files
- `src/pages/Dashboard.tsx` — Campaign dashboard
- `src/pages/Overview.tsx` — Account overview (includes AccountHealthPanel, auto-snapshot logic)
- `src/pages/Activity.tsx` — Team activity monitor
- `src/pages/HowTo.tsx` — Diagnostic guide
- `src/App.tsx` — WouterRouter + NavBar (4 links)
- `src/lib/meta-api.ts` — All types + fetch functions
- `src/lib/alerts-api.ts` — Alert snapshot + action API client
- `src/hooks/use-meta.ts` — React Query hooks

### Alert Thresholds (AccountHealthPanel)
- CTR: danger < 1.5%, warn < 2%
- CPC: danger > 5 EGP, warn > 3 EGP
- CPM: danger > 70 EGP, warn > 50 EGP
- CPA: danger > 100 EGP, warn > 40 EGP
- Frequency: danger > 2.5x, warn > 1.5x

## API Server (`artifacts/api-server`)

Express API backed by Meta Ads API + PostgreSQL.

### Meta endpoints
- `GET /api/meta/accounts` — list all configured ad accounts
- `GET /api/meta/campaigns?ad_account_id=&since=&until=` — campaign summaries
- `GET /api/meta/insights?campaign_id=&since=&until=` — full campaign breakdown
- `GET /api/meta/account-overview?ad_account_id=&since=&until=` — account-level totals + daily trend + prev period comparison
- `GET /api/meta/token-health` — token validity check

### Alert endpoints
- `POST /api/alerts/snapshot` — record current alerts for an account (auto-deduplicates, auto-resolves old ones)
- `POST /api/alerts/action` — log a manual action taken on an alert (48h follow-up timer)
- `GET /api/alerts/history?accountId=&days=` — alert history with actions
- `GET /api/alerts/activity?accountId=&days=` — team activity feed (actions + unresolved alerts)
- `PATCH /api/alerts/outcome` — update outcome after follow-up

### Database tables
- `alert_snapshots` — detected alerts (account_id, alert_key, alert_type, severity, metric_value, campaign_id, is_resolved)
- `alert_actions` — team actions logged per alert (action_type, action_note, actioned_by, follow_up_at, outcome)

### Key files
- `src/lib/meta-api.ts` — Meta Graph API client + all data functions
- `src/lib/db.ts` — PostgreSQL pool wrapper
- `src/routes/meta.ts` — All `/api/meta/*` routes
- `src/routes/alerts.ts` — All `/api/alerts/*` routes
- `src/routes/index.ts` — Route registration

### Important notes
- Pre-existing TS errors in Dashboard.tsx (~line 1026) and Overview.tsx (~line 1769): `level: ""` incompatible with AdIssue type — do NOT touch these
- Screenshot tool always captures skeleton/loading state (Meta API takes 5-8s) — this is expected
- BASE_URL pattern: `import.meta.env.BASE_URL.replace(/\/$/, "")` prefix on all API calls
- `alert_key` format: `"ctr-low:account"` or `"high-frequency:campaign-{id}"`
