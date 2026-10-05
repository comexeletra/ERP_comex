-- A purchase order item may be split across IPs with different sailing dates.
-- Keep the actual departure date on the shipment operation, beside its ETD/ETA.
ALTER TABLE imports.import_process
    ADD COLUMN actual_port_departure_date date;

