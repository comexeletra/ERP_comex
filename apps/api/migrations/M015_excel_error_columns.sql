-- Restore the source audit calculation-error flags from the immutable issue
-- records produced by the approved workbook import. Raw cell values stay intact.
UPDATE migration.source_row AS source
SET error_columns = errors.columns
FROM (
    SELECT source_row_id, jsonb_agg(field_name ORDER BY field_name) AS columns
    FROM (
        SELECT DISTINCT source_row_id, field_name
        FROM migration.data_issue
        WHERE issue_code = 'EXCEL_CELL_ERROR'
          AND source_row_id IS NOT NULL
          AND field_name IS NOT NULL
    ) AS distinct_errors
    GROUP BY source_row_id
) AS errors
WHERE source.id = errors.source_row_id
  AND source.error_columns = '[]'::jsonb;
