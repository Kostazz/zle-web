import type { CodexLayerAxis, LayerFragment } from "./types";

export const CODEX_RULES: string[] = [
  "Jedna věta, která trefí nerv dne.",
  "Musí spojit konkrétní realitu a širší pravdu.",
  "Civilní čeština bez korporátní inspirace.",
  "Drsnost ano, tupost ne.",
  "Filozofie ano, pseudo-moudro ne.",
  "Každá věta musí mít vlastní rytmus.",
  "Opakování openingů i motivů má cooldown.",
  "Preferovat nečekané, ale srozumitelné kombinace.",
  "Crypto je symbol reality, ne market report.",
  "KryptoKámoš core: klid uprostřed chaosu, bez pózy a hysterie.",
];

export const FORBIDDEN_PHRASES = [
  "v dnešním světě",
  "připomíná nám to",
  "někdy je potřeba",
  "stačí jen",
  "věř si",
  "pozitivně",
  "manifestuj",
  "motivační",
  "to the moon",
  "wagmi",
  "gm",
  "alpha call",
];

export const REPEATED_THEME_COOLDOWN_DAYS = 4;
export const OPENING_COOLDOWN_DAYS = 3;

export const OPENINGS = [
  "ZLE je když",
  "Někdy je ZLE přesně ve chvíli, kdy",
  "Dnešek je ZLE, protože",
  "Nejvíc ZLE je, že",
  "Tohle je ZLE:",
  "Dneska je to čistý ZLE, když",
];

export const TEMPLATE_LIBRARY = [
  {
    id: "tension_then_paradox",
    rhythm: "A, ale B",
    minLayers: 3,
    render: (parts: string[]) => {
      const head = parts[0];
      const middle = parts.slice(1, -1).join(", ");
      const tail = parts[parts.length - 1];
      return middle ? `${head}, ale ${middle} a ${tail}.` : `${head}, ale ${tail}.`;
    },
  },
  {
    id: "stacked_reality",
    rhythm: "A, B, C",
    minLayers: 4,
    render: (parts: string[]) => {
      const intro = parts.slice(0, -1).join(", ");
      const tail = parts[parts.length - 1];
      return `${intro}, a stejně ${tail}.`;
    },
  },
  {
    id: "quiet_punch",
    rhythm: "A a B",
    minLayers: 3,
    render: (parts: string[]) => {
      const head = parts[0];
      const middle = parts.slice(1, -1).join(" a ");
      const tail = parts[parts.length - 1];
      return `${head} a ${middle}, takže ${tail}.`;
    },
  },
  {
    id: "cause_effect",
    rhythm: "Když A, tak B",
    minLayers: 3,
    render: (parts: string[]) => {
      const head = parts[0];
      const middle = parts.slice(1, -1).join(", ");
      const tail = parts[parts.length - 1];
      return middle ? `Když ${head}, ${middle}, takže ${tail}.` : `Když ${head}, takže ${tail}.`;
    },
  },
] as const;

function f(axis: CodexLayerAxis, motif: string, text: string, tags: string[]): LayerFragment {
  return { axis, motif, text, tags };
}

export const LAYER_LIBRARY: Record<CodexLayerAxis, LayerFragment[]> = {
  personal: [
    f("personal", "vnitřní_únava", "uvnitř jede tichá únava na plný otáčky", ["únava", "nitro"]),
    f("personal", "držený_klid", "držíš klid jen silou zvyku", ["klid", "sebekontrola"]),
    f("personal", "vnitřní_odpor", "hlava chce vypnout, ale tělo furt drží směnu", ["hlava", "práce"]),
    f("personal", "soukromý_vzdor", "učíš se dýchat i v režimu přežití", ["vzdor", "přežití"]),
  ],
  weather: [
    f("weather", "slunce_vs_únor", "venku svítí jak duben, uvnitř je pořád únor", ["slunce", "únor"]),
    f("weather", "mokré_město", "město je mokrý a lidi jedou na autopilota", ["déšť", "město"]),
    f("weather", "vítr_a_hluk", "vítr honí odpadky ulicí rychleji než zprávy", ["vítr", "hluk"]),
    f("weather", "ranní_tma", "ráno je tmavý jak večerní feed", ["tma", "ráno"]),
  ],
  system: [
    f("system", "drahota_klidu", "klid stojí víc než běžnej nákup", ["drahota", "ekonomika"]),
    f("system", "systémový_tlak", "systém tlačí výkon i tam, kde už není co mačkat", ["systém", "tlak"]),
    f("system", "účty_vs_energie", "účty rostou rychlejc než energie", ["účty", "energie"]),
    f("system", "práce_cena", "pracuješ víc, ale měsíc je pořád delší než výplata", ["práce", "výplata"]),
  ],
  world: [
    f("world", "trhy_nervy", "trhy lítají a nervy s nima", ["trhy", "nervy"]),
    f("world", "algoritmy_pozornost", "algoritmy žerou pozornost dřív než snídani", ["algoritmy", "pozornost"]),
    f("world", "krize_scroll", "krize se točí dokola rychlejc než palec na displeji", ["krize", "scroll"]),
    f("world", "globální_hluk", "svět křičí z každý obrazovky něco jinýho", ["svět", "hluk"]),
  ],
  existential: [
    f("existential", "adaptace_chaos", "nejdivnější je, jak rychle si člověk zvykne na chaos", ["chaos", "adaptace"]),
    f("existential", "paradox_klidu", "největší luxus je dneska obyčejnej klid", ["luxus", "klid"]),
    f("existential", "pravda_bez_filtru", "pravda bolí míň než její odklad", ["pravda", "odklad"]),
    f("existential", "smysl_navzdory", "smysl držíš spíš navzdory než díky podmínkám", ["smysl", "podmínky"]),
  ],
  irony: [
    f("irony", "smart_rada", "a někdo ti do toho poradí myslet pozitivně", ["ironie", "pozitivno"]),
    f("irony", "produktivita_maska", "a všichni tomu říkají produktivita", ["ironie", "produktivita"]),
    f("irony", "plán_vesmíru", "a začne to vypadat jak dobře organizovanej omyl", ["ironie", "omyl"]),
    f("irony", "ticho_status", "a ještě to musí vypadat, že máš všechno pod kontrolou", ["ironie", "kontrola"]),
  ],
  crypto: [
    f("crypto", "křehká_důvěra", "důvěra je křehká měna a kurz se mění rychlejc než nálada davu", ["důvěra", "volatilita"]),
    f("crypto", "gravitace_centra", "všechno se tváří decentralizovaně, ale gravitace síly táhne pořád k jednomu středu", ["dominance", "síla"]),
    f("crypto", "likvidita_klidu", "likvidita teče všude, jen klid má pořád nízký objem", ["likvidita", "klid"]),
    f("crypto", "spekulace_prázdno", "sen o rychlým růstu často jen maskuje starý prázdno", ["spekulace", "prázdno"]),
  ],
  technoHuman: [
    f("technoHuman", "ulice_algoritmus", "ulice učí instinkt, algoritmus učí reakci, a člověk mezi tím hlídá nerv", ["ulice", "algoritmus"]),
    f("technoHuman", "digitální_šum", "digitální šum je hlasitej, ale lidský ticho pořád rozhoduje", ["šum", "ticho"]),
    f("technoHuman", "analogová_únava", "budoucnost je digitální, únava pořád analogová", ["budoucnost", "únava"]),
    f("technoHuman", "signál_hluk", "nejtěžší není chytit signál, ale neztratit se v hluku", ["signál", "hluk"]),
  ],
  symbolicFuture: [
    f("symbolicFuture", "cena_vs_hodnota", "cena skáče po obrazovkách, ale hodnota se pozná až v tichu", ["cena", "hodnota"]),
    f("symbolicFuture", "hype_vs_pravda", "hype má rychlý nohy, pravda má delší dech", ["hype", "pravda"]),
    f("symbolicFuture", "budoucnost_vs_dnešek", "budoucnost bliká všude, dnešek si stejně musíš zachránit ručně", ["budoucnost", "dnešek"]),
    f("symbolicFuture", "růst_vs_smysl", "růst bez směru je jen dražší forma bloudění", ["růst", "směr"]),
  ],
  kryptokamos: [
    f("kryptokamos", "klid_v_chaosu", "největší síla dneska není křik, ale klid co vydrží tlak", ["klid", "tlak"]),
    f("kryptokamos", "něha_tvrdost", "můžeš zůstat měkkej k lidem a tvrdej k iluzím", ["lidskost", "iluze"]),
    f("kryptokamos", "směr_bez_jistoty", "směr držíš i bez jistoty, protože kompas není hype", ["směr", "kompas"]),
    f("kryptokamos", "přesnost_bez_hysterie", "přesnost bez hysterie je dneska vzácnější než predikce", ["přesnost", "hysterie"]),
  ],
};
