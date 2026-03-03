-- Add orientation column to devices table (inward/outward detection direction)
-- Safe to run multiple times: uses IF NOT EXISTS via PRAGMA check
ALTER TABLE devices ADD COLUMN orientation TEXT DEFAULT 'inward';
