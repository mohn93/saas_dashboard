-- ============================================================
-- ULink Client Health - Database Functions
-- Run these on the ULink Supabase project (cjgihassfsspxivjtgoi)
-- These enable the dashboard to query project health data
-- ============================================================

-- Function to get per-project health summary with aggregated data
-- Joins projects, onboarding, configuration, members, links, and clicks
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
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.id AS project_id,
    p.name AS project_name,
    p.created_at AS project_created_at,
    COALESCE(pm.member_count, 0) AS member_count,
    COALESCE(pos.domain_setup_completed IS NOT NULL, false) AS domain_setup,
    COALESCE(pos.platform_selection_completed IS NOT NULL, false) AS platform_selection,
    COALESCE(pos.platform_config_completed IS NOT NULL, false) AS platform_config,
    COALESCE(pos.cli_verified IS NOT NULL, false) AS cli_verified,
    COALESCE(pos.sdk_setup_viewed IS NOT NULL, false) AS sdk_setup_viewed,
    COALESCE(pos.platform_implementation_viewed IS NOT NULL, false) AS platform_implementation_viewed,
    (pc.project_id IS NOT NULL) AS is_configured,
    COALESCE(lk.links_created, 0) AS links_created,
    COALESCE(lk.total_clicks, 0) AS total_clicks,
    COALESCE(rc.recent_clicks, 0) AS recent_clicks
  FROM projects p
  LEFT JOIN (
    SELECT project_id, count(*) AS member_count
    FROM project_members
    GROUP BY project_id
  ) pm ON pm.project_id = p.id
  LEFT JOIN project_onboarding_status pos ON pos.project_id = p.id
  LEFT JOIN (
    SELECT DISTINCT ON (project_id) project_id
    FROM project_configurations
  ) pc ON pc.project_id = p.id
  LEFT JOIN (
    SELECT
      project_id,
      count(*) AS links_created,
      COALESCE(sum(click_count), 0) AS total_clicks
    FROM links
    GROUP BY project_id
  ) lk ON lk.project_id = p.id
  LEFT JOIN (
    SELECT
      l.project_id,
      count(lc.id) AS recent_clicks
    FROM links l
    JOIN link_clicks lc ON lc.link_id = l.id
    WHERE l.created_at >= start_date
      AND l.created_at <= end_date
    GROUP BY l.project_id
  ) rc ON rc.project_id = p.id
  ORDER BY p.name;
$$;
