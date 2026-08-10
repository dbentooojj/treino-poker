import {
  cardKey,
  RANKS,
  SUITS,
  type PokerCard,
  type Rank,
} from "./cards";

export const TOTAL_STARTING_HAND_COMBINATIONS = 1_326;

export type StartingHandCell = {
  handClass: string;
  row: number;
  column: number;
  pair: boolean;
  suited: boolean;
  offsuit: boolean;
};

export type VillainRangePreset = {
  id: "tight" | "medium" | "wide" | "all";
  label: string;
  description: string;
  hands: readonly string[];
};

/**
 * Frequencies are stored as numbers from 0 to 1 even though the current
 * selector only exposes binary 0% / 100% choices. Keeping the applied range in
 * this shape lets the UI add partial frequencies later without changing its
 * persisted data model.
 */
export type RangeWeightMap = Readonly<Record<string, number>>;

const TIGHT_RANGE = [
  "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77",
  "AKs", "AQs", "AJs", "ATs", "KQs", "AKo", "AQo",
];

const MEDIUM_RANGE = [
  "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55",
  "AKs", "AQs", "AJs", "ATs", "A9s", "A8s",
  "KQs", "KJs", "KTs", "QJs", "QTs", "JTs", "T9s", "98s",
  "AKo", "AQo", "AJo", "ATo", "KQo",
];

const WIDE_RANGE = [
  "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55", "44", "33", "22",
  "AKs", "AQs", "AJs", "ATs", "A9s", "A8s", "A7s", "A6s", "A5s", "A4s", "A3s", "A2s",
  "KQs", "KJs", "KTs", "K9s", "K8s", "K7s",
  "QJs", "QTs", "Q9s", "Q8s", "JTs", "J9s", "J8s", "T9s", "T8s",
  "98s", "87s", "76s", "65s", "54s",
  "AKo", "AQo", "AJo", "ATo", "A9o", "A8o", "KQo", "KJo", "KTo", "QJo", "QTo", "JTo",
];

export function buildStartingHandMatrix(): StartingHandCell[] {
  return RANKS.flatMap((highRank, row) => RANKS.map((lowRank, column) => ({
    row,
    column,
    pair: row === column,
    suited: row < column,
    offsuit: row > column,
    handClass: row === column ? `${highRank}${lowRank}` : row < column ? `${highRank}${lowRank}s` : `${lowRank}${highRank}o`,
  })));
}

const ALL_HANDS = buildStartingHandMatrix().map((cell) => cell.handClass);
const HAND_ORDER = new Map(ALL_HANDS.map((handClass, index) => [handClass, index]));

function canonicalHandClass(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  if (trimmed.length === 3) return `${trimmed.slice(0, 2).toUpperCase()}${trimmed.slice(2).toLowerCase()}`;
  return trimmed;
}

export const VILLAIN_RANGE_PRESETS: readonly VillainRangePreset[] = [
  { id: "tight", label: "Fechado", description: "Poucas mãos fortes", hands: TIGHT_RANGE },
  { id: "medium", label: "Médio", description: "Seleção equilibrada", hands: MEDIUM_RANGE },
  { id: "wide", label: "Amplo", description: "Muitas mãos jogáveis", hands: WIDE_RANGE },
  { id: "all", label: "Todas", description: "Qualquer mão possível", hands: ALL_HANDS },
];

export const DEFAULT_VILLAIN_RANGE = [...MEDIUM_RANGE];

export function normalizeRange(handClasses: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const value of handClasses) {
    const handClass = canonicalHandClass(value);
    if (!HAND_ORDER.has(handClass)) throw new Error(`Classe de mão inválida: ${value}`);
    unique.add(handClass);
  }
  return [...unique].sort((left, right) => (HAND_ORDER.get(left) ?? 0) - (HAND_ORDER.get(right) ?? 0));
}

export function createRangeWeightMap(
  handClasses: readonly string[],
  weight = 1,
): RangeWeightMap {
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
    throw new Error("A frequência do range deve estar entre 0 e 1.");
  }
  return Object.fromEntries(normalizeRange(handClasses).map((handClass) => [handClass, weight]));
}

export function handClassesFromRangeWeightMap(weights: RangeWeightMap): string[] {
  const activeHands: string[] = [];
  for (const [value, weight] of Object.entries(weights)) {
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new Error(`Frequência inválida para ${value}.`);
    }
    if (weight > 0) activeHands.push(normalizeRange([value])[0]);
  }
  return normalizeRange(activeHands);
}

export function toggleRangeHandWeight(
  weights: RangeWeightMap,
  value: string,
): RangeWeightMap {
  const handClass = normalizeRange([value])[0];
  const next = { ...weights };
  if ((next[handClass] ?? 0) > 0) delete next[handClass];
  else next[handClass] = 1;
  return next;
}

export function expandStartingHandClass(value: string): PokerCard[][] {
  const handClass = canonicalHandClass(value);
  if (!HAND_ORDER.has(handClass)) throw new Error(`Classe de mão inválida: ${value}`);

  const first = handClass[0] as Rank;
  const second = handClass[1] as Rank;
  if (first === second) {
    const combinations: PokerCard[][] = [];
    for (let firstSuit = 0; firstSuit < SUITS.length; firstSuit += 1) {
      for (let secondSuit = firstSuit + 1; secondSuit < SUITS.length; secondSuit += 1) {
        combinations.push([
          { rank: first, suit: SUITS[firstSuit] },
          { rank: second, suit: SUITS[secondSuit] },
        ]);
      }
    }
    return combinations;
  }

  const suited = handClass.endsWith("s");
  const combinations: PokerCard[][] = [];
  for (const firstSuit of SUITS) {
    for (const secondSuit of SUITS) {
      if (suited ? firstSuit !== secondSuit : firstSuit === secondSuit) continue;
      combinations.push([
        { rank: first, suit: firstSuit },
        { rank: second, suit: secondSuit },
      ]);
    }
  }
  return combinations;
}

export function rangeCombinationCount(handClasses: readonly string[]): number {
  return normalizeRange(handClasses).reduce(
    (total, handClass) => total + expandStartingHandClass(handClass).length,
    0,
  );
}

export function availableRangeCombinations(
  handClasses: readonly string[],
  blockedCards: readonly PokerCard[],
): PokerCard[][] {
  const blocked = new Set(blockedCards.map(cardKey));
  return normalizeRange(handClasses)
    .flatMap(expandStartingHandClass)
    .filter((combination) => combination.every((card) => !blocked.has(cardKey(card))));
}
