CREATE TABLE procurement.purchase_request (
  id uuid PRIMARY KEY,
  importer varchar(120) NOT NULL,
  sc_number varchar(80) NOT NULL,
  normalized_sc_number varchar(80) NOT NULL,
  commercial_plan_received_date date NULL,
  requester varchar(160) NOT NULL,
  approval_date date NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (importer, normalized_sc_number),
  UNIQUE (id, importer)
);

CREATE INDEX ix_purchase_request_importer_number
  ON procurement.purchase_request (importer, normalized_sc_number);

ALTER TABLE procurement.purchase_order
  ADD COLUMN purchase_request_id uuid NULL,
  ADD CONSTRAINT fk_purchase_order_purchase_request_importer
    FOREIGN KEY (purchase_request_id, importer)
    REFERENCES procurement.purchase_request (id, importer)
    ON DELETE RESTRICT;

CREATE INDEX ix_purchase_order_purchase_request
  ON procurement.purchase_order (purchase_request_id)
  WHERE purchase_request_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT SELECT, INSERT ON procurement.purchase_request TO import_erp_app;
  END IF;
END $$;
