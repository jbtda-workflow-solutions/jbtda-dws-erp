/**
 * GST (Goods and Services Tax) calculation utilities.
 *
 * All values are in integer cents. No floating-point arithmetic is used.
 * Rounding uses Math.round() (half-up) on intermediate results.
 *
 * Australian GST rate: 10%
 *
 * Tax-Exclusive:  GST = round(subtotal * 0.10)
 * Tax-Inclusive:  GST = round(gross - gross / 1.10)
 * GST-Free:       GST = 0
 */

export type TaxTreatment = 'TAX_EXCLUSIVE' | 'TAX_INCLUSIVE' | 'GST_FREE';

export interface GSTResult {
  /** Amount excluding GST, in cents. */
  subtotalCents: bigint;
  /** GST component, in cents. */
  gstCents: bigint;
  /** Total (subtotal + GST), in cents. */
  totalCents: bigint;
}

/**
 * Calculate GST given an input amount and its tax treatment.
 *
 * @param inputCents - The line-item amount as entered (cents).
 *   - TAX_EXCLUSIVE: this IS the subtotal (excl. GST).
 *   - TAX_INCLUSIVE: this IS the gross total (incl. GST).
 *   - GST_FREE:      this IS the subtotal (no GST).
 */
export function calculateGST(
  inputCents: bigint,
  treatment: TaxTreatment,
): GSTResult {
  switch (treatment) {
    case 'TAX_EXCLUSIVE': {
      // Input is the subtotal excluding GST.
      const subtotalCents = inputCents;
      // GST = round(subtotal * 10 / 100) — use integer arithmetic throughout.
      const gstCents = BigInt(Math.round(Number(subtotalCents) * 0.1));
      const totalCents = subtotalCents + gstCents;
      return { subtotalCents, gstCents, totalCents };
    }

    case 'TAX_INCLUSIVE': {
      // Input is the gross total including GST.
      const totalCents = inputCents;
      // GST = round(gross - gross / 1.10)
      const gstCents = BigInt(Math.round(Number(totalCents) - Number(totalCents) / 1.1));
      const subtotalCents = totalCents - gstCents;
      return { subtotalCents, gstCents, totalCents };
    }

    case 'GST_FREE': {
      return {
        subtotalCents: inputCents,
        gstCents: 0n,
        totalCents: inputCents,
      };
    }
  }
}

/**
 * Sum an array of GSTResult objects into aggregate totals.
 */
export function sumGSTResults(results: GSTResult[]): GSTResult {
  return results.reduce(
    (acc, r) => ({
      subtotalCents: acc.subtotalCents + r.subtotalCents,
      gstCents: acc.gstCents + r.gstCents,
      totalCents: acc.totalCents + r.totalCents,
    }),
    { subtotalCents: 0n, gstCents: 0n, totalCents: 0n },
  );
}

