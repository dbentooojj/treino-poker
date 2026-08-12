import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PokerToolsExperience from "../components/poker-tools/PokerToolsExperience";
import PotOddsCalculator from "../components/poker-tools/PotOddsCalculator";
import EquityResult from "../components/poker-tools/EquityResult";
import PlayingCard from "../components/poker-tools/PlayingCard";
import { cardKey, parseCard, suitColorClass, SUIT_SYMBOLS, type PokerCard, type Suit } from "../lib/poker/cards";
import { calculateEquity, calculateFlopOuts, calculateTurnOuts, createSeededRandom, sampleSimulationDeal } from "../lib/poker/equity";
import { compareHands, evaluateHand, type HandCategory } from "../lib/poker/evaluator";
import { calculateCallEV, calculateRequiredEquity } from "../lib/poker/pot-odds";
import {
  cascadeStreetStartingPots,
  createEmptyStreetInputs,
  deriveStreetDecision,
  normalizeStreetInputAction,
  parsePokerAmount,
  STREET_LABELS,
  STREETS,
  type StreetInput,
} from "../lib/poker/street";
import {
  availableRangeCombinations,
  buildStartingHandMatrix,
  createRangeWeightMap,
  expandStartingHandClass,
  handClassesFromRangeWeightMap,
  rangeCombinationCount,
  TOTAL_STARTING_HAND_COMBINATIONS,
  toggleRangeHandWeight,
} from "../lib/poker/range";

function cards(...values: string[]): PokerCard[] {
  return values.map(parseCard);
}

const HERO_VS_RANGE_FIXTURE = ["TT", "JJ", "QQ", "KK", "AA", "AQs", "AKs", "AKo"] as const;
const HERO_VS_RANGE_FLOP = ["Ks", "8c", "4s"] as const;

test("cada naipe usa sua própria classe de cor nas cartas", () => {
  const expectedClasses: Record<Suit, string> = {
    s: "suit-s",
    h: "suit-h",
    d: "suit-d",
    c: "suit-c",
  };

  for (const [suit, expectedClass] of Object.entries(expectedClasses) as [Suit, string][]) {
    assert.equal(suitColorClass(suit), expectedClass);
    assert.equal(suitColorClass(SUIT_SYMBOLS[suit]), expectedClass);
    const html = renderToStaticMarkup(createElement(PlayingCard, {
      card: parseCard(`A${suit}`),
      label: "Carta de teste",
      selected: false,
      onSelect: () => undefined,
      onRemove: () => undefined,
    }));
    assert.match(html, new RegExp(`tool-card-slot[^\"]*${expectedClass}`));
  }

  const styleSheet = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styleSheet, /--suit-spades:#151a18/);
  assert.match(styleSheet, /--suit-hearts:#c83f43/);
  assert.match(styleSheet, /--suit-diamonds:#2878d0/);
  assert.match(styleSheet, /--suit-clubs:#168653/);
});

test("pot odds calcula a equity mínima pelo preço do call", () => {
  assert.equal(calculateRequiredEquity(100, 50), 1 / 3);
  assert.equal(calculateRequiredEquity(200, 50), 0.2);
});

test("EV do call usa o pote final sem contar o call duas vezes", () => {
  assert.ok(Math.abs(calculateCallEV(0.423, 100, 50) - 13.45) < 1e-10);
  assert.equal(calculateCallEV(1 / 3, 100, 50), 0);
});

test("modelo de streets cria entradas independentes para a mão inteira", () => {
  const inputs = createEmptyStreetInputs();

  assert.deepEqual(STREETS, ["preflop", "flop", "turn", "river"]);
  assert.equal(STREET_LABELS.preflop, "Pré-flop");
  assert.deepEqual(Object.keys(inputs), STREETS);
  assert.notEqual(inputs.flop, inputs.turn);
  assert.deepEqual(inputs.flop, {
    startingPot: "",
    villainAction: "bet",
    betAmount: "",
    heroAction: "pending",
  });
});

test("valor de poker aceita decimais e valores agrupados nos dois formatos", () => {
  assert.equal(parsePokerAmount("4000"), 4_000);
  assert.equal(parsePokerAmount("4.000"), 4_000);
  assert.equal(parsePokerAmount("4,000"), 4_000);
  assert.equal(parsePokerAmount("1.234.567"), 1_234_567);
  assert.equal(parsePokerAmount(" 1.234,50 "), 1_234.5);
  assert.equal(parsePokerAmount("1,234.50"), 1_234.5);
  assert.equal(parsePokerAmount("2,5"), 2.5);
  assert.equal(parsePokerAmount(""), null);
  assert.equal(parsePokerAmount("-10"), null);
  assert.equal(parsePokerAmount("valor"), null);
});

test("bet de 2000 em pote de 4000 produz pot odds de 25%", () => {
  const result = deriveStreetDecision({
    startingPot: "4000",
    villainAction: "bet",
    betAmount: "2000",
    heroAction: "call",
  });

  assert.deepEqual(result, {
    startingPot: 4_000,
    betAmount: 2_000,
    potBeforeCall: 6_000,
    callAmount: 2_000,
    potAfterCall: 8_000,
    requiredEquity: 0.25,
    nextPot: 8_000,
    handEnded: false,
    isComplete: true,
  });
});

test("check/check conserva o pote para a próxima street", () => {
  const result = deriveStreetDecision({
    startingPot: "8000",
    villainAction: "check",
    betAmount: "",
    heroAction: "check",
  });

  assert.equal(result.requiredEquity, null);
  assert.equal(result.nextPot, 8_000);
  assert.equal(result.handEnded, false);
  assert.equal(result.isComplete, true);
});

test("progressão da mão recalcula turn e river quando o flop muda", () => {
  const inputs = createEmptyStreetInputs();
  inputs.flop = {
    startingPot: "4000",
    villainAction: "bet",
    betAmount: "2000",
    heroAction: "call",
  };
  inputs.turn = {
    ...inputs.turn,
    villainAction: "check",
    heroAction: "check",
  };

  const carried = cascadeStreetStartingPots(inputs, "flop");
  assert.equal(carried.turn.startingPot, "8000");
  assert.equal(carried.river.startingPot, "8000");

  const edited = cascadeStreetStartingPots({
    ...carried,
    flop: { ...carried.flop, betAmount: "1000" },
  }, "flop");
  assert.equal(edited.turn.startingPot, "6000");
  assert.equal(edited.river.startingPot, "6000");

  const folded = cascadeStreetStartingPots({
    ...edited,
    flop: { ...edited.flop, heroAction: "fold" },
  }, "flop");
  assert.equal(folded.turn.startingPot, "");
  assert.equal(folded.river.startingPot, "");
});

test("fold encerra a mão e ação pendente não propaga pote", () => {
  const base: StreetInput = {
    startingPot: "8000",
    villainAction: "bet",
    betAmount: "4000",
    heroAction: "fold",
  };
  const folded = deriveStreetDecision(base);
  const pending = deriveStreetDecision({ ...base, heroAction: "pending" });

  assert.equal(folded.handEnded, true);
  assert.equal(folded.nextPot, null);
  assert.equal(folded.isComplete, true);
  assert.equal(pending.handEnded, false);
  assert.equal(pending.nextPot, null);
  assert.equal(pending.isComplete, false);
});

test("trocar a ação do vilão normaliza somente respostas incompatíveis", () => {
  const betInput: StreetInput = {
    startingPot: "4000",
    villainAction: "bet",
    betAmount: "2000",
    heroAction: "call",
  };

  assert.equal(normalizeStreetInputAction(betInput, "check").heroAction, "pending");
  assert.equal(normalizeStreetInputAction({ ...betInput, heroAction: "pending" }, "check").heroAction, "pending");
  assert.equal(normalizeStreetInputAction({ ...betInput, heroAction: "check" }, "check").heroAction, "check");
  assert.equal(normalizeStreetInputAction({ ...betInput, heroAction: "check" }, "bet").heroAction, "pending");
  assert.equal(normalizeStreetInputAction({ ...betInput, heroAction: "fold" }, "bet").heroAction, "fold");
});

test("matriz de range contém as 169 classes de mãos iniciais", () => {
  const matrix = buildStartingHandMatrix();
  assert.equal(matrix.length, 169);
  assert.equal(new Set(matrix.map((cell) => cell.handClass)).size, 169);
  assert.equal(matrix[0].handClass, "AA");
  assert.equal(matrix[1].handClass, "AKs");
  assert.equal(matrix[13].handClass, "AKo");
  assert.equal(
    rangeCombinationCount(matrix.map((cell) => cell.handClass)),
    TOTAL_STARTING_HAND_COMBINATIONS,
  );
});

test("classes de range expandem pares, suited e offsuit corretamente", () => {
  assert.equal(expandStartingHandClass("AA").length, 6);
  assert.equal(expandStartingHandClass("AKs").length, 4);
  assert.equal(expandStartingHandClass("AKo").length, 12);
  assert.equal(rangeCombinationCount(["AA", "AKs", "AKo"]), 22);
});

test("bloqueadores removem combinações impossíveis do range", () => {
  assert.equal(availableRangeCombinations(["AA"], cards("As")).length, 3);
  assert.equal(availableRangeCombinations(["AKs"], cards("As")).length, 3);
  assert.equal(availableRangeCombinations(["AKo"], cards("As")).length, 9);
  assert.equal(availableRangeCombinations(["JJ"], cards("Js", "Jh")).length, 1);
  assert.equal(availableRangeCombinations(["JJ"], cards("Js", "Jh", "Jd")).length, 0);
});

test("rascunho ponderado do modal não altera o range aplicado até a confirmação", () => {
  const applied = createRangeWeightMap(["AA", "KK"]);
  const draft = toggleRangeHandWeight(applied, "QQ");

  assert.notEqual(draft, applied);
  assert.deepEqual(handClassesFromRangeWeightMap(applied), ["AA", "KK"]);
  assert.deepEqual(handClassesFromRangeWeightMap(draft), ["AA", "KK", "QQ"]);
  assert.deepEqual(createRangeWeightMap(["AQs"], 0.5), { AQs: 0.5 });
});

test("fixture AsQs vs TT+, AQs+, AKo conta combos base e bloqueados", () => {
  const hero = cards("As", "Qs");
  const flop = cards(...HERO_VS_RANGE_FLOP);

  assert.equal(rangeCombinationCount(HERO_VS_RANGE_FIXTURE), 50);
  assert.equal(availableRangeCombinations(HERO_VS_RANGE_FIXTURE, hero).length, 39);
  assert.equal(availableRangeCombinations(HERO_VS_RANGE_FIXTURE, [...hero, ...flop]).length, 33);
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

const TURN_OUTS_FIXTURE = {
  hero: cards("Ts", "9s"),
  villain: cards("Jc", "Th"),
  board: cards("Td", "8s", "8h", "7s"),
};

const FLOP_OUTS_FIXTURE = {
  hero: cards("Ts", "9s"),
  villain: cards("Js", "Th"),
  board: cards("Tc", "8h", "8s"),
};

test("flop exato conta somente os três noves que colocam o Hero à frente no turn", () => {
  const outs = calculateFlopOuts(FLOP_OUTS_FIXTURE);
  assert.ok(outs);
  assert.deepEqual(new Set(outs.map(cardKey)), new Set(["9h", "9d", "9c"]));
  const result = calculateEquity(FLOP_OUTS_FIXTURE);
  assert.equal(result.outs, 3);
  assert.equal(result.outsOwner, "hero");
});

test("quando o Hero já está à frente, exibe somente os outs imediatos do Vilão", () => {
  const input = {
    hero: cards("Jh", "Jc"),
    villain: cards("As", "Ah"),
    board: cards("Jd", "7h", "4s"),
  };
  const result = calculateEquity(input);
  const html = renderToStaticMarkup(createElement(EquityResult, { result }));

  assert.deepEqual(calculateFlopOuts(input), []);
  assert.equal(result.outs, 2);
  assert.equal(result.outsOwner, "villain");
  assert.match(html, /<div class="outs"><dt>Outs do Vilão<\/dt><dd>2<\/dd><\/div>/);
});

test("outs do flop não incluem empate nem backdoor dependente do river", () => {
  const outs = calculateFlopOuts(FLOP_OUTS_FIXTURE);
  assert.ok(outs);
  assert.equal(outs.some((card) => cardKey(card) === "As"), false, "Ás no turn apenas leva ao empate pelo board");
  assert.equal(outs.some((card) => cardKey(card) === "7s"), false, "uma espada isolada ainda depende do river");
});

test("turn exato enumera 14 vitórias, 12 empates e 18 derrotas em 44 rivers", () => {
  const result = calculateEquity(TURN_OUTS_FIXTURE);

  assert.deepEqual(
    { heroWins: result.heroWins, ties: result.ties, villainWins: result.villainWins, total: result.total },
    { heroWins: 14, ties: 12, villainWins: 18, total: 44 },
  );
  assert.equal(result.outs, 14);
  assert.equal(result.outsOwner, "hero");
  assert.equal(result.heroWinRate, 14 / 44);
  assert.equal(result.tieRate, 12 / 44);
  assert.equal(result.villainWinRate, 18 / 44);
  assert.equal(result.heroWinRate + result.tieRate + result.villainWinRate, 1);
  assert.equal(result.heroEquity, result.heroWinRate + result.tieRate / 2);
  assert.equal(result.villainEquity, result.villainWinRate + result.tieRate / 2);
});

test("outs do turn são exatamente os 14 rivers vencedores avaliados", () => {
  const outs = calculateTurnOuts(TURN_OUTS_FIXTURE);
  assert.ok(outs);
  assert.deepEqual(
    new Set(outs.map(cardKey)),
    new Set(["As", "Ks", "Qs", "Js", "Jh", "Jd", "6s", "6h", "6d", "6c", "5s", "4s", "3s", "2s"]),
  );
});

test("river que produz empate não conta como out", () => {
  const outs = calculateTurnOuts(TURN_OUTS_FIXTURE);
  assert.ok(outs);
  assert.equal(outs.some((card) => cardKey(card) === "Ah"), false);
});

test("outs não contêm cartas conhecidas nem cartas duplicadas", () => {
  const outs = calculateTurnOuts(TURN_OUTS_FIXTURE);
  assert.ok(outs);
  const outKeys = outs.map(cardKey);
  const knownKeys = new Set([
    ...TURN_OUTS_FIXTURE.hero,
    ...TURN_OUTS_FIXTURE.villain,
    ...TURN_OUTS_FIXTURE.board,
  ].map(cardKey));

  assert.equal(outKeys.some((key) => knownKeys.has(key)), false);
  assert.equal(new Set(outKeys).size, outKeys.length);
});

test("outs ficam indisponíveis no pré-flop e river", () => {
  const base = { hero: cards("As", "Kd"), villain: cards("Qc", "Jh") };

  assert.equal(calculateTurnOuts({ ...base, board: [] }), null);
  assert.equal(calculateTurnOuts({ ...base, board: cards("2s", "7h", "9d") }), null);
  assert.equal(calculateTurnOuts({ ...base, board: cards("2s", "7h", "9d", "Tc", "3s") }), null);
  assert.equal(calculateEquity({ ...base, board: [] }, { simulations: 20, seed: 1 }).outs, null);
  assert.equal(calculateEquity({ ...base, board: cards("2s", "7h", "9d", "Tc", "3s") }).outs, null);
});

test("resultado visual mantém somente um risco em Outs após o river", () => {
  const riverResult = calculateEquity({
    hero: cards("As", "Kd"),
    villain: cards("Qc", "Jh"),
    board: cards("2s", "7h", "9d", "Tc", "3s"),
  });
  const html = renderToStaticMarkup(createElement(EquityResult, { result: riverResult }));
  assert.equal(riverResult.outs, null);
  assert.match(html, /<div class="outs"><dt>Outs<\/dt><dd>—<\/dd><\/div>/);
});

test("outs ficam indisponíveis contra range, inclusive no turn", () => {
  const input = {
    hero: cards("As", "Kd"),
    villain: [],
    villainRange: ["QQ", "JJ"],
    board: cards("2s", "7h", "9d", "Tc"),
  };

  assert.equal(calculateTurnOuts(input), null);
  assert.equal(calculateEquity(input).outs, null);
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

test("simulação contra range usa somente combinações selecionadas e disponíveis", () => {
  const input = {
    hero: cards("As", "Kd"),
    villain: [],
    villainRange: ["AA", "AKs", "QJo"],
    board: cards("2c", "7d", "9h"),
  };
  const allowed = new Set(
    availableRangeCombinations(input.villainRange, [...input.hero, ...input.board])
      .map((combination) => combination.map(cardKey).sort().join("|")),
  );
  const random = createSeededRandom(91);
  for (let iteration = 0; iteration < 250; iteration += 1) {
    const deal = sampleSimulationDeal(input, random);
    assert.ok(allowed.has(deal.villain.map(cardKey).sort().join("|")));
    const allCards = [...input.hero, ...deal.villain, ...deal.board];
    assert.equal(new Set(allCards.map(cardKey)).size, allCards.length);
  }
});

test("equity calcula contra range e enumera exatamente quando há poucos runouts", () => {
  const result = calculateEquity({
    hero: cards("Ah", "Ad"),
    villain: [],
    villainRange: ["KK"],
    board: cards("2c", "3d", "4h", "5s", "9c"),
  });
  assert.equal(result.method, "exact");
  assert.equal(result.total, 6);
  assert.equal(result.heroEquity, 1);
});

test("fixture AsQs vs TT+, AQs+, AKo produz resultados exatos do flop ao river", () => {
  const streets = [
    {
      name: "flop",
      board: cards(...HERO_VS_RANGE_FLOP),
      expected: { heroWins: 13_976, villainWins: 16_849, ties: 1_845, total: 32_670 },
    },
    {
      name: "turn",
      board: cards(...HERO_VS_RANGE_FLOP, "2h"),
      expected: { heroWins: 366, villainWins: 981, ties: 105, total: 1_452 },
    },
    {
      name: "river",
      board: cards(...HERO_VS_RANGE_FLOP, "2h", "9d"),
      expected: { heroWins: 0, villainWins: 30, ties: 3, total: 33 },
    },
  ];

  for (const street of streets) {
    const result = calculateEquity({
      hero: cards("As", "Qs"),
      villain: [],
      villainRange: [...HERO_VS_RANGE_FIXTURE],
      board: street.board,
    });

    assert.equal(result.method, "exact", `${street.name} deve usar enumeração exata`);
    assert.deepEqual(
      {
        heroWins: result.heroWins,
        villainWins: result.villainWins,
        ties: result.ties,
        total: result.total,
      },
      street.expected,
      `resultado inesperado no ${street.name}`,
    );
    assert.equal(
      result.heroEquity,
      result.heroWins / result.total + result.ties / result.total / 2,
      `equity inesperada no ${street.name}`,
    );
  }
});

test("modo mão exata preserva o resultado de AsQs contra JhJd", () => {
  const result = calculateEquity({
    hero: cards("As", "Qs"),
    villain: cards("Jh", "Jd"),
    board: cards(...HERO_VS_RANGE_FLOP),
  });

  assert.equal(result.method, "exact");
  assert.deepEqual(
    { heroWins: result.heroWins, villainWins: result.villainWins, ties: result.ties, total: result.total },
    { heroWins: 539, villainWins: 451, ties: 0, total: 990 },
  );
  assert.equal(result.heroEquity, 49 / 90);
});

test("exemplo JJ contra AK recalcula corretamente no flop, turn e river", () => {
  const hero = cards("Js", "Jh");
  const villain = cards("Ac", "Kd");
  const flop = calculateEquity({ hero, villain, board: cards("8s", "9c", "Th") });
  const turn = calculateEquity({ hero, villain, board: cards("8s", "9c", "Th", "2d") });
  const river = calculateEquity({ hero, villain, board: cards("8s", "9c", "Th", "2d", "Ah") });

  assert.deepEqual(
    { wins: flop.heroWins, losses: flop.villainWins, ties: flop.ties, total: flop.total },
    { wins: 785, losses: 197, ties: 8, total: 990 },
  );
  assert.equal(flop.heroEquity, 263 / 330);
  assert.deepEqual(
    { wins: turn.heroWins, losses: turn.villainWins, ties: turn.ties, total: turn.total },
    { wins: 38, losses: 6, ties: 0, total: 44 },
  );
  assert.equal(turn.heroEquity, 19 / 22);
  assert.equal(river.heroEquity, 0);

  const decision = deriveStreetDecision({
    startingPot: "4000",
    villainAction: "bet",
    betAmount: "2000",
    heroAction: "call",
  });
  assert.equal(decision.requiredEquity, 0.25);
  assert.ok(decision.potBeforeCall !== null && decision.callAmount !== null);
  assert.ok(calculateCallEV(flop.heroEquity, decision.potBeforeCall, decision.callAmount) > 0);
});

test("equity exata contra range alimenta pot odds, margem e EV do call", () => {
  const result = calculateEquity({
    hero: cards("As", "Qs"),
    villain: [],
    villainRange: [...HERO_VS_RANGE_FIXTURE],
    board: cards(...HERO_VS_RANGE_FLOP),
  });
  const requiredEquity = calculateRequiredEquity(30, 10);
  const margin = result.heroEquity - requiredEquity;
  const callEV = calculateCallEV(result.heroEquity, 30, 10);

  assert.equal(requiredEquity, 0.25);
  assert.ok(Math.abs(result.heroEquity - 29_797 / 65_340) < 1e-15);
  assert.ok(Math.abs(margin - 6_731 / 32_670) < 1e-15);
  assert.ok(Math.abs(callEV - 26_924 / 3_267) < 1e-12);
  assert.ok(margin > 0);
  assert.ok(callEV > 0);
});

test("resultado visual de Pot Odds exibe a equity do range e o EV do call", () => {
  const heroEquity = 29_797 / 65_340;
  const html = renderToStaticMarkup(createElement(PotOddsCalculator, {
    heroEquity,
    equityResult: {
      heroWins: 456,
      villainWins: 544,
      ties: 0,
      total: 1000,
      heroWinRate: heroEquity,
      villainWinRate: 1 - heroEquity,
      tieRate: 0,
      heroEquity,
      villainEquity: 1 - heroEquity,
      outs: null,
      outsOwner: null,
      method: "exact",
    },
    street: "flop",
    startingPot: "20",
    betAmount: "10",
    unit: "BB",
    onStartingPotChange: () => undefined,
    onBetAmountChange: () => undefined,
    onUnitChange: () => undefined,
  }));

  assert.match(html, /Pot Odds/);
  assert.match(html, /Flop/);
  assert.match(html, /Pote antes da aposta do Vilão/);
  assert.match(html, /Aposta que você está enfrentando/);
  assert.match(html, /Pote antes do call/);
  assert.match(html, /45,6%/);
  assert.match(html, /25,0%/);
  assert.match(html, /\+20,6/);
  assert.match(html, /EV do call/);
  assert.match(html, /\+8,24 BB/);
  assert.match(html, /CALL \+EV/);
  assert.match(html, /Outs/);
  assert.match(html, /Vitória/);
  assert.match(html, /Derrota/);
  assert.doesNotMatch(html, /Vitória Hero/);
});

test("experiência integrada renderiza equity e pot odds lado a lado sem fluxo de ações", () => {
  const html = renderToStaticMarkup(createElement(PokerToolsExperience));

  assert.match(html, /Calculadora de Equity/);
  assert.match(html, /SELECIONAR CARTAS/);
  assert.match(html, /Pot Odds/);
  assert.match(html, /Pote antes da aposta do Vilão/);
  assert.match(html, /Análise da decisão/);
  assert.match(html, /Comparação automática/);
  assert.match(html, /Equity necessária/);
  assert.match(html, /EV do call/);
  assert.doesNotMatch(html, /equity-cards-summary/);
  assert.doesNotMatch(html, /Resumo rápido/);
  assert.doesNotMatch(html, /Etapas da mão/);
  assert.doesNotMatch(html, /Linha da mão/);
});

test("equity rejeita range sem combinações disponíveis", () => {
  assert.throws(() => calculateEquity({
    hero: cards("As", "Ah"),
    villain: [],
    villainRange: ["AA"],
    board: cards("Ad", "Ac", "2s"),
  }), /nenhuma combinação/i);
});
