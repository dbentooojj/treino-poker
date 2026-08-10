import { assertUniqueCards, cardKey, FULL_DECK, type PokerCard } from "./cards";
import { compareHands } from "./evaluator";
import { availableRangeCombinations, normalizeRange } from "./range";

export const DEFAULT_SIMULATIONS = 100_000;
export const DEFAULT_EXACT_THRESHOLD = 50_000;

export type EquityInput = {
  hero: PokerCard[];
  villain: PokerCard[];
  villainRange?: string[];
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
  /** Cartas da próxima street que deixam o Hero estritamente à frente; disponível no flop/turn contra mão exata. */
  outs: number | null;
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
  if (input.villainRange && input.villain.length > 0) {
    throw new Error("Escolha uma mão exata ou um range para o Vilão, não os dois.");
  }
  if (input.villainRange) {
    const normalizedRange = normalizeRange(input.villainRange);
    if (normalizedRange.length === 0) throw new Error("Selecione ao menos uma mão para o range do Vilão.");
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
  if (input.villainRange) {
    const combinations = availableRangeCombinations(input.villainRange, [...input.hero, ...input.board]);
    if (combinations.length === 0) throw new Error("Nenhuma combinação do range está disponível com essas cartas.");
    const villain = combinations[Math.floor(random() * combinations.length)];
    const villainCards = new Set(villain.map(cardKey));
    const deck = availableCards(input).filter((card) => !villainCards.has(cardKey(card)));
    const runout = sampleWithoutReplacement(deck, boardNeeded, random);
    return { villain: [...villain], board: [...input.board, ...runout] };
  }
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
  outs: number | null = null,
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
    outs,
    method,
  };
}

type ExactTurnOutcomes = {
  heroWins: number;
  villainWins: number;
  ties: number;
  winningRivers: PokerCard[];
};

function classifyExactTurnRivers(input: EquityInput): ExactTurnOutcomes {
  let heroWins = 0;
  let villainWins = 0;
  let ties = 0;
  const winningRivers: PokerCard[] = [];

  for (const river of availableCards(input)) {
    const finalBoard = [...input.board, river];
    const comparison = compareHands(
      [...input.hero, ...finalBoard],
      [...input.villain, ...finalBoard],
    );
    if (comparison > 0) {
      heroWins += 1;
      winningRivers.push(river);
    } else if (comparison < 0) {
      villainWins += 1;
    } else {
      ties += 1;
    }
  }

  return { heroWins, villainWins, ties, winningRivers };
}

function classifyExactWinningNextCards(input: EquityInput): PokerCard[] {
  return availableCards(input).filter((nextCard) => {
    const nextBoard = [...input.board, nextCard];
    return compareHands(
      [...input.hero, ...nextBoard],
      [...input.villain, ...nextBoard],
    ) > 0;
  });
}

/**
 * Lista os turns que colocam o Hero estritamente à frente após um flop completo.
 * Empates e backdoors que ainda dependem do river não contam como out imediato.
 */
export function calculateFlopOuts(input: EquityInput): PokerCard[] | null {
  validateInput(input);
  if (input.board.length !== 3 || input.villain.length !== 2 || input.villainRange) return null;
  return classifyExactWinningNextCards(input);
}

/**
 * Lista os rivers que fazem o Hero passar a vencer estritamente no turn.
 * Retorna `null` fora do turn ou quando o Vilão não tem uma mão exata.
 */
export function calculateTurnOuts(input: EquityInput): PokerCard[] | null {
  validateInput(input);
  if (input.board.length !== 4 || input.villain.length !== 2 || input.villainRange) return null;
  return classifyExactTurnRivers(input).winningRivers;
}

export function calculateEquity(input: EquityInput, options: EquityOptions = {}): EquityResult {
  validateInput(input);
  const simulations = options.simulations ?? DEFAULT_SIMULATIONS;
  if (!Number.isInteger(simulations) || simulations <= 0) {
    throw new Error("A quantidade de simulações deve ser um inteiro positivo.");
  }

  const deck = availableCards(input);
  const boardNeeded = 5 - input.board.length;
  const exactThreshold = options.exactThreshold ?? DEFAULT_EXACT_THRESHOLD;
  let heroWins = 0;
  let villainWins = 0;
  let ties = 0;
  const flopOuts = !input.villainRange && input.villain.length === 2 && input.board.length === 3
    ? classifyExactWinningNextCards(input).length
    : null;

  if (!input.villainRange && input.villain.length === 2 && input.board.length === 4) {
    const turnOutcomes = classifyExactTurnRivers(input);
    return finalize(
      turnOutcomes.heroWins,
      turnOutcomes.villainWins,
      turnOutcomes.ties,
      "exact",
      turnOutcomes.winningRivers.length,
    );
  }

  const record = (villain: readonly PokerCard[], board: readonly PokerCard[]) => {
    const comparison = compareHands([...input.hero, ...board], [...villain, ...board]);
    if (comparison > 0) heroWins += 1;
    else if (comparison < 0) villainWins += 1;
    else ties += 1;
  };

  if (input.villainRange) {
    const combinations = availableRangeCombinations(input.villainRange, [...input.hero, ...input.board]);
    if (combinations.length === 0) throw new Error("Nenhuma combinação do range está disponível com essas cartas.");
    const deals = combinations.map((villain) => {
      const occupied = new Set(villain.map(cardKey));
      return { villain, deck: deck.filter((card) => !occupied.has(cardKey(card))) };
    });
    const exactRunouts = deals.length * combinationCount(deals[0].deck.length, boardNeeded);

    if (exactRunouts <= exactThreshold) {
      for (const deal of deals) {
        forEachCombination(deal.deck, boardNeeded, (runout) => {
          record(deal.villain, [...input.board, ...runout]);
        });
      }
      return finalize(heroWins, villainWins, ties, "exact");
    }

    const random = options.seed === undefined ? Math.random : createSeededRandom(options.seed);
    for (let iteration = 0; iteration < simulations; iteration += 1) {
      const deal = deals[Math.floor(random() * deals.length)];
      const runout = sampleWithoutReplacement(deal.deck, boardNeeded, random);
      record(deal.villain, [...input.board, ...runout]);
    }
    return finalize(heroWins, villainWins, ties, "monte-carlo");
  }

  const exactRunouts = input.villain.length === 2 ? combinationCount(deck.length, boardNeeded) : Infinity;

  if (exactRunouts <= exactThreshold) {
    forEachCombination(deck, boardNeeded, (runout) => {
      record(input.villain, [...input.board, ...runout]);
    });
    return finalize(heroWins, villainWins, ties, "exact", flopOuts);
  }

  const random = options.seed === undefined ? Math.random : createSeededRandom(options.seed);
  const villainNeeded = input.villain.length === 0 ? 2 : 0;
  for (let iteration = 0; iteration < simulations; iteration += 1) {
    const sampled = sampleWithoutReplacement(deck, villainNeeded + boardNeeded, random);
    const villain = villainNeeded === 2 ? sampled.slice(0, 2) : input.villain;
    const runout = sampled.slice(villainNeeded);
    record(villain, [...input.board, ...runout]);
  }
  return finalize(heroWins, villainWins, ties, "monte-carlo", flopOuts);
}
