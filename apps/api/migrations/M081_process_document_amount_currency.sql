-- The currency of an IP document belongs to its amounts (docs/PLANO_INVOICE_AUDITORIA_GRAVACAO.md). M019 paired the
-- currency only with the unit price, and M020 added the amount without changing that pairing, so an invoice with
-- its total and currency but no unit price was refused: the invoice load saves the total in CNY (prices are per
-- line) and answered HTTP 409 on HML. A unit price still needs its currency; a currency now needs a unit price or
-- an amount. Amounts without currency (the invoices of the historical load) stay valid, and no row is changed.
ALTER TABLE imports.process_document
  DROP CONSTRAINT process_document_check1,
  ADD CONSTRAINT process_document_currency
    CHECK ((unit_price IS NULL OR currency_code IS NOT NULL)
      AND (currency_code IS NULL OR unit_price IS NOT NULL OR amount IS NOT NULL));
