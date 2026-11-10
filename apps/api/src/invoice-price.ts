// The unit price of an invoice line against the price of its PO item (docs/PLANO_INVOICE_TOLERANCIA_PRECO.md).
// The area takes 20% as the tolerance; every difference still waits for the analyst's acceptance, and the
// percent goes to the audit. The review screen mirror is invoicePriceDifference in
// apps/web/lib/china-invoice-mapping.ts, kept equal by test/invoice-price.test.mjs.
export const invoicePriceTolerancePercent = 20;

const scale = 1_000_000_000_000_000_000n;
/** Up to 0.00000001 it is the same price (in units of 10^-18). */
const samePrice = 10_000_000_000n;

function priceUnits(value: string): bigint {
  const [whole, fraction = ""] = value.trim().replace(",", ".").split(".");
  return BigInt(whole) * scale + BigInt(fraction.slice(0, 18).padEnd(18, "0"));
}

/** A value kept in ten-thousandths, written as a plain decimal ("-16.0948", "20"). */
function tenThousandths(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % 10_000n).toString().padStart(4, "0").replace(/0+$/u, "");
  return `${sign}${absolute / 10_000n}${fraction ? `.${fraction}` : ""}`;
}

/**
 * The change of the invoice price over the PO price in percent (4 decimals, truncated; null when the PO price
 * is 0) and whether it is within the tolerance (inclusive), in exact decimals. Null when the prices are the same.
 */
export function invoicePriceDifference(invoicePrice: string, poPrice: string):
  { percent: string | null; withinTolerance: boolean } | null {
  const invoice = priceUnits(invoicePrice), po = priceUnits(poPrice);
  const gap = invoice - po;
  const absolute = gap < 0n ? -gap : gap;
  if (absolute <= samePrice) return null;
  if (po === 0n) return { percent: null, withinTolerance: false };
  return { percent: tenThousandths(gap * 1_000_000n / po),
    withinTolerance: absolute * 100n <= BigInt(invoicePriceTolerancePercent) * po };
}
