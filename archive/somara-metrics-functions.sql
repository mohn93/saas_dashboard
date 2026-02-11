-- =============================================================================
-- Somara Metrics Functions — Archived from production
-- These were used by the Flywheel dashboard for Somara platform monitoring.
-- To restore, run this file against the Somara Supabase database.
-- =============================================================================

-- 1. Active Users (distinct message senders in date range)
CREATE OR REPLACE FUNCTION public.metrics_somara_active_users(start_date timestamp with time zone, end_date timestamp with time zone)
 RETURNS TABLE(count bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COUNT(DISTINCT user_id)::bigint AS count
  FROM public.messages
  WHERE user_id IS NOT NULL
    AND created_at >= start_date AND created_at <= end_date;
$function$;

-- 2. Tokens Sum (total tokens consumed in date range)
CREATE OR REPLACE FUNCTION public.metrics_somara_tokens_sum(start_date timestamp with time zone, end_date timestamp with time zone)
 RETURNS TABLE(total bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(tokens), 0)::bigint AS total
  FROM public.messages
  WHERE created_at >= start_date AND created_at <= end_date;
$function$;

-- 3. Daily Activity (messages + active users per day)
CREATE OR REPLACE FUNCTION public.metrics_somara_daily_activity(start_date timestamp with time zone, end_date timestamp with time zone)
 RETURNS TABLE(date text, messages bigint, active_users bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    to_char(created_at::date, 'YYYY-MM-DD') AS date,
    COUNT(*)::bigint AS messages,
    COUNT(DISTINCT user_id)::bigint AS active_users
  FROM public.messages
  WHERE created_at >= start_date AND created_at <= end_date
  GROUP BY created_at::date
  ORDER BY created_at::date;
$function$;

-- 4. Daily Signups (new profile creations per day)
CREATE OR REPLACE FUNCTION public.metrics_somara_daily_signups(start_date timestamp with time zone, end_date timestamp with time zone)
 RETURNS TABLE(date text, count bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    to_char(created_at::date, 'YYYY-MM-DD') AS date,
    COUNT(*)::bigint AS count
  FROM public.profiles
  WHERE created_at >= start_date AND created_at <= end_date
  GROUP BY created_at::date
  ORDER BY created_at::date;
$function$;

-- 5. Daily Tokens (token consumption per day)
CREATE OR REPLACE FUNCTION public.metrics_somara_daily_tokens(start_date timestamp with time zone, end_date timestamp with time zone)
 RETURNS TABLE(date text, tokens bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    to_char(created_at::date, 'YYYY-MM-DD') AS date,
    COALESCE(SUM(tokens), 0)::bigint AS tokens
  FROM public.messages
  WHERE created_at >= start_date AND created_at <= end_date
  GROUP BY created_at::date
  ORDER BY created_at::date;
$function$;

-- 6. Org Billing Breakdown (active orgs grouped by owner_type)
CREATE OR REPLACE FUNCTION public.metrics_somara_org_billing_breakdown()
 RETURNS TABLE(owner_type text, count bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    owner_type::text,
    COUNT(*)::bigint AS count
  FROM public.organizations
  WHERE status = 'Active'
  GROUP BY owner_type
  ORDER BY count DESC;
$function$;

-- 7. Top Models (most used AI models by assistant count)
CREATE OR REPLACE FUNCTION public.metrics_somara_top_models()
 RETURNS TABLE(model_id text, provider text, assistant_count bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    mpm.model_id,
    mpm.provider,
    COUNT(a.id)::bigint AS assistant_count
  FROM public.assistants a
  JOIN public.model_provider_mappings mpm ON a.model_provider_mapping_id = mpm.id
  WHERE a.status = 'Active'
  GROUP BY mpm.model_id, mpm.provider
  ORDER BY assistant_count DESC
  LIMIT 10;
$function$;

-- 8. Credits Overview (credits grouped by source)
CREATE OR REPLACE FUNCTION public.metrics_somara_credits_overview()
 RETURNS TABLE(source text, total_granted double precision, total_consumed double precision, total_remaining double precision)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    source,
    COALESCE(SUM(amount), 0) AS total_granted,
    COALESCE(SUM(consumed_amount), 0) AS total_consumed,
    COALESCE(SUM(remaining), 0) AS total_remaining
  FROM public.credits_ledger
  GROUP BY source
  ORDER BY total_granted DESC;
$function$;

-- 9. Business KPIs (active subscribers + total credits purchased)
CREATE OR REPLACE FUNCTION public.metrics_somara_business_kpis()
 RETURNS TABLE(active_subscribers bigint, credits_purchased bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    (SELECT COUNT(*) FROM user_billing_preferences WHERE subscription_status = 'active') AS active_subscribers,
    (SELECT COALESCE(SUM(amount)::bigint, 0) FROM credits_ledger WHERE source = 'purchase') AS credits_purchased;
$function$;

-- 10. Subscriptions Over Time (cumulative active subscriptions per day)
CREATE OR REPLACE FUNCTION public.metrics_somara_subscriptions_over_time(start_date timestamp with time zone, end_date timestamp with time zone)
 RETURNS TABLE(date text, cumulative bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH date_series AS (
    SELECT d::date AS day
    FROM generate_series(start_date::date, end_date::date, '1 day'::interval) d
  ),
  sub_events AS (
    SELECT created_at::date AS event_date, 1 AS delta
    FROM user_billing_preferences
    WHERE subscription_status = 'active'
    UNION ALL
    SELECT updated_at::date AS event_date, -1 AS delta
    FROM user_billing_preferences
    WHERE subscription_status = 'cancelled' AND updated_at IS NOT NULL
  ),
  daily_delta AS (
    SELECT event_date, SUM(delta) AS net_change
    FROM sub_events
    GROUP BY event_date
  )
  SELECT
    to_char(ds.day, 'YYYY-MM-DD') AS date,
    COALESCE(SUM(dd.net_change) OVER (ORDER BY ds.day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 0)::bigint AS cumulative
  FROM date_series ds
  LEFT JOIN daily_delta dd ON dd.event_date = ds.day
  ORDER BY ds.day;
$function$;

-- 11. Credit Purchases Over Time (daily credit purchase volumes)
CREATE OR REPLACE FUNCTION public.metrics_somara_credit_purchases_over_time(start_date timestamp with time zone, end_date timestamp with time zone)
 RETURNS TABLE(date text, credits bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH date_series AS (
    SELECT d::date AS day
    FROM generate_series(start_date::date, end_date::date, '1 day'::interval) d
  ),
  daily_purchases AS (
    SELECT created_at::date AS purchase_date, SUM(amount)::bigint AS total
    FROM credits_ledger
    WHERE source = 'purchase'
      AND created_at >= start_date
      AND created_at <= end_date
    GROUP BY created_at::date
  )
  SELECT
    to_char(ds.day, 'YYYY-MM-DD') AS date,
    COALESCE(dp.total, 0)::bigint AS credits
  FROM date_series ds
  LEFT JOIN daily_purchases dp ON dp.purchase_date = ds.day
  ORDER BY ds.day;
$function$;
