-- 004: background steps record their failure on the episode so the page can show it
ALTER TABLE content_projects ADD COLUMN IF NOT EXISTS last_error text;
