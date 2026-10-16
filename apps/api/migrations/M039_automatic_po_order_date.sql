ALTER TABLE procurement.purchase_order
  ALTER COLUMN order_date SET DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date);

UPDATE procurement.purchase_order
   SET order_date = (created_at AT TIME ZONE 'America/Sao_Paulo')::date
 WHERE source_kind = 'MANUAL_TOTVS_REFERENCE'
   AND order_date IS NULL;
