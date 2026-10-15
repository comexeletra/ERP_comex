CREATE INDEX IF NOT EXISTS ix_data_issue_open_source
    ON migration.data_issue (source_row_id, issue_code, field_name)
    WHERE status = 'OPEN';
