-- Create the metrics cache table
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

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_metrics_cache_lookup
  ON metrics_cache (product, date_start, date_end, fetched_at);

-- Enable RLS (optional, since we use service role key)
ALTER TABLE metrics_cache ENABLE ROW LEVEL SECURITY;
