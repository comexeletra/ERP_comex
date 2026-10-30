-- Fields of the historical Follow Up load (docs/PLANO_CARGA_HISTORICA_PLANILHA.md). Nothing is
-- updated here: the load fills them, and existing rows keep what they have.

-- Doc ok is the date the documents were checked. The old yes/no column stays only for rows saved
-- before this migration; the API and the forms no longer use it.
ALTER TABLE imports.import_process ADD COLUMN documents_ok_date date;

-- Optional PO fields. The analyst comes from the ANALYST list; the SI is free text.
ALTER TABLE procurement.purchase_order
  ADD COLUMN analyst varchar(160),
  ADD COLUMN si_number varchar(120),
  ADD CONSTRAINT purchase_order_analyst_not_blank
    CHECK (analyst IS NULL OR length(btrim(analyst)) > 0),
  ADD CONSTRAINT purchase_order_si_number_not_blank
    CHECK (si_number IS NULL OR length(btrim(si_number)) > 0);

ALTER TABLE catalog.operational_value
  DROP CONSTRAINT operational_value_entity_key_check,
  ADD CONSTRAINT operational_value_entity_key_check CHECK (entity_key IN (
    'IMPORTER', 'INCOTERM', 'TRANSPORT_MODE', 'PORT_LOADING', 'PORT_DISCHARGE', 'CURRENCY', 'CATEGORY',
    'PRODUCT_GROUP', 'GROUP', 'PURPOSE', 'DEMAND', 'DEMAND_TYPE', 'LOGISTICS_STATUS', 'CUSTOMS_CHANNEL',
    'CONTAINER_TYPE', 'PRIORITY', 'UNIT_OF_MEASURE', 'REQUESTER', 'COST_CENTER', 'BROKER', 'FORWARDER',
    'PRODUCT', 'NCM', 'ANALYST'));

-- Historical SCs may not name a requester yet: the data reaches the system gradually. New SCs
-- still require one in the API.
ALTER TABLE procurement.purchase_request ALTER COLUMN requester DROP NOT NULL;

-- A workbook line may hold a price without a usable currency. The price is real and must not be
-- lost, so imported items may keep it with the currency empty until someone fills it in.
ALTER TABLE procurement.purchase_order_item
  DROP CONSTRAINT purchase_order_item_check1,
  ADD CONSTRAINT purchase_order_item_price_currency CHECK (
    (unit_price IS NULL) = (currency_code IS NULL)
    OR (source_kind = 'IMPORTED_SOURCE_ITEM' AND currency_code IS NULL));

-- raw_values keeps the column keys every reader uses, so workbook versions with other layouts stay
-- readable. file_values keeps the cells exactly as the loaded file had them, under its own letters.
ALTER TABLE migration.source_row ADD COLUMN file_values jsonb;

COMMENT ON COLUMN imports.import_process.documents_ok_date IS 'Date the shipment documents were checked (Doc ok in the Follow Up workbook).';
COMMENT ON COLUMN procurement.purchase_order.analyst IS 'Import analyst of the PO, chosen from the ANALYST list.';
COMMENT ON COLUMN procurement.purchase_order.si_number IS 'SI of the PO, free text; several SIs are separated by commas.';
COMMENT ON COLUMN migration.source_row.file_values IS 'Cells as they were in the loaded file, under its own column letters; NULL on batches loaded before M075.';
