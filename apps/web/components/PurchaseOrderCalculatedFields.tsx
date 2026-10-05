"use client";

function calculatedTotal(quantity: string, price: string): string {
  const normalizedQuantity = quantity.trim().replace(",", ".");
  const normalizedPrice = price.trim().replace(",", ".");
  if (!normalizedQuantity || !normalizedPrice) return "Aguardando quantidade e preço";
  const total = Number(normalizedQuantity) * Number(normalizedPrice);
  return Number.isFinite(total)
    ? new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(total)
    : "Aguardando valores válidos";
}

export default function PurchaseOrderCalculatedFields({ quantity, unitPrice, currency }:
  { quantity: string; unitPrice: string; currency: string }) {
  const total = calculatedTotal(quantity, unitPrice);
  return <section className="po-calculated-fields" aria-label="Campos calculados automaticamente">
    <h5>Campos calculados automaticamente</h5>
    <dl className="followup-grid">
      <div><dt>Alerta (planilha · coluna D)</dt><dd>Aguardando dados do IP e do embarque</dd></div>
      <div><dt>Status (planilha · coluna E)</dt><dd>Consultado no acompanhamento do IP</dd></div>
      <div><dt>Total Price (planilha · coluna Y)</dt><dd>{total}{currency && total.includes(",") ? ` ${currency}` : ""}</dd></div>
      <div><dt>Transit Time (planilha · coluna AK)</dt><dd>Calculado com ETD e ETA do IP</dd></div>
      <div><dt>LT Total (planilha · coluna AY)</dt><dd>Calculado com envio da PO e entrega do IP</dd></div>
      <div><dt>Rupture Risk (planilha · coluna AZ)</dt><dd>Calculado com necessidade e ETA/ETE do IP</dd></div>
    </dl>
  </section>;
}
