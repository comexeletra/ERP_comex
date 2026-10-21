CREATE TABLE catalog.product_price_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES catalog.entry(id) ON DELETE RESTRICT,
  currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  unit_price numeric(24,8) NOT NULL CHECK (unit_price > 0),
  purchase_order_item_id uuid NOT NULL REFERENCES procurement.purchase_order_item(id) ON DELETE RESTRICT,
  purchase_order_id uuid NOT NULL REFERENCES procurement.purchase_order(id) ON DELETE RESTRICT,
  purchase_order_number varchar(80) NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  actor_id text
);
CREATE INDEX ix_product_price_observation_latest
  ON catalog.product_price_observation (product_id, currency_code, observed_at DESC, id DESC);
CREATE INDEX ix_product_price_observation_item
  ON catalog.product_price_observation (purchase_order_item_id, observed_at DESC, id DESC);

CREATE TABLE catalog.product_totvs_description_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES catalog.entry(id) ON DELETE RESTRICT,
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  purchase_order_item_id uuid NOT NULL REFERENCES procurement.purchase_order_item(id) ON DELETE RESTRICT,
  purchase_order_id uuid NOT NULL REFERENCES procurement.purchase_order(id) ON DELETE RESTRICT,
  purchase_order_number varchar(80) NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  actor_id text
);
CREATE INDEX ix_product_totvs_description_latest
  ON catalog.product_totvs_description_observation (product_id, observed_at DESC, id DESC);

CREATE VIEW catalog.product_price_reference AS
  SELECT DISTINCT ON (product_id, currency_code)
    product_id, currency_code, unit_price, purchase_order_item_id, purchase_order_id,
    purchase_order_number, observed_at, actor_id
  FROM catalog.product_price_observation
  ORDER BY product_id, currency_code, observed_at DESC, id DESC;

CREATE VIEW catalog.product_totvs_description_reference AS
  SELECT DISTINCT ON (product_id)
    product_id, description, purchase_order_item_id, purchase_order_id,
    purchase_order_number, observed_at, actor_id
  FROM catalog.product_totvs_description_observation
  ORDER BY product_id, observed_at DESC, id DESC;

CREATE FUNCTION catalog.capture_product_po_observation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  product_id uuid;
  purchase_order_number varchar(80);
  actor text := nullif(current_setting('app.actor_id', true), '');
  capture_price boolean := TG_OP = 'INSERT';
  capture_description boolean := TG_OP = 'INSERT';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    capture_price := NEW.product_code IS DISTINCT FROM OLD.product_code
      OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
      OR NEW.currency_code IS DISTINCT FROM OLD.currency_code;
    capture_description := NEW.product_code IS DISTINCT FROM OLD.product_code
      OR NEW.description IS DISTINCT FROM OLD.description;
  END IF;

  IF NOT capture_price AND NOT capture_description THEN
    RETURN NEW;
  END IF;

  SELECT entry.id INTO product_id
    FROM catalog.entry AS entry
    WHERE entry.kind = 'PRODUCT' AND entry.importer IS NULL
      AND entry.normalized_code = upper(btrim(NEW.product_code))
    LIMIT 1;
  IF product_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT po.external_number INTO purchase_order_number
    FROM procurement.purchase_order AS po WHERE po.id = NEW.purchase_order_id;
  IF purchase_order_number IS NULL THEN
    RETURN NEW;
  END IF;

  IF capture_price AND NEW.unit_price IS NOT NULL AND NEW.unit_price > 0
      AND NEW.currency_code IS NOT NULL THEN
    INSERT INTO catalog.product_price_observation
      (product_id, currency_code, unit_price, purchase_order_item_id, purchase_order_id,
       purchase_order_number, observed_at, actor_id)
    VALUES
      (product_id, NEW.currency_code, NEW.unit_price, NEW.id, NEW.purchase_order_id,
       purchase_order_number, now(), actor);
  END IF;

  IF capture_description AND nullif(btrim(NEW.description), '') IS NOT NULL THEN
    INSERT INTO catalog.product_totvs_description_observation
      (product_id, description, purchase_order_item_id, purchase_order_id,
       purchase_order_number, observed_at, actor_id)
    VALUES
      (product_id, NEW.description, NEW.id, NEW.purchase_order_id,
       purchase_order_number, now(), actor);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER purchase_order_item_product_observations
  AFTER INSERT OR UPDATE OF product_code, description, unit_price, currency_code
  ON procurement.purchase_order_item FOR EACH ROW
  EXECUTE FUNCTION catalog.capture_product_po_observation();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT USAGE ON SCHEMA catalog TO import_erp_app;
    GRANT SELECT, INSERT ON catalog.product_price_observation,
      catalog.product_totvs_description_observation TO import_erp_app;
    GRANT SELECT ON catalog.product_price_reference,
      catalog.product_totvs_description_reference TO import_erp_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_hml_app') THEN
    GRANT USAGE ON SCHEMA catalog TO import_erp_hml_app;
    GRANT SELECT, INSERT ON catalog.product_price_observation,
      catalog.product_totvs_description_observation TO import_erp_hml_app;
    GRANT SELECT ON catalog.product_price_reference,
      catalog.product_totvs_description_reference TO import_erp_hml_app;
  END IF;
END $$;
