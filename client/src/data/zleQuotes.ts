export const quoteOpeners = [
  "Dneska je ZLE",
  "ZLE znamená",
  "ZLE level:",
  "ZLE den je",
  "Tohle je ZLE:",
  "ZLE vibe:",
  "Crew říká:",
  "Dneska jeď",
  "Real talk:",
  "Street moudrost:",
  "ZLE filosofie:",
  "Dnešní mise:",
];

export const quoteCore = [
  "šlápnout na realitu a jet dál",
  "přežít rail i šéfa",
  "když ti flip uteče, ale vibe zůstane",
  "nezastavit se, i když tě život grindne",
  "jet po svým a nechat svět ať drží krok",
  "když deska mluví víc než slova",
  "držet crew a posílat to dál",
  "když ulice učí víc než škola",
  "jet tvrdě, ale fair",
  "když každý spot je výzva",
  "nechat ego doma a jet s crew",
  "když padáš, vstáváš silnější",
  "držet linii i v chaosu",
  "jet ZLE nebo vůbec",
  "když tě město nezlomí",
  "být real uprostřed fake světa",
];

export const quoteLevels = [
  "level 1: probudit se a jít ven",
  "level 2: najít spot a jet",
  "level 3: přežít práci a pak skate",
  "level 4: naučit se něco nového",
  "level 5: pomoct kámošovi s trikem",
  "level 6: jet v dešti, protože proč ne",
  "level 7: přežít rail i šéfa",
  "level 8: rozjet nový spot",
  "level 9: crew jedeme spolu",
  "level MAX: žít to ZLE naplno",
];

export const vibeWords = [
  "crew",
  "street",
  "skate",
  "grind",
  "flip",
  "rail",
  "spot",
  "vibe",
  "real",
  "raw",
  "underground",
  "Praha",
  "deska",
  "ulice",
  "město",
  "beton",
  "asphalt",
  "midnight",
  "session",
  "drop",
  "push",
  "ride",
  "flow",
  "style",
  "moment",
  "energie",
  "pohyb",
  "svoboda",
  "chaos",
  "klid",
  "focus",
  "drive",
  "hustle",
  "respect",
  "trust",
];

export const quoteEndings = [
  "💀",
  "⚡",
  "🔥",
  "",
  "",
  "",
];

export function generateDailyQuote(): string {
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  
  const seededRandom = (max: number, offset: number = 0): number => {
    const x = Math.sin(seed + offset) * 10000;
    return Math.floor((x - Math.floor(x)) * max);
  };
  
  const type = seededRandom(3);
  
  if (type === 0) {
    const opener = quoteOpeners[seededRandom(quoteOpeners.length, 1)];
    const core = quoteCore[seededRandom(quoteCore.length, 2)];
    return `${opener} ${core}.`;
  } else if (type === 1) {
    return quoteLevels[seededRandom(quoteLevels.length, 3)];
  } else {
    const word1 = vibeWords[seededRandom(vibeWords.length, 4)];
    const word2 = vibeWords[seededRandom(vibeWords.length, 5)];
    const core = quoteCore[seededRandom(quoteCore.length, 6)];
    return `ZLE je ${word1} a ${word2}. ${core.charAt(0).toUpperCase() + core.slice(1)}.`;
  }
}

export function getTodayQuote(): string {
  const today = new Date().toDateString();
  const storageKey = "zleQuote";
  const storedData = localStorage.getItem(storageKey);
  
  if (storedData) {
    try {
      const { date, quote } = JSON.parse(storedData);
      if (date === today) {
        return quote;
      }
    } catch {
    }
  }
  
  const newQuote = generateDailyQuote();
  localStorage.setItem(storageKey, JSON.stringify({ date: today, quote: newQuote }));
  return newQuote;
}
