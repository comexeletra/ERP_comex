-- The IP list counts the workbook lines of each IP. With the full history that scan ran once per IP
-- over every source row; this index serves the expression the readers already use.
CREATE INDEX ix_source_row_pre_ip_number
  ON migration.source_row ((upper(btrim(raw_values->>'AB'))))
  WHERE sheet_name = 'Pré Embarque';
