-- Typed operational inputs. Calculated values are produced by the API on read.
ALTER TABLE procurement.purchase_order_item
  ADD COLUMN necessity_date date,
  ADD COLUMN priority varchar(20),
  ADD COLUMN demand varchar(160),
  ADD COLUMN requester varchar(160),
  ADD COLUMN sc_number varchar(80),
  ADD COLUMN sc_approval_date date,
  ADD COLUMN purpose varchar(160),
  ADD COLUMN cost_center varchar(80),
  ADD COLUMN draft_po varchar(80),
  ADD COLUMN po_approval_date date,
  ADD COLUMN po_sent_date date,
  ADD COLUMN category varchar(120),
  ADD COLUMN ncm varchar(16),
  ADD COLUMN remarks text,
  ADD COLUMN commercial_plan_received_date date,
  ADD COLUMN mrp_completed_date date,
  ADD COLUMN target_mrp_days integer,
  ADD COLUMN target_order_days integer,
  ADD COLUMN target_shipment_days integer,
  ADD COLUMN target_port_days integer,
  ADD COLUMN target_transit_days integer,
  ADD COLUMN target_customs_days integer,
  ADD COLUMN actual_factory_ship_date date,
  ADD COLUMN actual_port_departure_date date,
  ADD CONSTRAINT po_item_targets_nonnegative CHECK (
    target_mrp_days >= 0 AND target_order_days >= 0 AND
    target_shipment_days >= 0 AND target_port_days >= 0 AND
    target_transit_days >= 0 AND target_customs_days >= 0);

ALTER TABLE imports.import_process
  ADD COLUMN ip_totvs_date date,
  ADD COLUMN transport_mode varchar(40),
  ADD COLUMN incoterm varchar(20),
  ADD COLUMN broker varchar(160),
  ADD COLUMN port_loading varchar(160),
  ADD COLUMN port_discharge varchar(160),
  ADD COLUMN etd date,
  ADD COLUMN eta_confirmed date,
  ADD COLUMN arrival_date date,
  ADD COLUMN duimp_number varchar(100),
  ADD COLUMN duimp_date date,
  ADD COLUMN customs_channel varchar(80),
  ADD COLUMN clearance_date date,
  ADD COLUMN ete_confirmed date,
  ADD COLUMN nf_request_date date,
  ADD COLUMN delivery_date date,
  ADD COLUMN freight_currency char(3),
  ADD COLUMN freight_cost numeric(24,8),
  ADD COLUMN container_number varchar(120),
  ADD COLUMN container_type varchar(80),
  ADD COLUMN container_quantity integer,
  ADD COLUMN forwarder varchar(160),
  ADD COLUMN documents_ok boolean,
  ADD COLUMN storage_due_override date,
  ADD COLUMN taxes_paid_brl numeric(24,8),
  ADD COLUMN fine_brl numeric(24,8),
  ADD COLUMN storage_brl numeric(24,8),
  ADD COLUMN demurrage_brl numeric(24,8),
  ADD COLUMN demurrage_container_quantity integer,
  ADD CONSTRAINT ip_costs_nonnegative CHECK (
    freight_cost >= 0 AND container_quantity >= 0 AND taxes_paid_brl >= 0 AND
    fine_brl >= 0 AND storage_brl >= 0 AND demurrage_brl >= 0 AND
    demurrage_container_quantity >= 0),
  ADD CONSTRAINT ip_freight_currency_pair CHECK ((freight_currency IS NULL) = (freight_cost IS NULL));

-- An invoice line can point to a PO item; BL and NF remain individual IP records.
CREATE TABLE imports.process_document (
  id uuid PRIMARY KEY,
  process_id uuid NOT NULL REFERENCES imports.import_process(id) ON DELETE RESTRICT,
  purchase_order_item_id uuid REFERENCES procurement.purchase_order_item(id) ON DELETE RESTRICT,
  kind varchar(16) NOT NULL CHECK (kind IN ('INVOICE','BL','NF')),
  number varchar(120) NOT NULL CHECK (length(btrim(number)) > 0),
  issue_date date,
  homologation_date date,
  quantity numeric(24,8) CHECK (quantity > 0),
  unit_price numeric(24,8) CHECK (unit_price >= 0),
  currency_code char(3),
  notes text NOT NULL DEFAULT '',
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'INVOICE' OR (quantity IS NULL AND unit_price IS NULL AND currency_code IS NULL)),
  CHECK ((unit_price IS NULL) = (currency_code IS NULL)),
  CHECK (kind = 'NF' OR homologation_date IS NULL)
);
CREATE INDEX ix_process_document_process ON imports.process_document(process_id,kind,status);
CREATE INDEX ix_process_document_item ON imports.process_document(purchase_order_item_id,status);

CREATE FUNCTION imports.check_process_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item_importer text;
  process_importer text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.process_id <> OLD.process_id OR
      NEW.purchase_order_item_id IS DISTINCT FROM OLD.purchase_order_item_id OR
      NEW.kind <> OLD.kind OR OLD.status = 'CANCELLED') THEN
    RAISE EXCEPTION 'Document identity or cancelled document cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF NEW.purchase_order_item_id IS NOT NULL THEN
    SELECT po.importer INTO item_importer FROM procurement.purchase_order_item item
      JOIN procurement.purchase_order po ON po.id = item.purchase_order_id
      WHERE item.id = NEW.purchase_order_item_id;
    SELECT importer INTO process_importer FROM imports.import_process WHERE id = NEW.process_id;
    IF item_importer IS DISTINCT FROM process_importer OR NOT EXISTS (
      SELECT 1 FROM procurement.po_item_allocation a
       WHERE a.process_id = NEW.process_id AND a.purchase_order_item_id = NEW.purchase_order_item_id
         AND a.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'Document item must be actively allocated to the same IP' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER process_document_check BEFORE INSERT OR UPDATE ON imports.process_document
  FOR EACH ROW EXECUTE FUNCTION imports.check_process_document();

-- Keep an invoice's item/IP relationship valid when an allocation is cancelled.
CREATE FUNCTION imports.prevent_orphan_process_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'CANCELLED' AND OLD.status = 'ACTIVE' AND EXISTS (
    SELECT 1 FROM imports.process_document d WHERE d.process_id = NEW.process_id
      AND d.purchase_order_item_id = NEW.purchase_order_item_id AND d.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Cancel linked documents before cancelling the allocation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER allocation_document_check BEFORE UPDATE OF status ON procurement.po_item_allocation
  FOR EACH ROW EXECUTE FUNCTION imports.prevent_orphan_process_document();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT SELECT, INSERT, UPDATE ON imports.process_document TO import_erp_app;
  END IF;
END $$;
