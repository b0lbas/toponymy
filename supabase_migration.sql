-- Supabase Migration: Add pattern reports and hidden patterns tables

-- Create hidden_patterns table
CREATE TABLE IF NOT EXISTS hidden_patterns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  country_id text NOT NULL,
  pattern text NOT NULL,
  created_at timestamp DEFAULT now(),
  UNIQUE(country_id, pattern)
);

CREATE INDEX IF NOT EXISTS idx_hidden_patterns_country ON hidden_patterns(country_id);

-- Create pattern_reports table
CREATE TABLE IF NOT EXISTS pattern_reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  country_id text NOT NULL,
  pattern text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text,
  comment text,
  status text DEFAULT 'pending', -- pending, accepted, rejected
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  UNIQUE(country_id, pattern, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON pattern_reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_country ON pattern_reports(country_id);
CREATE INDEX IF NOT EXISTS idx_reports_created ON pattern_reports(created_at DESC);

-- Enable RLS (Row Level Security)
ALTER TABLE pattern_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE hidden_patterns ENABLE ROW LEVEL SECURITY;

-- RLS Policies for pattern_reports
-- Users can insert their own reports
DROP POLICY IF EXISTS "Users can insert their own reports" ON pattern_reports;
CREATE POLICY "Users can insert their own reports"
  ON pattern_reports FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can view only their own reports
DROP POLICY IF EXISTS "Users can view their own reports" ON pattern_reports;
CREATE POLICY "Users can view their own reports"
  ON pattern_reports FOR SELECT
  USING (user_id = auth.uid());

-- Admin can view all reports (handled in backend)
-- RLS Policies for hidden_patterns
-- Anyone can read hidden patterns
DROP POLICY IF EXISTS "Anyone can read hidden patterns" ON hidden_patterns;
CREATE POLICY "Anyone can read hidden patterns"
  ON hidden_patterns FOR SELECT
  USING (true);

-- Likes table for pattern favorites
CREATE TABLE IF NOT EXISTS likes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pattern_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp DEFAULT now(),
  UNIQUE(pattern_key, user_id)
);

CREATE INDEX IF NOT EXISTS idx_likes_pattern ON likes(pattern_key);
CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);
