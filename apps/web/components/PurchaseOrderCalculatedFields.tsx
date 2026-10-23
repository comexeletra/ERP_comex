"use client";

import type { Messages } from "../lib/i18n/pt-BR";
import { useI18n } from "./I18nProvider";

export function calculatedTotal(quantity: string, price: string, m: Messages): string {
  const normalizedQuantity = quantity.trim().replace(",", ".");
  const normalizedPrice = price.trim().replace(",", ".");
  if (!normalizedQuantity || !normalizedPrice) return m.poCalculated.waitingQuantityPrice;
  const total = Number(normalizedQuantity) * Number(normalizedPrice);
  return Number.isFinite(total)
    ? new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(total)
    : m.poCalculated.waitingValidValues;
}

export default function PurchaseOrderCalculatedFields({ quantity, unitPrice, currency }:
  { quantity: string; unitPrice: string; currency: string }) {
  const { m } = useI18n();
  const t = m.poCalculated;
  const total = calculatedTotal(quantity, unitPrice, m);
  return <section className="po-calculated-fields" aria-label={t.title}>
    <h5>{t.title}</h5>
    <dl className="followup-grid">
      <div><dt>{t.shipmentAlert}</dt><dd>{t.waitingIp}</dd></div>
      <div><dt>{t.shipmentStatus}</dt><dd>{t.fromIpFollowup}</dd></div>
      <div><dt>{t.totalValue}</dt><dd>{total}{currency && total.includes(",") ? ` ${currency}` : ""}</dd></div>
      <div><dt>{t.transitTime}</dt><dd>{t.transitHelp}</dd></div>
      <div><dt>{t.totalLeadTime}</dt><dd>{t.totalHelp}</dd></div>
      <div><dt>{t.ruptureRisk}</dt><dd>{t.ruptureHelp}</dd></div>
    </dl>
  </section>;
}
