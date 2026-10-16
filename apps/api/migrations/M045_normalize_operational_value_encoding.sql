-- Repair operational selector values that were stored after UTF-8 was
-- mistakenly decoded as Windows-1252, including values decoded more than once.
-- Keep the repair limited to catalog values and record every change in audit.
CREATE OR REPLACE FUNCTION catalog.normalize_utf8_mojibake(input_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  current_value text := input_value;
  decoded_value text;
  marker_count integer;
  decoded_marker_count integer;
BEGIN
  FOR attempt IN 1..3 LOOP
    marker_count := length(current_value) - length(regexp_replace(current_value, '[ÃÂâð]', '', 'g'));
    EXIT WHEN marker_count = 0;

    BEGIN
      decoded_value := convert_from(convert_to(current_value, 'WIN1252'), 'UTF8');
    EXCEPTION WHEN OTHERS THEN
      EXIT;
    END;

    decoded_marker_count := length(decoded_value) - length(regexp_replace(decoded_value, '[ÃÂâð]', '', 'g'));
    EXIT WHEN decoded_value = current_value OR decoded_marker_count >= marker_count;
    current_value := decoded_value;
  END LOOP;

  RETURN current_value;
END;
$$;

DO $$
DECLARE
  entry record;
  repaired_value text;
  duplicate_id uuid;
  event_id uuid;
  audit_id uuid;
  before_value jsonb;
  after_value jsonb;
BEGIN
  FOR entry IN
    SELECT id, entity_key, code, value
      FROM catalog.operational_value
     ORDER BY entity_key, id
  LOOP
    repaired_value := catalog.normalize_utf8_mojibake(entry.value);
    IF repaired_value = entry.value THEN
      CONTINUE;
    END IF;

    before_value := jsonb_build_object(
      'entity', lower(entry.entity_key), 'code', entry.code, 'value', entry.value
    );

    SELECT id INTO duplicate_id
      FROM catalog.operational_value
     WHERE entity_key = entry.entity_key
       AND normalized_value = upper(btrim(repaired_value))
       AND id <> entry.id
     LIMIT 1;

    event_id := gen_random_uuid();
    audit_id := gen_random_uuid();

    IF duplicate_id IS NOT NULL THEN
      DELETE FROM catalog.operational_value WHERE id = entry.id;
      after_value := jsonb_build_object(
        'entity', lower(entry.entity_key), 'code', entry.code,
        'value', repaired_value, 'mergedInto', duplicate_id
      );

      INSERT INTO audit.audit_log
        (id, aggregate_type, aggregate_id, entity_type, entity_id, operation,
         field_name, old_value, new_value, actor_id, occurred_at, reason, correlation_id)
      VALUES
        (audit_id, 'OPERATIONAL_VALUE', entry.id, 'OPERATIONAL_VALUE', entry.id,
         'MERGE', 'value', before_value, after_value, 'system:migration:M045', now(),
         'Correção de texto UTF-8 armazenado com decodificação Windows-1252; valor duplicado consolidado.', event_id);

      INSERT INTO audit.outbox_message
        (event_id, event_type, aggregate_type, aggregate_id, payload, occurred_at)
      VALUES
        (event_id, 'catalog.operational_value.merged', 'OPERATIONAL_VALUE', entry.id,
         jsonb_build_object('id', entry.id, 'mergedInto', duplicate_id,
                            'entity', lower(entry.entity_key)), now());
    ELSE
      UPDATE catalog.operational_value SET value = repaired_value WHERE id = entry.id;
      after_value := jsonb_build_object(
        'entity', lower(entry.entity_key), 'code', entry.code, 'value', repaired_value
      );

      INSERT INTO audit.audit_log
        (id, aggregate_type, aggregate_id, entity_type, entity_id, operation,
         field_name, old_value, new_value, actor_id, occurred_at, reason, correlation_id)
      VALUES
        (audit_id, 'OPERATIONAL_VALUE', entry.id, 'OPERATIONAL_VALUE', entry.id,
         'UPDATE', 'value', before_value, after_value, 'system:migration:M045', now(),
         'Correção de texto UTF-8 armazenado com decodificação Windows-1252.', event_id);

      INSERT INTO audit.outbox_message
        (event_id, event_type, aggregate_type, aggregate_id, payload, occurred_at)
      VALUES
        (event_id, 'catalog.operational_value.updated', 'OPERATIONAL_VALUE', entry.id,
         jsonb_build_object('id', entry.id, 'entity', lower(entry.entity_key)), now());
    END IF;
  END LOOP;
END
$$;

DROP FUNCTION catalog.normalize_utf8_mojibake(text);
