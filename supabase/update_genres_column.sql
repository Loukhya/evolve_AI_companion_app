-- Add the genres array column to user_interests
ALTER TABLE user_interests
ADD COLUMN IF NOT EXISTS genres text[] DEFAULT '{}';
