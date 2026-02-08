-- ============================================================
-- ULink Database Setup
-- Run these on the ULink Supabase project (cjgihassfsspxivjtgoi)
-- These enable the dashboard to query signups and MRR data
-- ============================================================

-- 1. Create a view on auth.users so we can query signups via the API
--    (auth.users is not directly accessible via PostgREST)
CREATE OR REPLACE VIEW public.users_view AS
SELECT
  id,
  created_at,
  email
FROM auth.users;

-- Grant access to the service role
GRANT SELECT ON public.users_view TO service_role;

-- 2. Function to get daily signups within a date range
CREATE OR REPLACE FUNCTION public.get_daily_signups(
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ
)
RETURNS TABLE (date TEXT, count BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    to_char(created_at::date, 'YYYY-MM-DD') AS date,
    count(*) AS count
  FROM auth.users
  WHERE created_at >= start_date
    AND created_at <= end_date
  GROUP BY created_at::date
  ORDER BY created_at::date;
$$;

-- 3. Function to get MRR over time
--    Returns cumulative MRR by day based on subscription activation dates
CREATE OR REPLACE FUNCTION public.get_mrr_over_time(
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ
)
RETURNS TABLE (date TEXT, mrr NUMERIC)
LANGUAGE sql
STABLE
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
  FROM daily_activations
  ORDER BY activation_date;
$$;
