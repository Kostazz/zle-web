ALTER TABLE daily_lines
  ADD COLUMN IF NOT EXISTS context_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS generation_meta jsonb;
