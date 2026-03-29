export type CodexLayerAxis =
  | "personal"
  | "weather"
  | "system"
  | "world"
  | "existential"
  | "irony"
  | "crypto"
  | "technoHuman"
  | "symbolicFuture"
  | "kryptokamos";

export interface LayerFragment {
  text: string;
  motif: string;
  axis: CodexLayerAxis;
  tags: string[];
  weight?: number;
}

export interface CandidateLayer {
  axis: CodexLayerAxis;
  fragment: LayerFragment;
}

export interface Candidate {
  text: string;
  opening: string;
  templateId: string;
  rhythm: string;
  layers: CandidateLayer[];
  motifs: string[];
  tags: string[];
}

export interface CandidateScoreBreakdown {
  depth: number;
  originality: number;
  naturalness: number;
  zleFit: number;
  antiBullshit: number;
  antiRepeat: number;
  publishability: number;
  symbolicDepth: number;
  futureTension: number;
  trustIllusionLayer: number;
  kryptoKamosFit: number;
  total: number;
}

export interface CandidateEvaluation {
  candidate: Candidate;
  score: CandidateScoreBreakdown;
  guardrailReasons: string[];
  blocked: boolean;
}

export interface DailyLineContext {
  date: string;
  seed: number;
  dayOfWeek: number;
  month: number;
  weekPhase: "start" | "middle" | "end" | "weekend";
  season: "winter" | "spring" | "summer" | "autumn";
  weatherMood: "slunce" | "déšť" | "vítr" | "mlha" | "tma";
  pressureLevel: "low" | "medium" | "high";
  societalPulse: "drahota" | "přetlak" | "únava" | "chaos" | "hluk";
  worldSignal: "trhy" | "algoritmy" | "války" | "krize" | "pozornost";
  worldSignals?: {
    lightLevel: "dark" | "dim" | "balanced" | "bright";
    weatherMood: "oppressive" | "flat" | "clear" | "volatile";
    marketStress: "low" | "medium" | "high";
    energyPressure: "low" | "medium" | "high";
    macroAbsurdity: "low" | "medium" | "high";
    socialTension: "low" | "medium" | "high";
    volatilityRegime: "low" | "medium" | "high";
    trustFragility: "low" | "medium" | "high";
    dominancePressure: "low" | "medium" | "high";
    speculationHeat: "low" | "medium" | "high";
    liquidityTension: "low" | "medium" | "high";
    fragileHope: "low" | "medium" | "high";
    motifs: string[];
    notes: string[];
    activatedAxes: CodexLayerAxis[];
    dominantAxis: CodexLayerAxis;
    sourceHealth: {
      weather: "ok" | "fallback";
      market: "ok" | "fallback";
      sentiment: "ok" | "fallback";
      crypto: "ok" | "fallback";
    };
  };
}

export interface DailyLineHistoryItem {
  date: string;
  text: string;
  motifs?: string[];
  axes?: CodexLayerAxis[];
}

export interface CodexGenerationResult {
  line: string;
  evaluations: CandidateEvaluation[];
  selected: CandidateEvaluation;
  context: DailyLineContext;
  explain: {
    usedSignals: string[];
    activatedMotifBuckets: string[];
  };
}
