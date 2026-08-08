import { assertUniqueCards, cardKey, FULL_DECK, type PokerCard } from "./cards";
import { compareHands } from "./evaluator";

export const DEFAULT_SIMULATIONS = 100_000;
export const DEFAULT_EXACT_THRESHOLD = 50_000;

export type EquityInput = {
  hero: PokerCard[];
  villain: PokerCard[];
  board: PokerCard[];
};

export type EquityOptions = {
  simulations?: number;
  seed?: number;
  exactThreshold?: number;
};

export type EquityResult = {
  heroWins: number;
  villainWins: number;
  ties: number;
  total: number;
  heroWinRate: number;
  villainWinRate: number;
  tieRate: number;
  heroEquity: number;
  villainEquity: number;
  method: "exact" | "monte-carlo";
};

type RandomSource = () => number;

export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function validateInput(input: EquityInput): void {
  if (input.hero.length !== 2) throw new Error("Selecione exatamente duas cartas para o Hero.");
  if (input.villain.length !== 0 && input.villain.length !== 2) {
    throw new Error("O Vilão deve ter zero ou exatamente duas cartas.");
  }
  if (input.board.length > 5) throw new Error("O board pode ter no máximo cinco cartas.");
  assertUniqueCards([...input.hero, ...input.villain, ...input.board]);
}

function availableCards(input: EquityInput): PokerCard[] {
  const occupied = new Set([...input.hero, ...input.villain, ...input.board].map(cardKey));
  return FULL_DECK.filter((card) => !occupied.has(cardKey(card)));
}

function sampleWithoutReplacement(
  source: readonly PokerCard[],
  count: number,
  random: RandomSource,
): PokerCard[] {
  const copy = [...source];
  for (let index = 0; index < count; index += 1) {
    const selected = index + Math.floor(random() * (copy.length - index));
    [copy[index], copy[selected]] = [copy[selected], copy[index]];
  }
  return copy.slice(0, count);
}

export function sampleSimulationDeal(
  input: EquityInput,
  random: RandomSource = Math.random,
): { villain: PokerCard[]; board: PokerCard[] } {
  validateInput(input);
  const boardNeeded = 5 - input.board.length;
  const villainNeeded = input.villain.length === 0 ? 2 : 0;
  const sampled = sampleWithoutReplacement(availableCards(input), villainNeeded + boardNeeded, random);
  const villain = input.villain.length === 2 ? [...input.villain] : sampled.slice(0, 2);
  const runout = sampled.slice(villainNeeded);
  return { villain, board: [...input.board, ...runout] };
}

function combinationCount(total: number, chosen: number): number {
  if (chosen < 0 || chosen > total) return 0;
  const size = Math.min(chosen, total - chosen);
  let result = 1;
  for (let index = 1; index <= size; index += 1) {
    result = (result * (total - size + index)) / index;
  }
  return Math.round(result);
}

function forEachCombination<T>(
  values: readonly T[],
  chosen: number,
  callback: (combination: T[]) => void,
): void {
  const combination: T[] = [];
  function visit(start: number): void {
    if (combination.length === chosen) {
      callback([...combination]);
      return;
    }
    const needed = chosen - combination.length;
    for (let index = start; index <= values.length - needed; index += 1) {
      combination.push(values[index]);
      visit(index + 1);
      combination.pop();
    }
  }
  visit(0);
}

function finalize(
  heroWins: number,
  villainWins: number,
  ties: number,
  method: EquityResult["method"],
): EquityResult {
  const total = heroWins + villainWins + ties;
  const heroWinRate = heroWins / total;
  const villainWinRate = villainWins / total;
  const tieRate = ties / total;
  return {
    heroWins,
    villainWins,
    ties,
    total,
    heroWinRate,
    villainWinRate,
    tieRate,
    heroEquity: heroWinRate + tieRate / 2,
    villainEquity: villainWinRate + tieRate / 2,
    method,
  };
}

export function calculateEquity(input: EquityInput, options: EquityOptions = {}): EquityResult {
  validateInput(input);
  const simulations = options.simulations ?? DEFAULT_SIMULATIONS;
  if (!Number.isInteger(simulations) || simulations <= 0) {
    throw new Error("A quantidade de simulações deve ser um inteiro positivo.");
  }

  const deck = availableCards(input);
  const boardNeeded = 5 - input.board.length;
  const exactRunouts = input.villain.length === 2 ? combinationCount(deck.length, boardNeeded) : Infinity;
  const exactThreshold = options.exactThreshold ?? DEFAULT_EXACT_THRESHOLD;
  let heroWins = 0;
  let villainWins = 0;
  let ties = 0;

  const record = (villain: readonly PokerCard[], board: readonly PokerCard[]) => {
    const comparison = compareHands([...input.hero, ...board], [...villain, ...board]);
    if (comparison > 0) heroWins += 1;
    else if (comparison < 0) villainWins += 1;
    else ties += 1;
  };

  if (exactRunouts <= exactThreshold) {
    forEachCombination(deck, boardNeeded, (runout) => {
      record(input.villain, [...input.board, ...runout]);
    });
    return finalize(heroWins, villainWins, ties, "exact");
  }

  const random = options.seed === undefined ? Math.random : createSeededRandom(options.seed);
  const villainNeeded = input.villain.length === 0 ? 2 : 0;
  for (let iteration = 0; iteration < simulations; iteration += 1) {
    const sampled = sampleWithoutReplacement(deck, villainNeeded + boardNeeded, random);
    const villain = villainNeeded === 2 ? sampled.slice(0, 2) : input.villain;
    const runout = sampled.slice(villainNeeded);
    record(villain, [...input.board, ...runout]);
  }
  return finalize(heroWins, villainWins, ties, "monte-carlo");
}
