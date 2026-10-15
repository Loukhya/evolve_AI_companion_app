-- Add the daily_tasks_cache column as JSONB to user_settings table to support Discovery caching
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS daily_tasks_cache JSONB;
