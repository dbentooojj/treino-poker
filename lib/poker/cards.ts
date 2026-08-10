export const SUITS = ["s", "h", "d", "c"] as const;
export const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export type PokerCard = {
  rank: Rank;
  suit: Suit;
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  s: "♠",
  h: "♥",
  d: "♦",
  c: "♣",
};

export const SUIT_NAMES: Record<Suit, string> = {
  s: "espadas",
  h: "copas",
  d: "ouros",
  c: "paus",
};

export function suitColorClass(suit: Suit | string): `suit-${Suit}` {
  const normalizedSuit = SUITS.find((candidate) => candidate === suit || SUIT_SYMBOLS[candidate] === suit);
  if (!normalizedSuit) throw new Error(`Naipe inválido: ${suit}`);
  return `suit-${normalizedSuit}`;
}

export const RANK_NAMES: Record<Rank, string> = {
  A: "Ás",
  K: "Rei",
  Q: "Dama",
  J: "Valete",
  T: "Dez",
  "9": "Nove",
  "8": "Oito",
  "7": "Sete",
  "6": "Seis",
  "5": "Cinco",
  "4": "Quatro",
  "3": "Três",
  "2": "Dois",
};

export const RANK_VALUES: Record<Rank, number> = {
  A: 14,
  K: 13,
  Q: 12,
  J: 11,
  T: 10,
  "9": 9,
  "8": 8,
  "7": 7,
  "6": 6,
  "5": 5,
  "4": 4,
  "3": 3,
  "2": 2,
};

export const FULL_DECK: readonly PokerCard[] = SUITS.flatMap((suit) =>
  RANKS.map((rank) => ({ rank, suit })),
);

export function cardKey(card: PokerCard): string {
  return `${card.rank}${card.suit}`;
}

export function cardLabel(card: PokerCard): string {
  return `${RANK_NAMES[card.rank]} de ${SUIT_NAMES[card.suit]}`;
}

export function formatCard(card: PokerCard): string {
  return `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
}

export function parseCard(value: string): PokerCard {
  const normalized = value.trim().replace(/^10/i, "T");
  const rank = normalized.slice(0, -1).toUpperCase() as Rank;
  const suit = normalized.slice(-1).toLowerCase() as Suit;
  if (!RANKS.includes(rank) || !SUITS.includes(suit)) {
    throw new Error(`Carta inválida: ${value}`);
  }
  return { rank, suit };
}

export function assertUniqueCards(cards: readonly PokerCard[]): void {
  const keys = cards.map(cardKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Uma carta não pode aparecer mais de uma vez.");
  }
}
