-- Add sensor_position and orientation columns to events table
-- These store the TX position/orientation at detection time for historical replay
ALTER TABLE events ADD COLUMN sensor_position REAL DEFAULT NULL;
ALTER TABLE events ADD COLUMN orientation TEXT DEFAULT NULL;
