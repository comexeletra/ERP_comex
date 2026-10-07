-- Promote the immutable Pre/Post workbook values into the typed operational
-- fields. Existing operational edits win; history fills only empty fields.

CREATE OR REPLACE FUNCTION migration.try_source_text(input_value text, max_length integer)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN nullif(btrim(input_value), '') IS NOT NULL
                   AND length(btrim(input_value)) <= max_length
              THEN btrim(input_value) END
$$;

CREATE OR REPLACE FUNCTION migration.try_source_date(input_value text)
RETURNS date LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
  IF nullif(btrim(input_value), '') IS NULL THEN RETURN NULL; END IF;
  RETURN left(btrim(input_value), 10)::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION migration.try_source_numeric(input_value text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE normalized_value text;
BEGIN
  IF nullif(btrim(input_value), '') IS NULL THEN RETURN NULL; END IF;
  normalized_value := btrim(input_value);
  IF position(',' IN normalized_value) > 0 THEN
    normalized_value := replace(replace(normalized_value, '.', ''), ',', '.');
  END IF;
  RETURN normalized_value::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION migration.try_source_integer(input_value text)
RETURNS integer LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE parsed numeric;
BEGIN
  parsed := migration.try_source_numeric(input_value);
  IF parsed IS NULL OR parsed <> trunc(parsed)
     OR parsed < -2147483648 OR parsed > 2147483647 THEN RETURN NULL; END IF;
  RETURN parsed::integer;
END;
$$;

CREATE OR REPLACE FUNCTION migration.try_source_boolean(input_value text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE lower(btrim(input_value))
    WHEN '1' THEN true WHEN 'true' THEN true WHEN 'yes' THEN true
    WHEN 'y' THEN true WHEN 'sim' THEN true WHEN 's' THEN true WHEN 'ok' THEN true
    WHEN '0' THEN false WHEN 'false' THEN false WHEN 'no' THEN false
    WHEN 'n' THEN false WHEN 'não' THEN false WHEN 'nao' THEN false WHEN 'nok' THEN false
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION migration.try_source_currency(input_value text)
RETURNS char(3) LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN upper(btrim(input_value)) ~ '^[A-Z]{3}$'
              THEN upper(btrim(input_value))::char(3) END
$$;

CREATE TEMP TABLE m027_changed_po (id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE m027_changed_process (id uuid PRIMARY KEY) ON COMMIT DROP;

CREATE TEMP TABLE m027_post_rows ON COMMIT DROP AS
SELECT DISTINCT ON (process.id)
       process.id AS process_id, source.id AS source_row_id, source.batch_id,
       source.row_number, source.raw_values
  FROM imports.import_process AS process
  JOIN migration.source_row AS source
    ON source.sheet_name = U&'P\00f3s Embarque'
   AND process.normalized_ip_number = upper(btrim(source.raw_values->>'B'))
   AND (process.importer IS NULL OR process.importer = btrim(source.raw_values->>'F'))
  JOIN migration.import_batch AS batch ON batch.id = source.batch_id AND batch.state = 'PROMOTED'
 ORDER BY process.id, batch.promoted_at DESC, source.row_number DESC, source.id;

CREATE TEMP TABLE m027_post_fields ON COMMIT DROP AS
SELECT process.id AS process_id, cell.key AS column_key,
       array_agg(DISTINCT nullif(btrim(cell.value), ''))
         FILTER (WHERE nullif(btrim(cell.value), '') IS NOT NULL) AS values
  FROM imports.import_process AS process
  JOIN migration.source_row AS source
    ON source.sheet_name = U&'P\00f3s Embarque'
   AND process.normalized_ip_number = upper(btrim(source.raw_values->>'B'))
   AND (process.importer IS NULL OR process.importer = btrim(source.raw_values->>'F'))
  JOIN migration.import_batch AS batch ON batch.id = source.batch_id AND batch.state = 'PROMOTED'
  CROSS JOIN LATERAL jsonb_each_text(source.raw_values) AS cell(key, value)
 GROUP BY process.id, cell.key;

CREATE TEMP TABLE m027_post_values ON COMMIT DROP AS
SELECT process_id,
       coalesce(jsonb_object_agg(column_key, values[1])
         FILTER (WHERE cardinality(values) = 1), '{}'::jsonb) AS raw_values,
       coalesce(jsonb_agg(column_key) FILTER (WHERE cardinality(values) > 1), '[]'::jsonb)
         AS conflicted_columns
  FROM m027_post_fields GROUP BY process_id;

CREATE TEMP TABLE m027_pre_ip_fields ON COMMIT DROP AS
SELECT process.id AS process_id, cell.key AS column_key,
       array_agg(DISTINCT nullif(btrim(cell.value), ''))
         FILTER (WHERE nullif(btrim(cell.value), '') IS NOT NULL) AS values
  FROM imports.import_process AS process
  JOIN migration.source_row AS source
    ON source.sheet_name = U&'Pr\00e9 Embarque'
   AND process.normalized_ip_number = upper(btrim(source.raw_values->>'AB'))
   AND (process.importer IS NULL OR process.importer = btrim(source.raw_values->>'F'))
  JOIN migration.import_batch AS batch ON batch.id = source.batch_id AND batch.state = 'PROMOTED'
  CROSS JOIN LATERAL jsonb_each_text(source.raw_values) AS cell(key, value)
 GROUP BY process.id, cell.key;

CREATE TEMP TABLE m027_pre_ip_values ON COMMIT DROP AS
SELECT process_id,
       coalesce(jsonb_object_agg(column_key, values[1])
         FILTER (WHERE cardinality(values) = 1), '{}'::jsonb) AS raw_values
  FROM m027_pre_ip_fields GROUP BY process_id;

CREATE TEMP TABLE m027_pre_ip_rows ON COMMIT DROP AS
SELECT DISTINCT ON (process.id)
       process.id AS process_id, source.id AS source_row_id, source.batch_id,
       source.row_number
  FROM imports.import_process AS process
  JOIN migration.source_row AS source
    ON source.sheet_name = U&'Pr\00e9 Embarque'
   AND process.normalized_ip_number = upper(btrim(source.raw_values->>'AB'))
   AND (process.importer IS NULL OR process.importer = btrim(source.raw_values->>'F'))
  JOIN migration.import_batch AS batch ON batch.id = source.batch_id AND batch.state = 'PROMOTED'
 ORDER BY process.id, batch.promoted_at DESC, source.row_number DESC, source.id;

CREATE TEMP TABLE m027_po_fields ON COMMIT DROP AS
SELECT observation.purchase_order_id, cell.key AS column_key,
       array_agg(DISTINCT nullif(btrim(cell.value), ''))
         FILTER (WHERE nullif(btrim(cell.value), '') IS NOT NULL) AS values
  FROM procurement.po_line_observation AS observation
  JOIN migration.source_row AS source ON source.id = observation.source_row_id
  CROSS JOIN LATERAL jsonb_each_text(source.raw_values) AS cell(key, value)
 WHERE cell.key IN ('O', 'R')
 GROUP BY observation.purchase_order_id, cell.key;

CREATE TEMP TABLE m027_po_values ON COMMIT DROP AS
SELECT purchase_order_id,
       coalesce(jsonb_object_agg(column_key, values[1])
         FILTER (WHERE cardinality(values) = 1), '{}'::jsonb) AS raw_values
  FROM m027_po_fields GROUP BY purchase_order_id;

-- Keep conflicting repeated IP-level source values visible and leave those
-- specific fields blank instead of selecting an arbitrary PO row.
WITH conflicts AS (
  SELECT 'POST'::text AS source_kind, process_id, column_key, values
    FROM m027_post_fields WHERE cardinality(values) > 1
      AND column_key = ANY(ARRAY['C','E','H','I','J','K','L','M','N','O','P','Q','S','T','U','V','W','X','Y','Z','AA','AB','AC','AD','AE','AF','AG','AH','AI','AJ','AK','AL','AM','AN','AP','AQ','AR','AS'])
  UNION ALL
  SELECT 'PRE'::text, process_id, column_key, values
    FROM m027_pre_ip_fields WHERE cardinality(values) > 1
      AND column_key = ANY(ARRAY['AC','AD','AE','AF','AG','AH','AI','AJ','AO','AP','AQ','AR','AS','AT','AU','AX'])
), findings AS (
  SELECT source.id, source.batch_id, source.row_number, source.raw_values,
         process.ip_number, conflict.column_key, conflict.values, conflict.source_kind
    FROM conflicts AS conflict
    JOIN imports.import_process AS process ON process.id = conflict.process_id
    JOIN migration.source_row AS source
      ON source.sheet_name = CASE conflict.source_kind
           WHEN 'POST' THEN U&'P\00f3s Embarque' ELSE U&'Pr\00e9 Embarque' END
     AND upper(btrim(source.raw_values->>CASE conflict.source_kind WHEN 'POST' THEN 'B' ELSE 'AB' END))
           = process.normalized_ip_number
     AND (process.importer IS NULL OR process.importer = btrim(source.raw_values->>'F'))
    JOIN migration.import_batch AS batch
      ON batch.id = source.batch_id AND batch.state = 'PROMOTED'
)
INSERT INTO migration.data_issue
  (id, batch_id, source_row_id, severity, issue_code, field_name, evidence)
SELECT md5(id::text || '|M027|IP_SOURCE_CONFLICT|' || source_kind || '|' || column_key)::uuid,
       batch_id, id, 'WARNING', 'IP_SOURCE_CONFLICT', column_key,
       jsonb_build_object('ipNumber', ip_number, 'sheet', source_kind,
                          'column', column_key, 'values', to_jsonb(values))
  FROM findings
ON CONFLICT (id) DO NOTHING;

WITH conflicts AS (
  SELECT purchase_order_id, column_key, values
    FROM m027_po_fields WHERE cardinality(values) > 1
), findings AS (
  SELECT source.id, source.batch_id, source.row_number, po.external_number,
         conflict.column_key, conflict.values
    FROM conflicts AS conflict
    JOIN procurement.purchase_order AS po ON po.id = conflict.purchase_order_id
    JOIN procurement.po_line_observation AS observation ON observation.purchase_order_id = po.id
    JOIN migration.source_row AS source ON source.id = observation.source_row_id
)
INSERT INTO migration.data_issue
  (id, batch_id, source_row_id, severity, issue_code, field_name, evidence)
SELECT md5(id::text || '|M027|PO_SOURCE_CONFLICT|' || column_key)::uuid,
       batch_id, id, 'WARNING', 'PO_SOURCE_CONFLICT', column_key,
       jsonb_build_object('purchaseOrder', external_number, 'column', column_key,
                          'values', to_jsonb(values))
  FROM findings
ON CONFLICT (id) DO NOTHING;

-- Backfill item-level operational fields from each exact Pre observation.
WITH updated AS (
  UPDATE procurement.purchase_order_item AS item
     SET necessity_date = coalesce(item.necessity_date, migration.try_source_date(source.raw_values->>'B')),
         priority = coalesce(item.priority, migration.try_source_text(source.raw_values->>'C', 20)),
         demand = coalesce(item.demand, migration.try_source_text(source.raw_values->>'G', 160)),
         requester = coalesce(item.requester, migration.try_source_text(source.raw_values->>'H', 160)),
         sc_number = coalesce(item.sc_number, migration.try_source_text(source.raw_values->>'I', 80)),
         sc_approval_date = coalesce(item.sc_approval_date, migration.try_source_date(source.raw_values->>'J')),
         purpose = coalesce(item.purpose, migration.try_source_text(source.raw_values->>'K', 160)),
         cost_center = coalesce(item.cost_center, migration.try_source_text(source.raw_values->>'L', 80)),
         draft_po = coalesce(item.draft_po, migration.try_source_text(source.raw_values->>'M', 80)),
         po_approval_date = coalesce(item.po_approval_date, migration.try_source_date(source.raw_values->>'P')),
         po_sent_date = coalesce(item.po_sent_date, migration.try_source_date(source.raw_values->>'Q')),
         category = coalesce(item.category, migration.try_source_text(source.raw_values->>'S', 120)),
         ncm = coalesce(item.ncm, migration.try_source_text(source.raw_values->>'V', 16)),
         remarks = coalesce(item.remarks, migration.try_source_text(source.raw_values->>'AA', 4000)),
         updated_at = now()
    FROM migration.source_row AS source
   WHERE item.source_kind = 'IMPORTED_SOURCE_ITEM'
     AND item.source_observation_id = source.id
     AND (item.necessity_date IS NULL AND migration.try_source_date(source.raw_values->>'B') IS NOT NULL
       OR item.priority IS NULL AND migration.try_source_text(source.raw_values->>'C', 20) IS NOT NULL
       OR item.demand IS NULL AND migration.try_source_text(source.raw_values->>'G', 160) IS NOT NULL
       OR item.requester IS NULL AND migration.try_source_text(source.raw_values->>'H', 160) IS NOT NULL
       OR item.sc_number IS NULL AND migration.try_source_text(source.raw_values->>'I', 80) IS NOT NULL
       OR item.sc_approval_date IS NULL AND migration.try_source_date(source.raw_values->>'J') IS NOT NULL
       OR item.purpose IS NULL AND migration.try_source_text(source.raw_values->>'K', 160) IS NOT NULL
       OR item.cost_center IS NULL AND migration.try_source_text(source.raw_values->>'L', 80) IS NOT NULL
       OR item.draft_po IS NULL AND migration.try_source_text(source.raw_values->>'M', 80) IS NOT NULL
       OR item.po_approval_date IS NULL AND migration.try_source_date(source.raw_values->>'P') IS NOT NULL
       OR item.po_sent_date IS NULL AND migration.try_source_date(source.raw_values->>'Q') IS NOT NULL
       OR item.category IS NULL AND migration.try_source_text(source.raw_values->>'S', 120) IS NOT NULL
       OR item.ncm IS NULL AND migration.try_source_text(source.raw_values->>'V', 16) IS NOT NULL
       OR item.remarks IS NULL AND migration.try_source_text(source.raw_values->>'AA', 4000) IS NOT NULL)
   RETURNING item.id, item.purchase_order_id, item.source_observation_id,
     jsonb_strip_nulls(jsonb_build_object('necessityDate', item.necessity_date,
       'priority', item.priority, 'demand', item.demand, 'requester', item.requester,
       'scNumber', item.sc_number, 'scApprovalDate', item.sc_approval_date,
       'purpose', item.purpose, 'costCenter', item.cost_center, 'draftPo', item.draft_po,
       'poApprovalDate', item.po_approval_date, 'poSentDate', item.po_sent_date,
       'category', item.category, 'ncm', item.ncm, 'remarks', item.remarks)) AS values
), audited AS (
  INSERT INTO audit.audit_log
    (id, aggregate_type, aggregate_id, entity_type, entity_id, operation, field_name,
     old_value, new_value, actor_id, occurred_at, reason, correlation_id)
  SELECT gen_random_uuid(), 'PURCHASE_ORDER', updated.purchase_order_id,
         'PURCHASE_ORDER_ITEM', updated.id, 'HISTORICAL_BACKFILL', NULL,
         NULL, jsonb_build_object('sourceObservationId', updated.source_observation_id,
                                  'values', updated.values),
         'migration:M027', now(), 'Pre Embarkation workbook values promoted to operational item fields.',
         gen_random_uuid()
    FROM updated
  RETURNING aggregate_id
)
INSERT INTO m027_changed_po (id)
SELECT DISTINCT purchase_order_id FROM updated
ON CONFLICT (id) DO NOTHING;

-- Fill PO header fields only when repeated Pre rows agree on the source value.
WITH updated AS (
  UPDATE procurement.purchase_order AS po
     SET supplier_text = coalesce(po.supplier_text,
         migration.try_source_text(values_by_po.raw_values->>'R', 240)),
         order_date = coalesce(po.order_date,
           migration.try_source_date(values_by_po.raw_values->>'O')),
         updated_at = now()
    FROM m027_po_values AS values_by_po
   WHERE po.id = values_by_po.purchase_order_id
     AND ((po.supplier_text IS NULL AND values_by_po.raw_values->>'R' IS NOT NULL)
       OR (po.order_date IS NULL AND values_by_po.raw_values->>'O' IS NOT NULL))
   RETURNING po.id, po.supplier_text, po.order_date
), audited AS (
  INSERT INTO audit.audit_log
    (id, aggregate_type, aggregate_id, entity_type, entity_id, operation, field_name,
     old_value, new_value, actor_id, occurred_at, reason, correlation_id)
  SELECT gen_random_uuid(), 'PURCHASE_ORDER', updated.id, 'PURCHASE_ORDER', updated.id,
         'HISTORICAL_BACKFILL', NULL, NULL,
         jsonb_strip_nulls(jsonb_build_object('supplierText', updated.supplier_text,
                                              'orderDate', updated.order_date)),
         'migration:M027', now(), 'Pre Embarkation workbook values promoted to operational PO fields.',
         gen_random_uuid()
    FROM updated
  RETURNING aggregate_id
)
INSERT INTO m027_changed_po (id)
SELECT id FROM updated ON CONFLICT (id) DO NOTHING;

-- Backfill IP-level fields from Post, then use a unique Pre value only where
-- Post has no value. Logistics dates remain attached to the IP, not the PO.
WITH updated AS (
  UPDATE imports.import_process AS process
     SET priority = coalesce(process.priority, migration.try_source_text(post_values.raw_values->>'C', 20)),
         logistics_status = coalesce(process.logistics_status, migration.try_source_text(post_values.raw_values->>'E', 40)),
         ip_totvs_date = coalesce(process.ip_totvs_date, migration.try_source_date(pre.raw_values->>'AC')),
         transport_mode = coalesce(process.transport_mode,
           migration.try_source_text(post_values.raw_values->>'K', 40),
           CASE WHEN post_values.conflicted_columns ? 'K' THEN NULL
             ELSE migration.try_source_text(pre.raw_values->>'AD', 40) END),
         incoterm = coalesce(process.incoterm,
           migration.try_source_text(post_values.raw_values->>'L', 20),
           CASE WHEN post_values.conflicted_columns ? 'L' THEN NULL
             ELSE migration.try_source_text(pre.raw_values->>'AE', 20) END),
         broker = coalesce(process.broker,
           migration.try_source_text(post_values.raw_values->>'O', 160),
           CASE WHEN post_values.conflicted_columns ? 'O' THEN NULL
             ELSE migration.try_source_text(pre.raw_values->>'AF', 160) END),
         port_loading = coalesce(process.port_loading,
           migration.try_source_text(post_values.raw_values->>'M', 160),
           CASE WHEN post_values.conflicted_columns ? 'M' THEN NULL
             ELSE migration.try_source_text(pre.raw_values->>'AG', 160) END),
         port_discharge = coalesce(process.port_discharge,
           migration.try_source_text(post_values.raw_values->>'N', 160),
           CASE WHEN post_values.conflicted_columns ? 'N' THEN NULL
             ELSE migration.try_source_text(pre.raw_values->>'AH', 160) END),
         etd = coalesce(process.etd, migration.try_source_date(post_values.raw_values->>'Q'),
           CASE WHEN post_values.conflicted_columns ? 'Q' THEN NULL
             ELSE migration.try_source_date(pre.raw_values->>'AI') END),
         eta_confirmed = coalesce(process.eta_confirmed, migration.try_source_date(post_values.raw_values->>'S'),
           CASE WHEN post_values.conflicted_columns ? 'S' THEN NULL
             ELSE migration.try_source_date(pre.raw_values->>'AJ') END),
         ete_confirmed = coalesce(process.ete_confirmed, migration.try_source_date(post_values.raw_values->>'T'),
           CASE WHEN post_values.conflicted_columns ? 'T' THEN NULL
             ELSE migration.try_source_date(pre.raw_values->>'AT') END),
         arrival_date = coalesce(process.arrival_date, migration.try_source_date(post_values.raw_values->>'AC'),
           CASE WHEN post_values.conflicted_columns ? 'AC' THEN NULL
             ELSE migration.try_source_date(pre.raw_values->>'AO') END),
         duimp_number = coalesce(process.duimp_number,
           migration.try_source_text(post_values.raw_values->>'AF', 100),
           CASE WHEN post_values.conflicted_columns ? 'AF' THEN NULL
             ELSE migration.try_source_text(pre.raw_values->>'AP', 100) END),
         duimp_date = coalesce(process.duimp_date, migration.try_source_date(post_values.raw_values->>'AG'),
           CASE WHEN post_values.conflicted_columns ? 'AG' THEN NULL
             ELSE migration.try_source_date(pre.raw_values->>'AQ') END),
         customs_channel = coalesce(process.customs_channel,
           migration.try_source_text(post_values.raw_values->>'AH', 80),
           CASE WHEN post_values.conflicted_columns ? 'AH' THEN NULL
             ELSE migration.try_source_text(pre.raw_values->>'AR', 80) END),
         clearance_date = coalesce(process.clearance_date, migration.try_source_date(post_values.raw_values->>'AI'),
           CASE WHEN post_values.conflicted_columns ? 'AI' THEN NULL
             ELSE migration.try_source_date(pre.raw_values->>'AS') END),
         nf_request_date = coalesce(process.nf_request_date, migration.try_source_date(post_values.raw_values->>'AJ'),
           CASE WHEN post_values.conflicted_columns ? 'AJ' THEN NULL
             ELSE migration.try_source_date(pre.raw_values->>'AU') END),
         delivery_date = coalesce(process.delivery_date, migration.try_source_date(post_values.raw_values->>'AN'),
           CASE WHEN post_values.conflicted_columns ? 'AN' THEN NULL
             ELSE migration.try_source_date(pre.raw_values->>'AX') END),
         freight_currency = CASE WHEN process.freight_currency IS NULL AND process.freight_cost IS NULL
             AND migration.try_source_currency(post_values.raw_values->>'V') IS NOT NULL
             AND migration.try_source_numeric(post_values.raw_values->>'W') >= 0
           THEN migration.try_source_currency(post_values.raw_values->>'V') ELSE process.freight_currency END,
         freight_cost = CASE WHEN process.freight_currency IS NULL AND process.freight_cost IS NULL
             AND migration.try_source_currency(post_values.raw_values->>'V') IS NOT NULL
             AND migration.try_source_numeric(post_values.raw_values->>'W') >= 0
           THEN migration.try_source_numeric(post_values.raw_values->>'W') ELSE process.freight_cost END,
         container_number = coalesce(process.container_number, migration.try_source_text(post_values.raw_values->>'X', 120)),
         container_type = coalesce(process.container_type, migration.try_source_text(post_values.raw_values->>'Y', 80)),
         container_quantity = coalesce(process.container_quantity,
           CASE WHEN migration.try_source_integer(post_values.raw_values->>'Z') >= 0
             THEN migration.try_source_integer(post_values.raw_values->>'Z') END),
         forwarder = coalesce(process.forwarder, migration.try_source_text(post_values.raw_values->>'AA', 160)),
         documents_ok = coalesce(process.documents_ok, migration.try_source_boolean(post_values.raw_values->>'AB')),
         storage_due_override = coalesce(process.storage_due_override,
           migration.try_source_date(post_values.raw_values->>'AD')),
         taxes_paid_brl = coalesce(process.taxes_paid_brl,
           CASE WHEN migration.try_source_numeric(post_values.raw_values->>'AE') >= 0
             THEN migration.try_source_numeric(post_values.raw_values->>'AE') END),
         fine_brl = coalesce(process.fine_brl,
           CASE WHEN migration.try_source_numeric(post_values.raw_values->>'AP') >= 0
             THEN migration.try_source_numeric(post_values.raw_values->>'AP') END),
         storage_brl = coalesce(process.storage_brl,
           CASE WHEN migration.try_source_numeric(post_values.raw_values->>'AQ') >= 0
             THEN migration.try_source_numeric(post_values.raw_values->>'AQ') END),
         demurrage_brl = coalesce(process.demurrage_brl,
           CASE WHEN migration.try_source_numeric(post_values.raw_values->>'AR') >= 0
             THEN migration.try_source_numeric(post_values.raw_values->>'AR') END),
         demurrage_container_quantity = coalesce(process.demurrage_container_quantity,
           CASE WHEN migration.try_source_integer(post_values.raw_values->>'AS') >= 0
             THEN migration.try_source_integer(post_values.raw_values->>'AS') END),
         updated_at = now()
    FROM m027_post_values AS post_values
    FULL JOIN m027_pre_ip_values AS pre ON pre.process_id = post_values.process_id
    LEFT JOIN m027_post_rows AS post
      ON post.process_id = coalesce(post_values.process_id, pre.process_id)
    LEFT JOIN m027_pre_ip_rows AS pre_source
      ON pre_source.process_id = coalesce(post_values.process_id, pre.process_id)
   WHERE process.id = coalesce(post_values.process_id, pre.process_id)
     AND (process.priority IS NULL AND migration.try_source_text(post_values.raw_values->>'C', 20) IS NOT NULL
       OR process.logistics_status IS NULL AND migration.try_source_text(post_values.raw_values->>'E', 40) IS NOT NULL
       OR process.ip_totvs_date IS NULL AND migration.try_source_date(pre.raw_values->>'AC') IS NOT NULL
       OR process.transport_mode IS NULL AND coalesce(migration.try_source_text(post_values.raw_values->>'K', 40), CASE WHEN post_values.conflicted_columns ? 'K' THEN NULL ELSE migration.try_source_text(pre.raw_values->>'AD', 40) END) IS NOT NULL
       OR process.incoterm IS NULL AND coalesce(migration.try_source_text(post_values.raw_values->>'L', 20), CASE WHEN post_values.conflicted_columns ? 'L' THEN NULL ELSE migration.try_source_text(pre.raw_values->>'AE', 20) END) IS NOT NULL
       OR process.broker IS NULL AND coalesce(migration.try_source_text(post_values.raw_values->>'O', 160), CASE WHEN post_values.conflicted_columns ? 'O' THEN NULL ELSE migration.try_source_text(pre.raw_values->>'AF', 160) END) IS NOT NULL
       OR process.port_loading IS NULL AND coalesce(migration.try_source_text(post_values.raw_values->>'M', 160), CASE WHEN post_values.conflicted_columns ? 'M' THEN NULL ELSE migration.try_source_text(pre.raw_values->>'AG', 160) END) IS NOT NULL
       OR process.port_discharge IS NULL AND coalesce(migration.try_source_text(post_values.raw_values->>'N', 160), CASE WHEN post_values.conflicted_columns ? 'N' THEN NULL ELSE migration.try_source_text(pre.raw_values->>'AH', 160) END) IS NOT NULL
       OR process.etd IS NULL AND coalesce(migration.try_source_date(post_values.raw_values->>'Q'), CASE WHEN post_values.conflicted_columns ? 'Q' THEN NULL ELSE migration.try_source_date(pre.raw_values->>'AI') END) IS NOT NULL
       OR process.eta_confirmed IS NULL AND coalesce(migration.try_source_date(post_values.raw_values->>'S'), CASE WHEN post_values.conflicted_columns ? 'S' THEN NULL ELSE migration.try_source_date(pre.raw_values->>'AJ') END) IS NOT NULL
       OR process.ete_confirmed IS NULL AND coalesce(migration.try_source_date(post_values.raw_values->>'T'), CASE WHEN post_values.conflicted_columns ? 'T' THEN NULL ELSE migration.try_source_date(pre.raw_values->>'AT') END) IS NOT NULL
       OR process.arrival_date IS NULL AND coalesce(migration.try_source_date(post_values.raw_values->>'AC'), CASE WHEN post_values.conflicted_columns ? 'AC' THEN NULL ELSE migration.try_source_date(pre.raw_values->>'AO') END) IS NOT NULL
       OR process.duimp_number IS NULL AND coalesce(migration.try_source_text(post_values.raw_values->>'AF', 100), CASE WHEN post_values.conflicted_columns ? 'AF' THEN NULL ELSE migration.try_source_text(pre.raw_values->>'AP', 100) END) IS NOT NULL
       OR process.duimp_date IS NULL AND coalesce(migration.try_source_date(post_values.raw_values->>'AG'), CASE WHEN post_values.conflicted_columns ? 'AG' THEN NULL ELSE migration.try_source_date(pre.raw_values->>'AQ') END) IS NOT NULL
       OR process.customs_channel IS NULL AND coalesce(migration.try_source_text(post_values.raw_values->>'AH', 80), CASE WHEN post_values.conflicted_columns ? 'AH' THEN NULL ELSE migration.try_source_text(pre.raw_values->>'AR', 80) END) IS NOT NULL
       OR process.clearance_date IS NULL AND coalesce(migration.try_source_date(post_values.raw_values->>'AI'), CASE WHEN post_values.conflicted_columns ? 'AI' THEN NULL ELSE migration.try_source_date(pre.raw_values->>'AS') END) IS NOT NULL
       OR process.nf_request_date IS NULL AND coalesce(migration.try_source_date(post_values.raw_values->>'AJ'), CASE WHEN post_values.conflicted_columns ? 'AJ' THEN NULL ELSE migration.try_source_date(pre.raw_values->>'AU') END) IS NOT NULL
       OR process.delivery_date IS NULL AND coalesce(migration.try_source_date(post_values.raw_values->>'AN'), CASE WHEN post_values.conflicted_columns ? 'AN' THEN NULL ELSE migration.try_source_date(pre.raw_values->>'AX') END) IS NOT NULL
       OR process.freight_currency IS NULL AND process.freight_cost IS NULL
          AND migration.try_source_currency(post_values.raw_values->>'V') IS NOT NULL
          AND migration.try_source_numeric(post_values.raw_values->>'W') >= 0
       OR process.container_number IS NULL AND migration.try_source_text(post_values.raw_values->>'X', 120) IS NOT NULL
       OR process.container_type IS NULL AND migration.try_source_text(post_values.raw_values->>'Y', 80) IS NOT NULL
       OR process.container_quantity IS NULL AND migration.try_source_integer(post_values.raw_values->>'Z') >= 0
       OR process.forwarder IS NULL AND migration.try_source_text(post_values.raw_values->>'AA', 160) IS NOT NULL
       OR process.documents_ok IS NULL AND migration.try_source_boolean(post_values.raw_values->>'AB') IS NOT NULL
       OR process.storage_due_override IS NULL AND migration.try_source_date(post_values.raw_values->>'AD') IS NOT NULL
       OR process.taxes_paid_brl IS NULL AND migration.try_source_numeric(post_values.raw_values->>'AE') >= 0
       OR process.fine_brl IS NULL AND migration.try_source_numeric(post_values.raw_values->>'AP') >= 0
       OR process.storage_brl IS NULL AND migration.try_source_numeric(post_values.raw_values->>'AQ') >= 0
       OR process.demurrage_brl IS NULL AND migration.try_source_numeric(post_values.raw_values->>'AR') >= 0
       OR process.demurrage_container_quantity IS NULL AND migration.try_source_integer(post_values.raw_values->>'AS') >= 0)
   RETURNING process.id, coalesce(post.source_row_id, pre_source.source_row_id) AS source_row_id,
     coalesce(post.batch_id, pre_source.batch_id) AS batch_id,
     jsonb_strip_nulls(jsonb_build_object('priority', process.priority,
       'logisticsStatus', process.logistics_status, 'ipTotvsDate', process.ip_totvs_date,
       'transportMode', process.transport_mode, 'incoterm', process.incoterm,
       'broker', process.broker, 'portLoading', process.port_loading,
       'portDischarge', process.port_discharge, 'etd', process.etd,
       'etaConfirmed', process.eta_confirmed, 'eteConfirmed', process.ete_confirmed,
       'arrivalDate', process.arrival_date, 'duimpNumber', process.duimp_number,
       'duimpDate', process.duimp_date, 'customsChannel', process.customs_channel,
       'clearanceDate', process.clearance_date, 'nfRequestDate', process.nf_request_date,
       'deliveryDate', process.delivery_date, 'freightCurrency', process.freight_currency,
       'freightCost', process.freight_cost, 'containerNumber', process.container_number,
       'containerType', process.container_type, 'containerQuantity', process.container_quantity,
       'forwarder', process.forwarder, 'documentsOk', process.documents_ok,
       'storageDueOverride', process.storage_due_override, 'taxesPaidBrl', process.taxes_paid_brl,
       'fineBrl', process.fine_brl, 'storageBrl', process.storage_brl,
       'demurrageBrl', process.demurrage_brl,
       'demurrageContainerQuantity', process.demurrage_container_quantity)) AS values
), audited AS (
  INSERT INTO audit.audit_log
    (id, aggregate_type, aggregate_id, entity_type, entity_id, operation, field_name,
     old_value, new_value, actor_id, occurred_at, reason, correlation_id)
  SELECT gen_random_uuid(), 'IMPORT_PROCESS', updated.id, 'IMPORT_PROCESS', updated.id,
         'HISTORICAL_BACKFILL', NULL, NULL,
         jsonb_build_object('sourceRowId', updated.source_row_id, 'batchId', updated.batch_id,
                            'values', updated.values),
         'migration:M027', now(), 'Post/Pre Embarkation workbook values promoted to operational IP fields.',
         gen_random_uuid()
    FROM updated
  RETURNING aggregate_id
)
INSERT INTO m027_changed_process (id)
SELECT id FROM updated ON CONFLICT (id) DO NOTHING;

-- Preserve IP-level historical documents as active operational documents.
WITH candidates AS (
  SELECT md5(post.source_row_id::text || '|M027|INVOICE')::uuid AS id,
         post.process_id, 'INVOICE'::text AS kind,
         migration.try_source_text(post_values.raw_values->>'H', 120) AS number,
         NULL::date AS issue_date, NULL::date AS homologation_date,
         migration.try_source_numeric(post_values.raw_values->>'J') AS amount,
         migration.try_source_currency(post_values.raw_values->>'I') AS currency_code,
         post.batch_id, post.row_number
    FROM m027_post_values AS post_values
    JOIN m027_post_rows AS post ON post.process_id = post_values.process_id
  UNION ALL
  SELECT md5(post.source_row_id::text || '|M027|BL')::uuid,
         post.process_id, 'BL', migration.try_source_text(post_values.raw_values->>'P', 120),
         migration.try_source_date(post_values.raw_values->>'U'), NULL::date, NULL::numeric, NULL::char(3),
         post.batch_id, post.row_number
    FROM m027_post_values AS post_values
    JOIN m027_post_rows AS post ON post.process_id = post_values.process_id
  UNION ALL
  SELECT md5(post.source_row_id::text || '|M027|NF')::uuid,
         post.process_id, 'NF', migration.try_source_text(post_values.raw_values->>'AK', 120),
         migration.try_source_date(post_values.raw_values->>'AL'),
         migration.try_source_date(post_values.raw_values->>'AM'), NULL::numeric, NULL::char(3),
         post.batch_id, post.row_number
    FROM m027_post_values AS post_values
    JOIN m027_post_rows AS post ON post.process_id = post_values.process_id
), inserted AS (
  INSERT INTO imports.process_document
    (id, process_id, purchase_order_item_id, kind, number, issue_date, homologation_date,
     notes, status)
  SELECT candidate.id, candidate.process_id, NULL, candidate.kind, candidate.number,
         candidate.issue_date, candidate.homologation_date,
         CASE WHEN candidate.kind = 'INVOICE' THEN
           format('Historico da aba Pos Embarque; lote %s, linha %s; total %s %s.',
             candidate.batch_id, candidate.row_number,
             CASE WHEN candidate.amount >= 0 THEN candidate.amount::text ELSE 'nao informado' END,
             coalesce(candidate.currency_code::text, 'moeda nao informada'))
           ELSE format('Historico da aba Pos Embarque, lote %s, linha %s.',
             candidate.batch_id, candidate.row_number) END,
         'ACTIVE'
    FROM candidates AS candidate
   WHERE candidate.number IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM imports.process_document AS existing
       WHERE existing.process_id = candidate.process_id AND existing.kind = candidate.kind
         AND existing.status = 'ACTIVE' AND upper(btrim(existing.number)) = upper(candidate.number))
  ON CONFLICT (id) DO NOTHING
  RETURNING id, process_id, kind, number, issue_date, notes
), audited AS (
  INSERT INTO audit.audit_log
    (id, aggregate_type, aggregate_id, entity_type, entity_id, operation, field_name,
     old_value, new_value, actor_id, occurred_at, reason, correlation_id)
  SELECT gen_random_uuid(), 'IMPORT_PROCESS', inserted.process_id, 'PROCESS_DOCUMENT', inserted.id,
         'HISTORICAL_BACKFILL', NULL, NULL,
         jsonb_strip_nulls(jsonb_build_object('kind', inserted.kind, 'number', inserted.number,
           'issueDate', inserted.issue_date, 'notes', inserted.notes)),
         'migration:M027', now(), 'Historical Post Embarkation document promoted to operational IP document.',
         gen_random_uuid()
    FROM inserted
  RETURNING aggregate_id
)
INSERT INTO m027_changed_process (id)
SELECT DISTINCT process_id FROM inserted ON CONFLICT (id) DO NOTHING;

UPDATE procurement.purchase_order AS po
   SET version = version + 1, updated_at = now()
 WHERE po.id IN (SELECT id FROM m027_changed_po);

UPDATE imports.import_process AS process
   SET version = version + 1, updated_at = now()
 WHERE process.id IN (SELECT id FROM m027_changed_process);
