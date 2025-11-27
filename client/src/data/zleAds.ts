export const zleAds = [
  "ZLE® – real street, real shit.",
  "Od crew pro crew.",
  "ZLE je víc než logo. Je to vibe.",
  "Nenosíme to. Žijeme to.",
  "ZLE – made in street, not in boardroom.",
  "Ulice tě nenaučí lhát. Naučí tě jezdit.",
  "Tričko, co má víc příběhů než tvůj Instagram.",
  "ZLE = když jedeš po svým a svět drží krok.",
  "Crew drží, účet ne. Pojď pro merch.",
  "Chceš jezdit ZLE? Začni tričkem.",
  "Praha, beton, crew. ZLE.",
  "Každý spot je šance. Každý pád je lekce.",
  "ZLE není styl. ZLE je postoj.",
  "Když to není ZLE, není to nic.",
  "Street tested. Crew approved.",
  "Jet ZLE nebo vůbec.",
  "Underground není místo. Je to mindset.",
  "ZLE – od ulic, pro ulice.",
  "Tvůj první flip si pamatuješ. My taky.",
  "ZLE merch – nosí se s příběhem.",
] as const;

export type ZleAd = (typeof zleAds)[number];

export function getRandomAd(): string {
  return zleAds[Math.floor(Math.random() * zleAds.length)];
}

export function getAdByIndex(index: number): string {
  return zleAds[index % zleAds.length];
}
