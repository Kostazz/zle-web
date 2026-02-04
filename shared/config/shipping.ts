// shared/config/shipping.ts
// Single source of truth: shipping methods + COD availability/fee + totals

export const SHIPPING_CURRENCY = "CZK";

export type ShippingMethodId = "osobni" | "zasilkovna" | "dpd";

export type ShippingMethod = {
  id: ShippingMethodId;
  label: string;
  priceCzk: number;

  // Cash on delivery (DOBÍRKA)
  codAvailable: boolean;
  codFeeCzk: number;
};

export const SHIPPING_METHODS: ShippingMethod[] = [
  {
    id: "osobni",
    label: "Osobní odběr",
    priceCzk: 0,
    codAvailable: false,
    codFeeCzk: 0,
  },
  {
    id: "zasilkovna",
    label: "Zásilkovna",
    priceCzk: 89,
    codAvailable: true,
    codFeeCzk: 39,
  },
  {
    id: "dpd",
    label: "DPD",
    priceCzk: 119,
    codAvailable: true,
    codFeeCzk: 49,
  },
];

export function getShippingMethod(id: ShippingMethodId) {
  return SHIPPING_METHODS.find((m) => m.id === id);
}

export function getShippingMeta(id: ShippingMethodId) {
  const method = getShippingMethod(id);
  if (!method) return null;

  return {
    shippingMethodId: method.id,
    shippingLabel: method.label,
    shippingCzk: method.priceCzk,
    codAvailable: method.codAvailable,
    codFeeCzk: method.codFeeCzk,
  };
}

export function calculateTotals(input: {
  subtotalCzk: number;
  shippingMethodId: ShippingMethodId;
  paymentMethod?: string | null;
}) {
  const meta = getShippingMeta(input.shippingMethodId);
  if (!meta) return { error: "unknown_shipping_method" as const };

  const wantsCod = (input.paymentMethod || "").toLowerCase() === "cod";
  const codCzk = wantsCod && meta.codAvailable ? meta.codFeeCzk : 0;

  const totalCzk = input.subtotalCzk + meta.shippingCzk + codCzk;

  return {
    currency: SHIPPING_CURRENCY,
    subtotalCzk: input.subtotalCzk,
    ...meta,
    codCzk,
    totalCzk,
  };
}
