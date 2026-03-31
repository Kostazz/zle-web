const missingFields: string[] = [];

const getValue = (value: string | undefined, fallback: string, key: string) => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    missingFields.push(key);
    return fallback;
  }
  return trimmed;
};

const operatorName = getValue(
  import.meta.env.VITE_LEGAL_OPERATOR_NAME,
  "Konstantin Tunturov",
  "VITE_LEGAL_OPERATOR_NAME"
);
const operatorAddress = getValue(
  import.meta.env.VITE_LEGAL_OPERATOR_ADDRESS,
  "náměstí Plukovníka Vlčka 693/6, 198 00 Praha 9 – Černý Most",
  "VITE_LEGAL_OPERATOR_ADDRESS"
);
const companyId = getValue(
  import.meta.env.VITE_LEGAL_COMPANY_ID,
  "76583465",
  "VITE_LEGAL_COMPANY_ID"
);
const contactEmail = getValue(
  import.meta.env.VITE_LEGAL_CONTACT_EMAIL,
  "zleshop.admin@gmail.com",
  "VITE_LEGAL_CONTACT_EMAIL"
);
const lastUpdated = getValue(
  import.meta.env.VITE_LEGAL_LAST_UPDATED,
  "2025-01-01",
  "VITE_LEGAL_LAST_UPDATED"
);

export const legalConfig = {
  operatorName,
  operatorAddress,
  companyId,
  contactEmail,
  lastUpdated,
  siteUrl: import.meta.env.VITE_PUBLIC_SITE_URL?.trim() || "",
  warning:
    import.meta.env.DEV && missingFields.length > 0
      ? `Chybí právní údaje v .env (${missingFields.join(", ")}). Zobrazuji bezpečné výchozí hodnoty.`
      : "",
};
