export type SchemaNode = Record<string, unknown>;

const SHIPPING_DESTINATION_COUNTRY = "CZ";
const SHIPPING_CURRENCY = "CZK";

function createShippingDetails(methodName: string, transitMinDays: number, transitMaxDays: number): SchemaNode {
  return {
    "@type": "OfferShippingDetails",
    shippingLabel: methodName,
    shippingRate: {
      "@type": "MonetaryAmount",
      value: "0",
      currency: SHIPPING_CURRENCY,
    },
    shippingDestination: {
      "@type": "DefinedRegion",
      addressCountry: SHIPPING_DESTINATION_COUNTRY,
    },
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      handlingTime: {
        "@type": "QuantitativeValue",
        minValue: 0,
        maxValue: 1,
        unitCode: "DAY",
      },
      transitTime: {
        "@type": "QuantitativeValue",
        minValue: transitMinDays,
        maxValue: transitMaxDays,
        unitCode: "DAY",
      },
    },
  };
}

export function buildOfferShippingDetails(): SchemaNode[] {
  return [
    createShippingDetails("GLS", 1, 3),
    createShippingDetails("In-store pickup", 0, 1),
  ];
}

export function buildMerchantReturnPolicy(): SchemaNode {
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: SHIPPING_DESTINATION_COUNTRY,
    returnPolicyCountry: SHIPPING_DESTINATION_COUNTRY,
    returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: 14,
    returnMethod: ["https://schema.org/ReturnByMail", "https://schema.org/ReturnInStore"],
    returnFees: "https://schema.org/ReturnShippingFees",
    description: "Returns accepted within 14 days. Customer pays return shipping.",
  };
}

function normalizeTypes(typeValue: unknown): string[] {
  if (typeof typeValue === "string") return [typeValue];
  if (Array.isArray(typeValue)) return typeValue.filter((item): item is string => typeof item === "string");
  return [];
}

function isOfferType(typeValue: unknown): boolean {
  const types = normalizeTypes(typeValue);
  return types.includes("Offer") || types.includes("AggregateOffer");
}

export function attachOfferPolicySchema<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => attachOfferPolicySchema(item)) as T;
  }

  if (!input || typeof input !== "object") {
    return input;
  }

  const node = input as SchemaNode;
  const output: SchemaNode = {};

  for (const [key, value] of Object.entries(node)) {
    output[key] = attachOfferPolicySchema(value);
  }

  if (isOfferType(node["@type"])) {
    output.shippingDetails = output.shippingDetails ?? buildOfferShippingDetails();
    output.hasMerchantReturnPolicy = output.hasMerchantReturnPolicy ?? buildMerchantReturnPolicy();
  }

  return output as T;
}
