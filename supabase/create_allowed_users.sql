-- Create allowed_users table for signup allowlist
-- Run this migration in the Supabase SQL Editor
CREATE TABLE public.allowed_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.allowed_users ENABLE ROW LEVEL SECURITY;
-- No public policies — only service_role can read/write

-- Seed with initial emails:
-- INSERT INTO public.allowed_users (email) VALUES ('you@example.com');
