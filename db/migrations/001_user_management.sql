USE switch_monitor;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role ENUM('admin', 'user') NOT NULL DEFAULT 'user'
  AFTER full_name;

UPDATE users
SET role = 'admin'
WHERE username = 'admin';
