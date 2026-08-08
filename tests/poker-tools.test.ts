import assert from "node:assert/strict";
import test from "node:test";
import { cardKey, parseCard, type PokerCard } from "../lib/poker/cards";
import { calculateEquity, createSeededRandom, sampleSimulationDeal } from "../lib/poker/equity";
import { compareHands, evaluateHand, type HandCategory } from "../lib/poker/evaluator";
import { calculateRequiredEquity } from "../lib/poker/pot-odds";

function cards(...values: string[]): PokerCard[] {
  return values.map(parseCard);
}

test("pot odds calcula a equity mínima pelo preço do call", () => {
  assert.equal(calculateRequiredEquity(100, 50), 1 / 3);
  assert.equal(calculateRequiredEquity(200, 50), 0.2);
});

const categoryCases: Array<[HandCategory, string[]]> = [
  ["High Card", ["As", "Kd", "9c", "6h", "3s"]],
  ["Pair", ["As", "Ad", "Kc", "7h", "2s"]],
  ["Two Pair", ["As", "Ad", "Kc", "Kh", "2s"]],
  ["Three of a Kind", ["As", "Ad", "Ac", "Kh", "2s"]],
  ["Straight", ["9s", "8d", "7c", "6h", "5s"]],
  ["Flush", ["As", "Js", "8s", "4s", "2s"]],
  ["Full House", ["As", "Ad", "Ac", "Kh", "Ks"]],
  ["Four of a Kind", ["As", "Ad", "Ac", "Ah", "Ks"]],
  ["Straight Flush", ["9s", "8s", "7s", "6s", "5s"]],
];

for (const [category, values] of categoryCases) {
  test(`evaluator reconhece ${category}`, () => {
    assert.equal(evaluateHand(cards(...values)).category, category);
  });
}

test("evaluator reconhece A2345 como straight de cinco", () => {
  const result = evaluateHand(cards("As", "2d", "3c", "4h", "5s"));
  assert.equal(result.category, "Straight");
  assert.equal(result.kickers[0], 5);
});

test("evaluator escolhe a melhor mão de cinco entre sete cartas", () => {
  const result = evaluateHand(cards("As", "Ks", "Qs", "Js", "Ts", "2d", "2c"));
  assert.equal(result.category, "Straight Flush");
  assert.equal(result.kickers[0], 14);
});

test("comparação de mãos resolve vencedor e empate", () => {
  assert.equal(compareHands(cards("As", "Ad", "Qc", "8h", "2s"), cards("Ks", "Kd", "Qc", "8h", "2s")), 1);
  assert.equal(compareHands(cards("2c", "3d", "As", "Ks", "Qs", "Js", "Ts"), cards("4c", "5d", "As", "Ks", "Qs", "Js", "Ts")), 0);
});

test("equity registra empate garantido no river", () => {
  const result = calculateEquity({
    hero: cards("2c", "3d"),
    villain: cards("4c", "5d"),
    board: cards("As", "Ks", "Qs", "Js", "Ts"),
  });
  assert.equal(result.method, "exact");
  assert.equal(result.tieRate, 1);
  assert.equal(result.heroEquity, 0.5);
  assert.equal(result.villainEquity, 0.5);
});

test("equity registra 100% quando o adversário não pode vencer", () => {
  const result = calculateEquity({
    hero: cards("As", "Ad"),
    villain: cards("Kc", "Kd"),
    board: cards("Ah", "Ac", "2s", "3s", "4d"),
  });
  assert.equal(result.heroWinRate, 1);
  assert.equal(result.heroEquity, 1);
});

test("trocar Hero e Vilão inverte as taxas de vitória", () => {
  const hero = cards("As", "Ad");
  const villain = cards("Kc", "Kd");
  const board = cards("2c", "7d", "9h");
  const first = calculateEquity({ hero, villain, board });
  const swapped = calculateEquity({ hero: villain, villain: hero, board });
  assert.equal(first.method, "exact");
  assert.equal(first.heroWinRate, swapped.villainWinRate);
  assert.equal(first.villainWinRate, swapped.heroWinRate);
  assert.equal(first.tieRate, swapped.tieRate);
});

test("equity rejeita qualquer carta duplicada", () => {
  assert.throws(() => calculateEquity({
    hero: cards("As", "Ad"),
    villain: cards("As", "Kd"),
    board: [],
  }), /não pode aparecer mais de uma vez/i);
});

test("Monte Carlo nunca reutiliza cartas ocupadas", () => {
  const input = {
    hero: cards("As", "Kd"),
    villain: [],
    board: cards("2c", "7d", "9h"),
  };
  const random = createSeededRandom(20260808);
  for (let iteration = 0; iteration < 500; iteration += 1) {
    const deal = sampleSimulationDeal(input, random);
    const allCards = [...input.hero, ...deal.villain, ...deal.board];
    assert.equal(new Set(allCards.map(cardKey)).size, allCards.length);
  }
  const result = calculateEquity(input, { simulations: 1_000, seed: 42 });
  const repeated = calculateEquity(input, { simulations: 1_000, seed: 42 });
  assert.equal(result.method, "monte-carlo");
  assert.equal(result.total, 1_000);
  assert.deepEqual(repeated, result);
});
