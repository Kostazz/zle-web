export const quoteTitles = [
  "SVĚT JE ZLE A MY TO VIDÍME",
  "FAKE LIDI VŠUDE KOLEM KAŽDEJ DEN",
  "SYSTÉM TĚ NEZASTAVÍ KDYŽ JEDEŠ DÁL",
  "CREW DRŽÍ LINII I V TOM BORDELU",
  "ULICE UČÍ VÍC NEŽ JAKÁKOLIV ŠKOLA",
  "REAL TALK ONLY ŽÁDNÝ BULLSHIT KOLEM",
  "ZLE NEBO VŮBEC TO JE JEDINÁ CESTA",
  "ŽÁDNÝ KOMPROMISY KDYŽ JDEŠ ZA SVÝM",
  "JEĎ SI TO PO SVÝM NEKOUKAT ZPÁTKY",
  "BETON JE TVŮJ DOMOV KDE VŠECHNO ZAČÍNÁ",
  "FLIP PŘES CHAOS A JEDEM DÁL VŽDYCKY",
  "PADÁŠ TAK VSTÁVEJ A JEDEM ZNOVA",
  "PRAHA NESPÍ A MY TAKY NE CREW",
  "GRIND NIKDY NEKONČÍ TO JE ZLE ŽIVOT",
  "EGO NECH DOMA CREW JDE NAD VŠECHNO",
  "STREET MOUDROST CO TĚ NAUČÍ VÍC",
  "ZLE LEVEL MAX KAŽDEJ DEN NAPLNO",
  "CREW NAD VŠECHNO TO JE ZÁKON ULICE",
  "SVOBODA NA DESCE JE JEDINÁ PRAVDA",
  "RAW A REAL ŽÁDNÁ FAKE PÓZA",
  "ŽÁDNÝ VÝMLUVY PROSTĚ ZVEDNI SE A JEĎ",
  "BORDEL V SYSTÉMU ALE MY JEDEME DÁL",
  "AUTENTICITA NAD FLEXEM TO JE ZLE CESTA",
  "SKATE JE ŽIVOT A ŽIVOT JE ZLE",
  "UNDERGROUND FOREVER TO NIKDO NEZASTAVÍ",
];

export const quoteMessages = [
  "Nečekej, až to spraví někdo jinej. Zvedni se a udělej si svůj kus svobody sám.",
  "Instagram není realita. Real je ten moment, kdy stojíš na desce a svět drží hubu.",
  "Systém tě chce za stolem, ty chceš na ulici. Rozhodnutí je na tobě.",
  "Každej pád tě učí víc než tisíc tutoriálů. Vstávej a jeď dál.",
  "Crew je rodina, kterou sis vybral. Drž ji a ona drží tebe.",
  "Žádný influencer ti neřekne pravdu. Tu najdeš jen na betonu pod nohama.",
  "Práce, nájem, účty – ale večer jedeme spot. A všechno je v pohodě.",
  "Flexování na sítích je pro lidi, co nikdy nic reálnýho nezažili.",
  "Tvůj styl, tvoje pravidla. Svět se přizpůsobí nebo půjde z cesty.",
  "Underground není místo, je to stav mysli. A ten nikdo nevezme.",
  "Když padáš, nikdo se neptá. Když vstaneš, všichni sledujou.",
  "Město je playground pro ty, co se nebojí. Najdi svůj spot.",
  "Žádnej shortcut k ničemu reálnýmu. Jen grind, crew a deska.",
  "Real rozpoznáš podle toho, že se neptá kolik máš followerů.",
  "Chaos je normální, to je život. Jeď skrz něj a neohlížej se.",
  "Korporát prodává sny za kredity. My jezdíme realitu zadarmo.",
  "Nikdo ti nedá svobodu jako dárek. Vezmi si ji sám na desce.",
  "Každej spot má svůj příběh. Napiš do něj ten svůj.",
  "ZLE není značka na tričku. Je to způsob jak žiješ každej den.",
  "Ulice učí víc než škola, to je prostě fakt. Real talk.",
  "Když tě město nezlomí, tak tě nic nezlomí. Jeď dál.",
  "Fake lidi mají fake problémy. My máme reálný spoty a reálnou crew.",
  "Skate není sport pro body. Je to útěk z matrixu a cesta ke svobodě.",
  "Drž linii, i když svět šílí. To je jediná cesta jak přežít.",
  "Tvoje deska je tvoje svoboda. Tu ti nikdo nevezme, to je zákon.",
];

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

export interface ZleQuoteData {
  title: string;
  message: string;
}

function seededRandom(seed: number, max: number, offset: number = 0): number {
  const x = Math.sin(seed + offset) * 10000;
  return Math.floor((x - Math.floor(x)) * max);
}

export function generateDailyLine(): ZleQuoteData {
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  
  const titleIndex = seededRandom(seed, quoteTitles.length, 1);
  const messageIndex = seededRandom(seed, quoteMessages.length, 2);
  
  return {
    title: quoteTitles[titleIndex],
    message: quoteMessages[messageIndex],
  };
}

export function generateDailyQuote(): string {
  const { title, message } = generateDailyLine();
  return `${title}\n${message}`;
}

export function getTodayQuote(): ZleQuoteData {
  const today = new Date().toDateString();
  const storageKey = "zleQuoteV2";
  const storedData = localStorage.getItem(storageKey);
  
  if (storedData) {
    try {
      const { date, quote } = JSON.parse(storedData);
      if (date === today && quote.title && quote.message) {
        return quote;
      }
    } catch {
    }
  }
  
  const newQuote = generateDailyLine();
  localStorage.setItem(storageKey, JSON.stringify({ date: today, quote: newQuote }));
  return newQuote;
}

export function getSimpleQuote(): string {
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  
  const type = seededRandom(seed, 3, 10);
  
  if (type === 0) {
    const opener = quoteOpeners[seededRandom(seed, quoteOpeners.length, 11)];
    const core = quoteCore[seededRandom(seed, quoteCore.length, 12)];
    return `${opener} ${core}.`;
  } else if (type === 1) {
    return quoteLevels[seededRandom(seed, quoteLevels.length, 13)];
  } else {
    const word1 = vibeWords[seededRandom(seed, vibeWords.length, 14)];
    const word2 = vibeWords[seededRandom(seed, vibeWords.length, 15)];
    const core = quoteCore[seededRandom(seed, quoteCore.length, 16)];
    return `ZLE je ${word1} a ${word2}. ${core.charAt(0).toUpperCase() + core.slice(1)}.`;
  }
}
