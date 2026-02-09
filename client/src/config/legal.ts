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
  "ZLE",
  "VITE_LEGAL_OPERATOR_NAME"
);
const operatorAddress = getValue(
  import.meta.env.VITE_LEGAL_OPERATOR_ADDRESS,
  "Adresa není uvedena",
  "VITE_LEGAL_OPERATOR_ADDRESS"
);
const contactEmail = getValue(
  import.meta.env.VITE_LEGAL_CONTACT_EMAIL,
  "kontakt@zle.cz",
  "VITE_LEGAL_CONTACT_EMAIL"
);
const lastUpdated = getValue(
  import.meta.env.VITE_LEGAL_LAST_UPDATED,
  "neuvedeno",
  "VITE_LEGAL_LAST_UPDATED"
);

export const legalConfig = {
  operatorName,
  operatorAddress,
  contactEmail,
  lastUpdated,
  siteUrl: import.meta.env.VITE_PUBLIC_SITE_URL?.trim() || "",
  warning:
    import.meta.env.DEV && missingFields.length > 0
      ? `Chybí právní údaje v .env (${missingFields.join(", ")}). Zobrazuji bezpečné výchozí hodnoty.`
      : "",
};
