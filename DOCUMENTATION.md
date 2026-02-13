# Flywheel Command Center - Technical Documentation

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Data Flow](#data-flow)
4. [Authentication System](#authentication-system)
5. [Data Sources & Integrations](#data-sources--integrations)
6. [Caching Strategy](#caching-strategy)
7. [UI Components](#ui-components)
8. [Database Schema](#database-schema)
9. [API Routes](#api-routes)
10. [Environment Setup](#environment-setup)
11. [Deployment](#deployment)

---

## Project Overview

**Flywheel Command Center** is an internal analytics dashboard that aggregates metrics from three SaaS products (Somara, ULink, and PushFire) into a unified view. It provides real-time insights into:

- Website traffic (Google Analytics)
- Business metrics (MRR, signups, conversions)
- Platform usage (subscribers, notifications, executions)
- Client health (onboarding progress, project activity)

### Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4, shadcn/ui, CVA
- **Charts**: Tremor React
- **Authentication**: Firebase Auth (email/password)
- **Caching**: Upstash Redis (15-minute TTL)
- **Data Sources**: Google Analytics Data API, Supabase (multiple projects)

---

## Architecture

### Multi-Product Pattern

The dashboard is product-agnostic, with configuration driven by `src/lib/config/products.ts`:

```typescript
export const products: ProductConfig[] = [
  {
    slug: "somara",
    name: "Somara",
    color: "#6366f1",
    gaPropertyId: process.env.GA_PROPERTY_ID_SOMARA || "",
    hasGAMetrics: false,
    hasBusinessMetrics: false,
    hasSomaraMetrics: false,
    hasPushFireMetrics: false,
  },
  // ... ulink, pushfire
];
```

**Feature flags** control which sections render on each product page:
- `hasGAMetrics` → Website traffic charts
- `hasBusinessMetrics` → MRR, signups, conversion funnels
- `hasPushFireMetrics` → Platform-specific metrics

### Directory Structure

```
src/
├── app/
│   ├── (dashboard)/           # Authenticated routes
│   │   ├── [product]/         # Dynamic product pages
│   │   │   └── page.tsx       # Main product dashboard
│   │   ├── layout.tsx         # Dashboard layout (sidebar + header)
│   │   └── page.tsx           # Overview (cross-product aggregation)
│   ├── api/
│   │   ├── auth/              # Authentication endpoints
│   │   └── metrics/           # Metrics API routes
│   │       ├── ga/            # Google Analytics metrics
│   │       ├── ulink/         # ULink business + health metrics
│   │       └── pushfire/      # PushFire platform metrics
│   ├── login/
│   ├── signup/
│   ├── globals.css
│   └── layout.tsx
├── components/
│   ├── charts/                # Tremor chart wrappers
│   ├── dashboard/             # Dashboard-specific UI
│   ├── layout/                # Sidebar, header
│   └── ui/                    # shadcn/ui primitives
├── hooks/                     # Client-side data fetching hooks
├── lib/
│   ├── cache/                 # Redis cache layer
│   ├── config/                # Product configs, site metadata
│   ├── firebase/              # Firebase client/admin setup
│   ├── integrations/          # External data source integrations
│   │   ├── ga/                # Google Analytics
│   │   ├── ulink/             # ULink Supabase
│   │   └── pushfire/          # PushFire Supabase
│   ├── utils/                 # Utility functions
│   └── types.ts               # TypeScript definitions
├── middleware.ts              # Auth middleware (Edge)
└── ...
```

---

## Data Flow

### Request Lifecycle

```
User → Client Hook → API Route → Cache Check → Integration Layer → Transform → Response
```

1. **Client Hook** (`useMetrics`, `useULinkMetrics`, etc.)
   - Calls API route with date range params
   - Manages loading/error/cached state
   - Skips fetching if params are empty (products without that data source)

2. **API Route** (`/api/metrics/ga`, `/api/metrics/ulink`, etc.)
   - Validates params
   - Checks Redis cache for fresh data
   - On cache miss: fetches from integration layer
   - Caches result with 15-minute TTL
   - Falls back to stale cache on upstream failure

3. **Integration Layer** (`src/lib/integrations/{source}/`)
   - **client.ts**: Singleton SDK client (GA, Supabase)
   - **queries.ts**: Raw data fetching functions
   - **transform.ts**: Transforms raw responses into typed DTOs

### Example: Fetching ULink Business Metrics

```typescript
// Hook (client-side)
const { data, loading, error, cached, cachedAt } = useULinkMetrics(
  dateRange.start,
  dateRange.end
);

// API Route
GET /api/metrics/ulink?start=30daysAgo&end=today
  → Check Redis cache (key: "metrics:ulink:ulink_business:30daysAgo:today")
  → If stale or missing:
      → fetchSignups(startDate, endDate)
      → fetchActiveSubscriptions()
      → fetchMRROverTime(startDate, endDate)
      → fetchActiveProjects(startDate, endDate)
      → transformBusinessMetrics(rawData)
      → setCachedMetrics(product, start, end, metrics)
  → Return ApiResponse<ULinkBusinessMetrics>
```

### Integration Layer Pattern

Every data source follows this three-file pattern:

#### 1. Client (`client.ts`)
```typescript
let client: SupabaseClient | null = null;

export function getULinkClient(): SupabaseClient {
  if (client) return client;

  client = createClient(
    process.env.ULINK_SUPABASE_URL!,
    process.env.ULINK_SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } }
  );

  return client;
}
```

#### 2. Queries (`queries.ts`)
```typescript
export async function fetchSignups(
  startDate: Date,
  endDate: Date
): Promise<{ daily: RawSignupRow[]; total: number }> {
  const supabase = getULinkClient();

  const { data, error } = await supabase.rpc("get_daily_signups", {
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
  });

  // ... handle errors, return raw data
}
```

#### 3. Transform (`transform.ts`)
```typescript
export function transformBusinessMetrics(params: {
  signupsDaily: RawSignupRow[];
  totalSignups: number;
  subscriptions: RawSubscriptionRow[];
  // ...
}): ULinkBusinessMetrics {
  const mrr = calculateMRR(params.subscriptions);
  const allDates = generateDateRange(params.startDate, params.endDate);

  return {
    mrr,
    totalSignups: params.totalSignups,
    signupsOverTime: fillSignupsOverTime(params.signupsDaily, allDates),
    // ...
  };
}
```

---

## Authentication System

### Firebase Auth Flow

```
Client                    Server (API Route)          Firebase Admin
  │                              │                          │
  │──signInWithEmailAndPassword→│                          │
  │←────────idToken──────────────│                          │
  │                              │                          │
  │──POST /api/auth/login────────→                          │
  │  { idToken }                 │                          │
  │                              │──verifyIdToken()────────→│
  │                              │←────decoded──────────────│
  │                              │                          │
  │                              │──createSessionCookie()──→│
  │                              │←────sessionCookie────────│
  │                              │                          │
  │←─Set-Cookie: fw_session──────│                          │
  │  (14-day expiry)             │                          │
```

### Middleware (Edge Runtime)

**Location**: `src/middleware.ts`

```typescript
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const session = request.cookies.get("fw_session")?.value;
  if (!session) {
    return NextResponse.redirect("/login");
  }

  // Verify session cookie via internal API call
  // (Firebase Admin SDK can't run in Edge middleware)
  const res = await fetch("/api/auth/verify", {
    headers: { Cookie: `fw_session=${session}` },
  });

  if (!res.ok) {
    return NextResponse.redirect("/login");
  }

  return NextResponse.next();
}
```

### Signup Allowlist

Signups are restricted to emails in the `ALLOWED_EMAILS` environment variable:

```typescript
// /api/auth/signup
const allowedEmails = (process.env.ALLOWED_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

if (!allowedEmails.includes(email.toLowerCase())) {
  return NextResponse.json(
    { error: "This email is not authorized to sign up" },
    { status: 403 }
  );
}
```

---

## Data Sources & Integrations

### 1. Google Analytics Data API

**Purpose**: Website traffic metrics (visitors, sessions, pages, referrers, devices, countries)

**Authentication**: Service account JSON (base64-encoded in `GA_SERVICE_ACCOUNT_JSON`)

**Property IDs**: Separate for each product (`GA_PROPERTY_ID_SOMARA`, `GA_PROPERTY_ID_ULINK`, `GA_PROPERTY_ID_PUSHFIRE`)

#### Key Queries

**KPIs**:
```typescript
metrics: [
  { name: "totalUsers" },
  { name: "newUsers" },
  { name: "sessions" },
  { name: "screenPageViews" },
  { name: "averageSessionDuration" },
  { name: "bounceRate" },
]
```

**Visitors Over Time**:
```typescript
dimensions: [{ name: "date" }]
metrics: [
  { name: "activeUsers" },
  { name: "newUsers" },
  { name: "sessions" },
]
orderBys: [{ dimension: { dimensionName: "date" } }]
```

**ULink Website vs. Dashboard Split**:
- **Website**: Excludes `/dashboard`, `/onboarding`, `/auth/cli`, etc.
- **Dashboard Users**: Only includes `/dashboard/*` paths

```typescript
const WEBSITE_FILTER = {
  andGroup: {
    expressions: EXCLUDED_PATHS.map((path) => ({
      notExpression: {
        filter: {
          fieldName: "pagePath",
          stringFilter: { matchType: "BEGINS_WITH", value: path },
        },
      },
    })),
  },
};

const DASHBOARD_FILTER = {
  filter: {
    fieldName: "pagePath",
    stringFilter: { matchType: "BEGINS_WITH", value: "/dashboard" },
  },
};
```

### 2. ULink Supabase

**Purpose**: Business metrics (signups, MRR, subscriptions, project health)

**Database**: `cjgihassfsspxivjtgoi.supabase.co`

**Authentication**: Service role key (`ULINK_SUPABASE_SERVICE_KEY`)

#### Database Functions

**Daily Signups**:
```sql
CREATE OR REPLACE FUNCTION public.get_daily_signups(
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ
)
RETURNS TABLE (date TEXT, count BIGINT)
AS $$
  SELECT
    to_char(created_at::date, 'YYYY-MM-DD') AS date,
    count(*) AS count
  FROM auth.users
  WHERE created_at >= start_date AND created_at <= end_date
  GROUP BY created_at::date
  ORDER BY created_at::date;
$$;
```

**MRR Over Time**:
```sql
CREATE OR REPLACE FUNCTION public.get_mrr_over_time(
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ
)
RETURNS TABLE (date TEXT, mrr NUMERIC)
AS $$
  WITH daily_activations AS (
    SELECT
      to_char(s.created_at::date, 'YYYY-MM-DD') AS activation_date,
      SUM(
        CASE
          WHEN sp.billing_interval = 'yearly' AND sp.price_yearly IS NOT NULL
            THEN sp.price_yearly / 12.0
          ELSE COALESCE(sp.price_monthly, 0)
        END
      ) AS daily_mrr_added
    FROM subscriptions s
    JOIN subscription_plans sp ON s.plan_id = sp.id
    WHERE s.environment = 'production'
      AND s.status IN ('active', 'trialing')
      AND s.created_at >= start_date
      AND s.created_at <= end_date
    GROUP BY s.created_at::date
  )
  SELECT
    activation_date AS date,
    SUM(daily_mrr_added) OVER (ORDER BY activation_date) AS mrr
  FROM daily_activations;
$$;
```

**Project Health**:
```sql
CREATE OR REPLACE FUNCTION public.get_project_health_summary(
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ
)
RETURNS TABLE (
  project_id UUID,
  project_name TEXT,
  project_created_at TIMESTAMPTZ,
  member_count BIGINT,
  domain_setup BOOLEAN,
  platform_selection BOOLEAN,
  platform_config BOOLEAN,
  cli_verified BOOLEAN,
  sdk_setup_viewed BOOLEAN,
  platform_implementation_viewed BOOLEAN,
  is_configured BOOLEAN,
  links_created BIGINT,
  total_clicks BIGINT,
  recent_clicks BIGINT
)
AS $$
  SELECT
    p.id AS project_id,
    p.name AS project_name,
    p.created_at AS project_created_at,
    COALESCE(pm.member_count, 0) AS member_count,
    COALESCE(pos.domain_setup_completed IS NOT NULL, false) AS domain_setup,
    -- ... 12 more fields
  FROM projects p
  LEFT JOIN project_members pm ON pm.project_id = p.id
  LEFT JOIN project_onboarding_status pos ON pos.project_id = p.id
  -- ... additional joins
$$;
```

#### Health Score Calculation

```typescript
function computeHealthScore(
  linksCreated: number,
  recentClicks: number,
  onboardingProgress: number
): "healthy" | "at-risk" | "inactive" {
  const hasLinks = linksCreated > 0;
  const hasRecentClicks = recentClicks > 0;
  const goodOnboarding = onboardingProgress >= 4;

  if (hasLinks && hasRecentClicks && goodOnboarding) {
    return "healthy";
  }
  if (hasLinks || onboardingProgress >= 2) {
    return "at-risk";
  }
  return "inactive";
}
```

### 3. PushFire Supabase

**Purpose**: Platform metrics (subscribers, notifications, executions, devices)

**Database**: Separate PushFire Supabase project

**Authentication**: Service role key (`PUSHFIRE_SUPABASE_SERVICE_KEY`)

#### Database Functions

**Platform KPIs**:
```sql
CREATE OR REPLACE FUNCTION get_pushfire_platform_kpis(
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ
)
RETURNS TABLE (
  total_users BIGINT,
  total_projects BIGINT,
  total_subscribers BIGINT,
  total_devices BIGINT,
  notifications_sent BIGINT,
  delivery_success_rate NUMERIC
)
AS $$
  -- Implementation aggregates from subscribers, devices, notifications tables
$$;
```

**Business KPIs**:
```sql
CREATE OR REPLACE FUNCTION get_pushfire_business_kpis()
RETURNS TABLE (
  mrr NUMERIC,
  paid_projects BIGINT,
  total_projects BIGINT
)
AS $$
  -- Implementation calculates MRR from active subscriptions
$$;
```

---

## Caching Strategy

### Upstash Redis

**TTL**: 15 minutes (900 seconds)

**Key Format**: `metrics:{product}:{metricType}:{dateStart}:{dateEnd}`

Examples:
- `metrics:ulink:ga_bundle:30daysAgo:today`
- `metrics:ulink:ulink_business:2024-01-01:2024-01-31`
- `metrics:pushfire:pushfire_platform:7daysAgo:today`

### Cache Implementation

```typescript
// src/lib/cache/kv.ts
const CACHE_TTL_SECONDS = 15 * 60;

export async function getCachedMetrics(
  product: string,
  dateStart: string,
  dateEnd: string,
  metricType: string = "ga_bundle"
): Promise<{
  data: Record<string, unknown> | null;
  cachedAt: string | null;
  isStale: boolean;
}> {
  const key = `metrics:${product}:${metricType}:${dateStart}:${dateEnd}`;

  const cached = await getRedis().get<{
    payload: Record<string, unknown>;
    fetchedAt: string;
  }>(key);

  if (!cached) {
    return { data: null, cachedAt: null, isStale: true };
  }

  // With native TTL, if the key exists it's fresh
  return { data: cached.payload, cachedAt: cached.fetchedAt, isStale: false };
}

export async function setCachedMetrics(
  product: string,
  dateStart: string,
  dateEnd: string,
  payload: unknown,
  metricType: string = "ga_bundle"
): Promise<void> {
  const key = `metrics:${product}:${metricType}:${dateStart}:${dateEnd}`;

  await getRedis().set(
    key,
    { payload, fetchedAt: new Date().toISOString() },
    { ex: CACHE_TTL_SECONDS }
  );
}
```

### Fallback Strategy

API routes serve stale cache when upstream APIs fail:

```typescript
try {
  const bundle = await fetchWebsiteBundle(propertyId, dateRange);
  setCachedMetrics(product, start, end, bundle).catch(console.error);
  return NextResponse.json({ data: bundle, cached: false });
} catch (gaError) {
  console.error("GA fetch failed:", gaError);

  // Serve stale cache as fallback
  if (cached.data) {
    return NextResponse.json({
      data: cached.data,
      cached: true,
      cachedAt: cached.cachedAt,
    });
  }

  return NextResponse.json({ error: "Failed to fetch" }, { status: 502 });
}
```

---

## UI Components

### Design System

**Base**: shadcn/ui (Radix primitives + CVA)

**Charts**: Tremor React

**Theme**: Dark-only (defined in `src/app/globals.css`)

```css
:root {
  --background: 230 21% 11%;
  --foreground: 210 40% 98%;
  --card: 230 21% 13%;
  --primary: 252 87% 67%;
  --border: 230 16% 20%;
  /* ... */
}
```

### Component Hierarchy

```
Layout (sidebar + header)
  │
  ├── Sidebar
  │   └── Nav items (Overview, Somara, ULink, PushFire)
  │
  ├── Header
  │   ├── Breadcrumb
  │   ├── DateRangePicker
  │   └── Logout button
  │
  └── Main content
      ├── Product page ([product]/page.tsx)
      │   ├── KPI grids (6 cards)
      │   ├── Tremor charts (line, bar, donut)
      │   └── Data tables (top pages, referrers)
      │
      └── Overview page (page.tsx)
          ├── Aggregate KPIs (cross-product)
          └── Product summary cards
```

### Key Components

#### KPI Card

```typescript
<KPICard
  label="Total Users"
  value={12345}
  format="number"  // "number" | "duration" | "percent" | "currency"
  loading={loading}
  icon={Users}
  accentColor="#818cf8"
/>
```

**Features**:
- Automatic icon/color mapping from label
- Format-aware value display
- Gradient bottom accent line
- Loading skeleton state

#### Chart Wrapper

```typescript
<ChartWrapper
  title="Visitors Over Time"
  description="Daily active and new users"
  loading={loading}
  error={error}
>
  <AreaChart
    data={visitorsOverTime}
    categories={["activeUsers", "newUsers"]}
    index="date"
    colors={["indigo", "emerald"]}
  />
</ChartWrapper>
```

#### Date Range Picker

**Presets**:
- Last 7 days
- Last 14 days
- Last 30 days (default)
- Last 90 days
- Custom range (calendar picker)

**URL Sync**: Date range stored in URL params:
- Preset: `?days=30`
- Custom: `?start=2024-01-01&end=2024-01-31`

```typescript
const { days, setDays, setCustomRange, dateRange, isCustom } = useDateRange();

// Internally uses Next.js router to update URL:
router.push(`${pathname}?${params.toString()}`);
```

### Tremor Customization

Tremor components are styled via CSS overrides in `globals.css`:

```css
/* Grid lines */
.recharts-cartesian-grid line {
  stroke: hsl(230 16% 20%) !important;
}

/* Tooltip */
.tremor-Tooltip-root,
.recharts-default-tooltip {
  background-color: hsl(230 21% 16%) !important;
  border-color: hsl(230 16% 24%) !important;
}

/* Donut chart label text */
.recharts-pie-label-text {
  fill: hsl(210 40% 90%) !important;
}
```

**Safelist**: Tremor color classes are safelisted in `tailwind.config.ts` to prevent JIT purging:

```typescript
const tremorSafelist = [
  "violet", "amber", "rose", "emerald", "blue", "cyan",
].flatMap((color) =>
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].flatMap((shade) => [
    `fill-${color}-${shade}`,
    `stroke-${color}-${shade}`,
    `bg-${color}-${shade}`,
    `text-${color}-${shade}`,
  ])
);
```

---

## Database Schema

### Supabase Tables (Dashboard Database)

#### `allowed_users`
```sql
CREATE TABLE public.allowed_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Purpose**: Signup allowlist (checked in `/api/auth/signup`)

**RLS**: Enabled, but no public policies (service role only)

#### `metrics_cache`
```sql
CREATE TABLE IF NOT EXISTS metrics_cache (
  id BIGSERIAL PRIMARY KEY,
  product TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  date_start TEXT NOT NULL,
  date_end TEXT NOT NULL,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT metrics_cache_unique UNIQUE (product, metric_type, date_start, date_end)
);
```

**Purpose**: Optional Supabase-based cache (not currently used; Upstash Redis is preferred)

**Index**:
```sql
CREATE INDEX idx_metrics_cache_lookup
  ON metrics_cache (product, date_start, date_end, fetched_at);
```

---

## API Routes

### Authentication Endpoints

#### `POST /api/auth/signup`

**Request**:
```json
{ "email": "user@example.com", "password": "password123" }
```

**Process**:
1. Validate email is in `ALLOWED_EMAILS`
2. Create Firebase user via Admin SDK
3. Set `emailVerified: true` (no email verification flow)

**Response**:
```json
{ "success": true }
```

#### `POST /api/auth/login`

**Request**:
```json
{ "idToken": "firebase-id-token" }
```

**Process**:
1. Verify ID token via Firebase Admin
2. Create session cookie (14-day expiry)
3. Set `fw_session` cookie (httpOnly, secure in prod)

**Response**:
```json
{ "success": true }
```

#### `GET /api/auth/verify`

**Headers**: `Cookie: fw_session=...`

**Process**:
1. Verify session cookie via Firebase Admin
2. Return user ID

**Response**:
```json
{ "uid": "firebase-user-id" }
```

#### `POST /api/auth/logout`

**Process**:
1. Clear `fw_session` cookie (set maxAge: 0)

**Response**:
```json
{ "success": true }
```

### Metrics Endpoints

#### `GET /api/metrics/ga`

**Query Params**:
- `product`: "somara" | "ulink" | "pushfire"
- `start`: "30daysAgo" | "2024-01-01"
- `end`: "today" | "2024-01-31"

**Response**:
```json
{
  "data": {
    "kpis": {
      "totalUsers": 12345,
      "newUsers": 567,
      "sessions": 8901,
      "pageviews": 23456,
      "avgSessionDuration": 123.45,
      "bounceRate": 0.42
    },
    "visitorsOverTime": [
      { "date": "20240101", "activeUsers": 100, "newUsers": 20, "sessions": 150 }
    ],
    "topPages": [
      { "pagePath": "/", "pageTitle": "Home", "pageviews": 5000, "users": 1000 }
    ],
    "referrers": [
      { "source": "google", "medium": "organic", "sessions": 1000, "users": 800 }
    ],
    "countries": [
      { "country": "United States", "countryId": "US", "users": 5000 }
    ],
    "devices": [
      { "deviceCategory": "desktop", "users": 7000 }
    ]
  },
  "error": null,
  "cached": false,
  "cachedAt": null
}
```

#### `GET /api/metrics/ulink`

**Query Params**:
- `start`: Date string
- `end`: Date string

**Response**:
```json
{
  "data": {
    "mrr": 12345,
    "totalSignups": 567,
    "totalPaidUsers": 89,
    "activeProjects": 45,
    "visitorToSignupRate": 0.12,
    "signupToPaidRate": 0.16,
    "signupsOverTime": [
      { "date": "2024-01-01", "signups": 10 }
    ],
    "mrrOverTime": [
      { "date": "2024-01-01", "mrr": 1000 }
    ]
  },
  "error": null,
  "cached": true,
  "cachedAt": "2024-01-01T12:00:00Z"
}
```

#### `GET /api/metrics/ulink/health`

**Response**:
```json
{
  "data": {
    "totalProjects": 100,
    "healthyCount": 60,
    "atRiskCount": 25,
    "inactiveCount": 15,
    "avgOnboardingProgress": 0.67,
    "configuredRate": 0.80,
    "projectsWithLinks": 85,
    "projects": [
      {
        "projectId": "uuid",
        "projectName": "Acme Corp",
        "createdAt": "2024-01-01T00:00:00Z",
        "memberCount": 3,
        "onboardingSteps": {
          "domainSetup": true,
          "platformSelection": true,
          "platformConfig": false,
          "cliVerified": false,
          "sdkSetupViewed": true,
          "platformImplementationViewed": false
        },
        "onboardingProgress": 3,
        "isConfigured": true,
        "linksCreated": 50,
        "totalClicks": 1000,
        "recentClicks": 100,
        "healthScore": "healthy"
      }
    ]
  },
  "error": null,
  "cached": false,
  "cachedAt": null
}
```

#### `GET /api/metrics/ulink/website`

Same schema as `/api/metrics/ga`, but filtered to exclude `/dashboard/*` paths.

#### `GET /api/metrics/ulink/dashboard-users`

Same schema as `/api/metrics/ga`, but filtered to only `/dashboard/*` paths.

#### `GET /api/metrics/pushfire`

**Response**:
```json
{
  "data": {
    "kpis": {
      "totalUsers": 5000,
      "totalProjects": 1200,
      "totalSubscribers": 50000,
      "totalDevices": 75000,
      "notificationsSent": 1000000,
      "deliverySuccessRate": 0.95
    },
    "businessKpis": {
      "mrr": 25000,
      "paidProjects": 600,
      "signupToPaidRate": 0.50
    },
    "subscribersOverTime": [
      { "date": "2024-01-01", "count": 1000 }
    ],
    "notificationsOverTime": [
      { "date": "2024-01-01", "push": 5000, "email": 2000 }
    ],
    "executionsOverTime": [
      { "date": "2024-01-01", "executions": 10000 }
    ],
    "deviceBreakdown": [
      { "os": "iOS", "count": 40000 },
      { "os": "Android", "count": 35000 }
    ]
  },
  "error": null,
  "cached": false,
  "cachedAt": null
}
```

---

## Environment Setup

### Required Environment Variables

```bash
# Firebase Auth
NEXT_PUBLIC_FIREBASE_API_KEY=your-firebase-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"..."}

# Allowed signup emails (comma-separated)
ALLOWED_EMAILS=you@example.com,other@example.com

# Upstash Redis (auto-injected by Vercel Marketplace integration)
KV_REST_API_URL=https://your-instance.upstash.io
KV_REST_API_TOKEN=your-upstash-token

# Google Analytics - Service Account JSON (base64 encoded)
GA_SERVICE_ACCOUNT_JSON=base64-encoded-service-account-json

# Google Analytics - Property IDs (numeric)
GA_PROPERTY_ID_SOMARA=123456789
GA_PROPERTY_ID_ULINK=123456789
GA_PROPERTY_ID_PUSHFIRE=123456789

# ULink Supabase (ULink's own database for signups/subscriptions)
ULINK_SUPABASE_URL=https://cjgihassfsspxivjtgoi.supabase.co
ULINK_SUPABASE_SERVICE_KEY=your-ulink-service-role-key

# PushFire Supabase (PushFire's own database for platform metrics)
PUSHFIRE_SUPABASE_URL=https://your-pushfire-project.supabase.co
PUSHFIRE_SUPABASE_SERVICE_KEY=your-pushfire-service-role-key
```

### Setup Steps

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure Firebase**:
   - Create Firebase project
   - Enable Email/Password authentication
   - Download service account JSON
   - Add public config to `.env.local`
   - Add service account JSON to `FIREBASE_SERVICE_ACCOUNT_KEY`

3. **Configure Google Analytics**:
   - Create service account in GCP Console
   - Grant "Viewer" role on GA4 properties
   - Download JSON key
   - Base64 encode: `cat service-account.json | base64`
   - Add to `GA_SERVICE_ACCOUNT_JSON`
   - Get property IDs from GA4 admin

4. **Configure Upstash Redis**:
   - Create Upstash account
   - Create Redis database
   - Copy REST API URL and token
   - (Or use Vercel Marketplace integration)

5. **Configure Supabase**:
   - Run SQL migrations in each Supabase project:
     - ULink: `supabase/ulink_setup.sql`
     - ULink: `supabase/ulink_client_health.sql`
     - PushFire: (custom RPC functions, not included)
   - Generate service role keys
   - Add to `.env.local`

6. **Run development server**:
   ```bash
   npm run dev
   ```

---

## Deployment

### Vercel (Recommended)

1. **Connect GitHub repo** to Vercel

2. **Configure environment variables** in Vercel dashboard:
   - Add all variables from `.env.local`
   - Use Vercel's Upstash integration for automatic Redis setup

3. **Deploy**:
   ```bash
   git push origin main
   ```

### Edge Middleware Compatibility

The authentication middleware runs on Vercel Edge Runtime, which:
- ✅ Supports `fetch()` for internal API calls
- ❌ Cannot import Firebase Admin SDK directly
- ✅ Works around this by calling `/api/auth/verify` (Node.js runtime)

### Production Considerations

1. **Environment Variables**: Ensure all keys are set in production
2. **CORS**: Not required (Next.js API routes are same-origin)
3. **Rate Limiting**: Consider adding rate limiting to API routes
4. **Monitoring**: Add error tracking (Sentry, etc.)
5. **Caching**: 15-minute TTL may need adjustment based on traffic

---

## Adding a New Product

To add a new product to the dashboard:

1. **Add product config** (`src/lib/config/products.ts`):
   ```typescript
   {
     slug: "newproduct",
     name: "New Product",
     color: "#10b981",
     gaPropertyId: process.env.GA_PROPERTY_ID_NEWPRODUCT || "",
     hasGAMetrics: true,
     hasBusinessMetrics: false,
     hasSomaraMetrics: false,
     hasPushFireMetrics: false,
   }
   ```

2. **Add icon** (`src/components/layout/sidebar.tsx`):
   ```typescript
   const productIcons: Record<string, React.ReactNode> = {
     newproduct: <Rocket className="h-4 w-4" />,
   };
   ```

3. **Add GA property ID** (`.env.local`):
   ```bash
   GA_PROPERTY_ID_NEWPRODUCT=987654321
   ```

4. **(Optional) Add custom data source**:
   - Create `src/lib/integrations/newproduct/`
   - Add `client.ts`, `queries.ts`, `transform.ts`
   - Create API route `/api/metrics/newproduct/route.ts`
   - Create hook `src/hooks/use-newproduct-metrics.ts`

5. **Update product page** (`src/app/(dashboard)/[product]/page.tsx`):
   - Add conditional rendering based on product flags

---

## Troubleshooting

### Cache Issues

**Problem**: Stale data showing despite fresh data available

**Solution**: Clear Redis cache manually or reduce TTL

```bash
# Using Upstash Console or CLI
redis-cli DEL "metrics:ulink:ulink_business:30daysAgo:today"
```

### Authentication Loop

**Problem**: Redirects to `/login` repeatedly

**Solution**: Check Firebase session cookie verification

```bash
# Verify session cookie is being set
document.cookie  # In browser console

# Check middleware is allowing verified requests
# Add console.log in /api/auth/verify
```

### GA Data Not Loading

**Problem**: "Failed to fetch analytics data"

**Solution**:
1. Verify service account has "Viewer" role on GA4 property
2. Check property ID is correct (numeric, not "properties/123456789")
3. Verify base64 encoding of service account JSON is valid

```bash
# Test base64 encoding
echo $GA_SERVICE_ACCOUNT_JSON | base64 -d | jq .
```

### Supabase RPC Errors

**Problem**: "function get_daily_signups does not exist"

**Solution**: Run SQL migrations in correct Supabase project

```bash
# ULink Supabase
psql $ULINK_DATABASE_URL < supabase/ulink_setup.sql
psql $ULINK_DATABASE_URL < supabase/ulink_client_health.sql
```

---

## Performance Optimization

### Current Optimizations

1. **Redis Caching**: 15-minute TTL reduces API calls
2. **Parallel Fetching**: All metrics fetched in parallel via `Promise.all()`
3. **Edge Middleware**: Fast auth checks on Vercel Edge
4. **Singleton Clients**: SDK clients reused across requests
5. **Conditional Rendering**: Skips data fetching when product doesn't have that feature

### Future Optimizations

1. **React Query**: Replace custom hooks with React Query for better caching
2. **Incremental Static Regeneration**: Cache product pages at build time
3. **Streaming SSR**: Stream chart data as it becomes available
4. **CDN Caching**: Cache API responses at edge (with short TTL)
5. **Database Indexes**: Ensure all Supabase queries have appropriate indexes

---

## License

Internal Flywheel Studio project — not licensed for external use.
