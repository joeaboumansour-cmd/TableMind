-- Migration: Add width and height columns to tables for floor plan resizing
-- Created: 2026-02-20

-- Add width column to tables
ALTER TABLE tables 
ADD COLUMN IF NOT EXISTS width INTEGER;

-- Add height column to tables
ALTER TABLE tables 
ADD COLUMN IF NOT EXISTS height INTEGER;

-- Add comment explaining the columns
COMMENT ON COLUMN tables.width IS 'Table width in pixels for floor plan visualization';
COMMENT ON COLUMN tables.height IS 'Table height in pixels for floor plan visualization';

-- Set default values for existing tables (optional - will use defaults in app)
-- UPDATE tables SET width = 100, height = 80 WHERE width IS NULL OR height IS NULL;
