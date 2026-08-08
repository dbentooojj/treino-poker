import { assertUniqueCards, RANK_VALUES, type PokerCard } from "./cards";

export const HAND_CATEGORIES = [
  "High Card",
  "Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
] as const;

export type HandCategory = (typeof HAND_CATEGORIES)[number];

export type HandRank = {
  category: HandCategory;
  categoryValue: number;
  kickers: number[];
};

function straightHigh(values: readonly number[]): number | null {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);

  let run = 1;
  for (let index = 1; index < unique.length; index += 1) {
    if (unique[index - 1] - unique[index] === 1) {
      run += 1;
      if (run >= 5) return unique[index] + 4;
    } else {
      run = 1;
    }
  }
  return null;
}

function rank(categoryValue: number, kickers: number[]): HandRank {
  return {
    category: HAND_CATEGORIES[categoryValue],
    categoryValue,
    kickers,
  };
}

/** Avalia diretamente a melhor combinação de cinco cartas entre cinco, seis ou sete cartas. */
export function evaluateHand(cards: readonly PokerCard[]): HandRank {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error("Uma mão avaliável deve conter entre 5 e 7 cartas.");
  }
  assertUniqueCards(cards);

  const counts = new Map<number, number>();
  const suits = new Map<PokerCard["suit"], number[]>();
  for (const card of cards) {
    const value = RANK_VALUES[card.rank];
    counts.set(value, (counts.get(value) ?? 0) + 1);
    const suitedValues = suits.get(card.suit) ?? [];
    suitedValues.push(value);
    suits.set(card.suit, suitedValues);
  }

  const values = [...counts.keys()].sort((a, b) => b - a);

  for (const suitedValues of suits.values()) {
    if (suitedValues.length >= 5) {
      const high = straightHigh(suitedValues);
      if (high !== null) return rank(8, [high]);
    }
  }

  const quads = values.find((value) => counts.get(value) === 4);
  if (quads !== undefined) {
    return rank(7, [quads, values.find((value) => value !== quads)!]);
  }

  const trips = values.filter((value) => (counts.get(value) ?? 0) >= 3);
  if (trips.length > 0) {
    const pair = values.find((value) => value !== trips[0] && (counts.get(value) ?? 0) >= 2);
    if (pair !== undefined) return rank(6, [trips[0], pair]);
  }

  for (const suitedValues of suits.values()) {
    if (suitedValues.length >= 5) {
      return rank(5, [...suitedValues].sort((a, b) => b - a).slice(0, 5));
    }
  }

  const highStraight = straightHigh(values);
  if (highStraight !== null) return rank(4, [highStraight]);

  if (trips.length > 0) {
    const kickers = values.filter((value) => value !== trips[0]).slice(0, 2);
    return rank(3, [trips[0], ...kickers]);
  }

  const pairs = values.filter((value) => (counts.get(value) ?? 0) >= 2);
  if (pairs.length >= 2) {
    const kicker = values.find((value) => value !== pairs[0] && value !== pairs[1])!;
    return rank(2, [pairs[0], pairs[1], kicker]);
  }

  if (pairs.length === 1) {
    const kickers = values.filter((value) => value !== pairs[0]).slice(0, 3);
    return rank(1, [pairs[0], ...kickers]);
  }

  return rank(0, values.slice(0, 5));
}

export function compareHandRanks(left: HandRank, right: HandRank): -1 | 0 | 1 {
  if (left.categoryValue !== right.categoryValue) {
    return left.categoryValue > right.categoryValue ? 1 : -1;
  }
  const length = Math.max(left.kickers.length, right.kickers.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.kickers[index] ?? 0) - (right.kickers[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

export function compareHands(left: readonly PokerCard[], right: readonly PokerCard[]): -1 | 0 | 1 {
  return compareHandRanks(evaluateHand(left), evaluateHand(right));
}
