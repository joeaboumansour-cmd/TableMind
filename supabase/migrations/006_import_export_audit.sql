-- Import/Export Audit Log Migration
-- Creates audit trail for CSV import/export operations

-- ============================================================================
-- AUDIT LOG TABLE
-- ============================================================================

CREATE TABLE import_export_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  operation_type VARCHAR(10) NOT NULL CHECK (operation_type IN ('IMPORT', 'EXPORT')),
  import_mode VARCHAR(20) CHECK (import_mode IN ('upsert', 'create_only', 'replace_all')),
  total_rows INTEGER DEFAULT 0,
  successful_rows INTEGER DEFAULT 0,
  failed_rows INTEGER DEFAULT 0,
  file_name TEXT,
  file_size INTEGER,
  errors_summary JSONB,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying by store and date
CREATE INDEX idx_import_export_audit_store ON import_export_audit(store_id);
CREATE INDEX idx_import_export_audit_created ON import_export_audit(created_at);
CREATE INDEX idx_import_export_audit_store_created ON import_export_audit(store_id, created_at);

-- Enable RLS
ALTER TABLE import_export_audit ENABLE ROW LEVEL SECURITY;

-- Policy: Stores can only see their own audit logs
CREATE POLICY "import_export_audit_select" ON import_export_audit 
  FOR SELECT 
  USING (store_id = auth.uid());

CREATE POLICY "import_export_audit_insert" ON import_export_audit 
  FOR INSERT 
  WITH CHECK (store_id = auth.uid());

-- ============================================================================
-- HELPER FUNCTION TO LOG IMPORT OPERATIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION log_import_operation(
  p_store_id UUID,
  p_import_mode VARCHAR(20),
  p_total_rows INTEGER,
  p_successful_rows INTEGER,
  p_failed_rows INTEGER,
  p_file_name TEXT,
  p_file_size INTEGER,
  p_errors_summary JSONB
)
RETURNS UUID AS $$
DECLARE
  v_audit_id UUID;
BEGIN
  INSERT INTO import_export_audit (
    store_id,
    operation_type,
    import_mode,
    total_rows,
    successful_rows,
    failed_rows,
    file_name,
    file_size,
    errors_summary
  )
  VALUES (
    p_store_id,
    'IMPORT',
    p_import_mode,
    p_total_rows,
    p_successful_rows,
    p_failed_rows,
    p_file_name,
    p_file_size,
    p_errors_summary
  )
  RETURNING id INTO v_audit_id;
  
  RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- HELPER FUNCTION TO LOG EXPORT OPERATIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION log_export_operation(
  p_store_id UUID,
  p_total_rows INTEGER,
  p_file_name TEXT,
  p_file_size INTEGER
)
RETURNS UUID AS $$
DECLARE
  v_audit_id UUID;
BEGIN
  INSERT INTO import_export_audit (
    store_id,
    operation_type,
    total_rows,
    file_name,
    file_size
  )
  VALUES (
    p_store_id,
    'EXPORT',
    p_total_rows,
    p_file_name,
    p_file_size
  )
  RETURNING id INTO v_audit_id;
  
  RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION TO GET RECENT AUDIT LOGS
-- ============================================================================

CREATE OR REPLACE FUNCTION get_recent_import_logs(
  p_store_id UUID,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  operation_type VARCHAR,
  import_mode VARCHAR,
  total_rows INTEGER,
  successful_rows INTEGER,
  failed_rows INTEGER,
  file_name TEXT,
  created_at TIMESTAMPTZ,
  errors_summary JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.operation_type,
    a.import_mode,
    a.total_rows,
    a.successful_rows,
    a.failed_rows,
    a.file_name,
    a.created_at,
    a.errors_summary
  FROM import_export_audit a
  WHERE a.store_id = p_store_id
  ORDER BY a.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;