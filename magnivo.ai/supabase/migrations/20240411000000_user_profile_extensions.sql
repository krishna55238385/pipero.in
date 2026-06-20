-- Add Profile and Notification columns to Users
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS avatar_url TEXT,
ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{
  "tasks": {
    "assigned": {"in_app": true, "email": true, "push": true},
    "due": {"in_app": true, "email": true, "push": true},
    "overdue": {"in_app": true, "email": true, "push": true}
  },
  "leads": {
    "assigned": {"in_app": true, "email": true, "push": true},
    "risk": {"in_app": true, "email": true, "push": true}
  },
  "ai": {
    "recommendation": {"in_app": true, "email": true, "push": true},
    "automation_failed": {"in_app": true, "email": true, "push": true}
  },
  "system": {
    "security": {"in_app": true, "email": true, "push": true}
  }
}'::jsonb;
