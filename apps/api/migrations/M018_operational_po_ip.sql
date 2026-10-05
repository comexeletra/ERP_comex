-- Operational transcription is separate from immutable Excel observations.
ALTER TABLE procurement.purchase_order
    ADD COLUMN IF NOT EXISTS supplier_text varchar(240),
    ADD COLUMN IF NOT EXISTS order_date date,
    ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';

ALTER TABLE imports.import_process
    ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS priority varchar(20),
    ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS source_kind varchar(32) NOT NULL DEFAULT 'HISTORICAL_EXCEL';

CREATE TABLE procurement.purchase_order_item (
    id uuid PRIMARY KEY,
    purchase_order_id uuid NOT NULL REFERENCES procurement.purchase_order(id) ON DELETE RESTRICT,
    line_number integer NOT NULL CHECK (line_number > 0),
    external_line_reference varchar(80),
    product_code varchar(120) NOT NULL,
    description text NOT NULL,
    ordered_quantity numeric(24,8) NOT NULL CHECK (ordered_quantity > 0),
    unit varchar(32) NOT NULL,
    unit_price numeric(24,8) CHECK (unit_price >= 0),
    currency_code char(3),
    source_kind varchar(32) NOT NULL DEFAULT 'MANUAL_TOTVS_TRANSCRIPTION'
        CHECK (source_kind = 'MANUAL_TOTVS_TRANSCRIPTION'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (purchase_order_id, line_number),
    UNIQUE (purchase_order_id, external_line_reference),
    CHECK (length(btrim(product_code)) > 0 AND length(btrim(description)) > 0
        AND length(btrim(unit)) > 0),
    CHECK ((unit_price IS NULL) = (currency_code IS NULL))
);

CREATE TABLE procurement.po_item_allocation (
    id uuid PRIMARY KEY,
    purchase_order_item_id uuid NOT NULL REFERENCES procurement.purchase_order_item(id) ON DELETE RESTRICT,
    process_id uuid NOT NULL REFERENCES imports.import_process(id) ON DELETE RESTRICT,
    quantity numeric(24,8) NOT NULL CHECK (quantity > 0),
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
    notes text NOT NULL DEFAULT '',
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_active_po_item_process
    ON procurement.po_item_allocation (purchase_order_item_id, process_id)
    WHERE status = 'ACTIVE';
CREATE INDEX ix_po_item_allocation_process ON procurement.po_item_allocation (process_id, status);

CREATE TABLE procurement.operational_command_receipt (
    actor_user_id uuid NOT NULL REFERENCES identity.erp_user(id),
    idempotency_key varchar(128) NOT NULL,
    payload_sha256 char(64) NOT NULL,
    resource_type varchar(40) NOT NULL,
    resource_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_user_id, idempotency_key)
);

-- Serialize allocation and quantity changes on the item row. This prevents two
-- concurrent IP allocations from spending the same remaining quantity.
CREATE FUNCTION procurement.check_po_item_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    item_quantity numeric(24,8);
    po_importer varchar(120);
    ip_importer varchar(120);
    allocated numeric(24,8);
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.purchase_order_item_id <> OLD.purchase_order_item_id
        OR NEW.process_id <> OLD.process_id OR OLD.status = 'CANCELLED') THEN
        RAISE EXCEPTION 'Allocation identity or cancelled allocation cannot be changed' USING ERRCODE = '23514';
    END IF;
    SELECT item.ordered_quantity, po.importer INTO item_quantity, po_importer
      FROM procurement.purchase_order_item item
      JOIN procurement.purchase_order po ON po.id = item.purchase_order_id
      WHERE item.id = NEW.purchase_order_item_id FOR UPDATE OF item;
    SELECT importer INTO ip_importer FROM imports.import_process WHERE id = NEW.process_id;
    IF po_importer IS DISTINCT FROM ip_importer THEN
        RAISE EXCEPTION 'PO and IP must belong to the same importer' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'ACTIVE' THEN
        SELECT coalesce(sum(quantity), 0) INTO allocated
          FROM procurement.po_item_allocation
          WHERE purchase_order_item_id = NEW.purchase_order_item_id AND status = 'ACTIVE'
            AND id <> NEW.id;
        IF allocated + NEW.quantity > item_quantity THEN
            RAISE EXCEPTION 'Allocated quantity exceeds ordered quantity' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER po_item_allocation_check BEFORE INSERT OR UPDATE
    ON procurement.po_item_allocation FOR EACH ROW
    EXECUTE FUNCTION procurement.check_po_item_allocation();

CREATE FUNCTION procurement.check_po_item_quantity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    allocated numeric(24,8);
BEGIN
    SELECT coalesce(sum(quantity), 0) INTO allocated
      FROM procurement.po_item_allocation
      WHERE purchase_order_item_id = NEW.id AND status = 'ACTIVE';
    IF NEW.ordered_quantity < allocated THEN
        RAISE EXCEPTION 'Ordered quantity is below active allocations' USING ERRCODE = '23514';
    END IF;
    IF NEW.unit IS DISTINCT FROM OLD.unit AND allocated > 0 THEN
        RAISE EXCEPTION 'Unit cannot change while allocations are active' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER po_item_quantity_check BEFORE UPDATE OF ordered_quantity, unit
    ON procurement.purchase_order_item FOR EACH ROW
    EXECUTE FUNCTION procurement.check_po_item_quantity();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
        GRANT SELECT, INSERT, UPDATE ON procurement.purchase_order,
            imports.import_process TO import_erp_app;
        GRANT SELECT, INSERT, DELETE ON procurement.process_purchase_order TO import_erp_app;
        GRANT SELECT, INSERT, UPDATE ON procurement.purchase_order_item,
            procurement.po_item_allocation TO import_erp_app;
        GRANT SELECT, INSERT ON procurement.operational_command_receipt TO import_erp_app;
    END IF;
END;
$$;
