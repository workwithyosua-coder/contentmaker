-- 005: background caption writing has its own status
ALTER TYPE project_status_t ADD VALUE IF NOT EXISTS 'captioning' AFTER 'awaiting_script_approval';
