// shared/config/shipping.ts

import type { PaymentMethod } from "../schema";

export type ShippingMethodId = "gls" | "pickup";

export interface ShippingMethod {
  id: ShippingMethodId;
  label: string;
  priceCzk: number;

  codAvailable: boolean;
  codFeeCzk?: number;

  codUnavailableReason?: string;

  allowedPaymentMethods: PaymentMethod[];
  disallowedPaymentReasons: Partial<Record<PaymentMethod, string>>;
}

export const SHIPPING_METHODS: Record<ShippingMethodId, ShippingMethod> = {
  gls: {
    id: "gls",
    label: "GLS – doručení na adresu",
    priceCzk: 129,
    codAvailable: true,
    codFeeCzk: 39,
    allowedPaymentMethods: [
      "card",
      "bank",
      "cod",
      "gpay",
      "applepay",
      "usdc",
      "btc",
      "eth",
      "sol",
      "pi",
    ],
    disallowedPaymentReasons: {
      in_person: "Platba na místě je jen při osobním odběru.",
    },
  },

  pickup: {
    id: "pickup",
    label: "Osobní odběr",
    priceCzk: 0,
    codAvailable: false,
    codUnavailableReason:
      "Dobírka není u osobního odběru dostupná. Zaplať online a vyzvedni bez čekání.",
    allowedPaymentMethods: [
      "card",
      "bank",
      "gpay",
      "applepay",
      "usdc",
      "btc",
      "eth",
      "sol",
      "pi",
      "in_person",
    ],
    disallowedPaymentReasons: {
      cod: "Dobírka je jen pro doručení kurýrem.",
    },
  },
};

export function getShippingOptionsForApi() {
  return Object.values(SHIPPING_METHODS).map((m) => ({
    id: m.id,
    label: m.label,
    priceCzk: m.priceCzk,
    codAvailable: m.codAvailable,
    codFeeCzk: m.codFeeCzk ?? 0,
    codUnavailableReason: m.codUnavailableReason ?? null,
    allowedPaymentMethods: m.allowedPaymentMethods,
    disallowedPaymentReasons: m.disallowedPaymentReasons,
  }));
}

export function calculateTotals({
  subtotalCzk,
  shippingId,
  paymentMethod,
}: {
  subtotalCzk: number;
  shippingId: ShippingMethodId;
  paymentMethod: "card" | "cod";
}) {
  const shipping = SHIPPING_METHODS[shippingId];

  if (!shipping) {
    throw new Error("invalid_shipping_method");
  }

  const codAvailable = shipping.codAvailable;
  let codFeeCzk = 0;

  if (paymentMethod === "cod") {
    if (shipping.codAvailable) {
      codFeeCzk = shipping.codFeeCzk ?? 0;
    }
  }

  const shippingCzk = shipping.priceCzk;
  const totalCzk = subtotalCzk + shippingCzk + codFeeCzk;

  return {
    shippingCzk,
    codFeeCzk,
    codAvailable,
    totalCzk,
  };
}
