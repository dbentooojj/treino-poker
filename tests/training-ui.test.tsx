import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ProgressExperience from "../app/progresso/progress-experience";
import { TrainingReportView } from "../app/training-experience";
import { TrainingDecision } from "../components/training/TrainingDecision";
import {
  buildTrainingPrompt,
  sequenceActionLabel,
  trainingTableSeats,
} from "../components/training/trainingPresentation";
import { positionNames } from "../lib/hrc-import";
import { buildProgressDashboard } from "../lib/progress";
import type { TrainingAction, TrainingExercise } from "../lib/training";

const fold: TrainingAction = { id: "fold", type: "FOLD" };
const call: TrainingAction = { id: "call", type: "CALL" };
const threeBet: TrainingAction = { id: "three-bet", type: "RAISE", amountBb: 6.6 };
const allIn: TrainingAction = { id: "all-in", type: "RAISE", amountBb: 20, label: "All-in" };

test("a mesa usa as mesmas posições produzidas pelo importador HRC", () => {
  for (const playersCount of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const expected = positionNames(playersCount);
    const seats = trainingTableSeats(playersCount, expected.at(-1)!);
    assert.deepEqual(seats.map((seat) => seat.position), expected);
    assert.equal(seats.length, playersCount);
  }

  const headsUp = trainingTableSeats(2, "BB");
  assert.equal(headsUp[0].position, "SB");
  assert.equal(headsUp[0].label, "BTN/SB");
  assert.equal(headsUp[0].dealer, true);
});

test("pergunta e histórico derivam posição, ação e sizing da mesma sequência", () => {
  const exercise = makeExercise(2, [fold, call, threeBet, allIn]);
  assert.equal(buildTrainingPrompt(exercise), "BTN/SB abriu 2.2 BB. Você está no BB. Qual é sua resposta?");
  assert.equal(sequenceActionLabel(exercise.actionSequence[0], 0, exercise.actionSequence), "raise 2.2 BB");

  const reraised = [
    exercise.actionSequence[0],
    { position: "BB", type: "RAISE" as const, amountBb: 6.6 },
  ];
  assert.equal(sequenceActionLabel(reraised[1], 1, reraised), "3-bet 6.6 BB");
});

test("renderiza grades de 2, 3 e 4 ações sem assumir uma combinação fixa", () => {
  const actionSets = [
    [fold, allIn],
    [fold, call, allIn],
    [fold, call, threeBet, allIn],
  ];

  for (const actions of actionSets) {
    const markup = renderToStaticMarkup(<TrainingDecision exercise={makeExercise(2, actions)} busy={false} onChoose={() => undefined}/>);
    assert.match(markup, new RegExp(`rl-decision-actions actions-${actions.length}`));
    assert.equal((markup.match(/<button/g) ?? []).length, actions.length);
  }
});

test("renderiza a quantidade correta de seats em heads-up, 6-max e 9-max", () => {
  for (const playersCount of [2, 6, 9]) {
    const heroPosition = positionNames(playersCount).at(-1)!;
    const markup = renderToStaticMarkup(<TrainingDecision exercise={makeExercise(playersCount, [fold, allIn], heroPosition)} busy={false} onChoose={() => undefined}/>);
    assert.match(markup, new RegExp(`rl-poker-arena players-${playersCount}`));
    assert.equal((markup.match(/rl-table-seat/g) ?? []).length, playersCount);
  }
});

test("sinaliza limites de memória sem rotular a amostra como histórico completo", () => {
  const data = buildProgressDashboard([], [], Date.UTC(2026, 7, 9), {
    sessionsReturned: 1_000,
    answersReturned: 10_000,
    sessionLimit: 1_000,
    answerLimit: 10_000,
    sessionsTruncated: true,
    answersTruncated: true,
  });
  const markup = renderToStaticMarkup(<ProgressExperience data={data}/>);
  assert.match(markup, /Janela recente limitada a/);
  assert.match(markup, /Mãos na janela/);
  assert.match(markup, />Janela<\/button>/);
  assert.doesNotMatch(markup, />Todos<\/button>/);
});

test("relatório diferencia totais completos de detalhes recentes limitados", () => {
  const markup = renderToStaticMarkup(<TrainingReportView report={{
    sessionId: "session",
    detailsAvailable: true,
    detailsTruncated: true,
    detailAnswers: 1_000,
    completionReason: "USER_FINISHED",
    trainingType: "PUSH_FOLD",
    equityModel: "CHIP_EV",
    stackDepthBb: 10,
    heroPosition: "BTN",
    targetQuestions: null,
    answeredQuestions: 1_001,
    correctAnswers: 999,
    errors: 2,
    accuracy: 100,
    durationSeconds: 1_001,
    averageSeconds: 1,
    byPosition: [],
    byDecisionType: [],
    mostMissedHands: [],
    errorDetails: [],
    feedback: [],
  }} onExit={() => undefined} onStarted={() => undefined}/>);
  assert.match(markup, /Os totais cobrem a sessão completa/);
  assert.match(markup, /Revisar erros recentes \(até 100\)/);
});

function makeExercise(playersCount: number, availableActions: TrainingAction[], heroPosition = "BB"): TrainingExercise {
  return {
    trainingSetId: "set",
    trainingNodeId: "node",
    trainingHandId: "hand",
    setName: "Test",
    handClass: "88",
    trainingType: "VS_OPEN",
    equityModel: "CHIP_EV",
    evUnit: "UNKNOWN",
    playersCount,
    heroStackBb: 20,
    heroPosition,
    villainPosition: playersCount === 2 ? "SB" : "BTN",
    blinds: { smallBlind: 0.5, bigBlind: 1, ante: 0, anteType: "NONE" },
    actionSequence: [{ position: playersCount === 2 ? "SB" : "BTN", type: "RAISE", amountBb: 2.2 }],
    availableActions,
  };
}
