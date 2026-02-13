# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Flywheel Command Center — an internal analytics dashboard that aggregates metrics across three SaaS products (Somara, ULink, PushFire) into a single view. Built with Next.js 14 (App Router), TypeScript, Tailwind CSS, and Tremor charts.

## Commands

```bash
npm run dev       # Start dev server on localhost:3000
npm run build     # Production build
npm run lint      # ESLint (next/core-web-vitals)
```

No test framework is configured.

## Architecture

### Multi-Product Pattern

Each product (somara, ulink, pushfire) is defined in `src/lib/config/products.ts` with feature flags (`hasGAMetrics`, `hasBusinessMetrics`, `hasPushFireMetrics`) that control which data sources and dashboard sections render. The dynamic route `src/app/(dashboard)/[product]/page.tsx` conditionally fetches and displays sections based on these flags.

### Data Flow: Integration Layer → API Routes → Client Hooks

Each data source follows a consistent three-file pattern under `src/lib/integrations/{source}/`:
- **client.ts** — singleton SDK client (GA Data API, Supabase service-role client)
- **queries.ts** — raw data fetching functions
- **transform.ts** — transforms raw responses into typed DTOs from `src/lib/types.ts`

API routes in `src/app/api/metrics/` orchestrate: check Upstash Redis cache → fetch fresh data via integration layer → cache result → return `ApiResponse<T>` envelope. Stale cache is served as fallback when upstream APIs fail.

Client-side hooks in `src/hooks/` (`useMetrics`, `useULinkMetrics`, `usePushFireMetrics`, etc.) call these API routes and manage loading/error/cached state. Hooks skip fetching when passed empty params (products without that data source).

### Caching

Upstash Redis (via `@upstash/redis`) with 15-minute TTL. Cache keys are structured as `metrics:{product}:{metricType}:{start}:{end}`. All cache operations are in `src/lib/cache/kv.ts`.

### Authentication

Firebase Auth with email/password. Client-side login exchanges a Firebase ID token for a server-created session cookie (`fw_session`, 14-day expiry). Edge middleware verifies the session cookie on every non-public request by calling `/api/auth/verify`. Signup is restricted to emails in the `ALLOWED_EMAILS` env var.

### External Data Sources

- **Google Analytics Data API** — website traffic metrics (visitors, pages, referrers, devices, countries). Service account JSON is base64-encoded in `GA_SERVICE_ACCOUNT_JSON`. Each product has a separate GA property ID.
- **ULink Supabase** — business metrics (signups, MRR, subscriptions, project health) queried from ULink's own database with service role key.
- **PushFire Supabase** — platform metrics (subscribers, notifications, executions, devices) queried from PushFire's own database with service role key.

### UI

Dark-only theme using shadcn/ui (Radix primitives + CVA) and Tremor chart components. CSS variables defined in `src/app/globals.css`. Tremor color classes are safelisted in `tailwind.config.ts` to prevent JIT purging. `@/*` path alias maps to `./src/*`.

### SQL Scripts

`supabase/` contains Supabase SQL migrations/functions for the dashboard's own tables (allowed_users, metrics_cache) and ULink health queries. `archive/` holds deprecated Somara SQL.
