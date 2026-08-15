import assert from "node:assert/strict";
import test from "node:test";
import { buildProgressDashboard, calculateAnswerEvLossBb, type ProgressAnswerRecord, type ProgressSessionRecord } from "../lib/progress";

test("calcula EV perdido com os EVs HRC armazenados e converte para BB", () => {
  assert.equal(calculateAnswerEvLossBb({
    equityModel: "CHIP_EV",
    evUnit: "CHIPS",
    selectedAction: { id: "action-0", type: "FOLD" },
    bestAction: "action-1",
    evs: { "action-0": -20, "action-1": 20 },
    bigBlind: 100,
  }), 0.4);
  assert.equal(calculateAnswerEvLossBb({
    equityModel: "CHIP_EV",
    evUnit: "CHIPS",
    selectedAction: { id: "action-1", type: "CALL" },
    bestAction: "action-1",
    evs: { "action-0": -20, "action-1": 20 },
    bigBlind: 100,
  }), 0);
  assert.equal(calculateAnswerEvLossBb({
    equityModel: "CHIP_EV",
    evUnit: "CHIPS",
    selectedAction: { id: "action-0", type: "FOLD" },
    bestAction: "action-1",
    evs: { "action-0": -20 },
    bigBlind: 100,
  }), null);
  assert.equal(calculateAnswerEvLossBb({
    equityModel: "ICM",
    evUnit: "ICM_UTILITY",
    selectedAction: { id: "action-0", type: "FOLD" },
    bestAction: "action-1",
    evs: { "action-0": -20, "action-1": 20 },
    bigBlind: 100,
  }), null, "EV de ICM não pode ser convertido para BB sem contrato de unidade");
  assert.equal(calculateAnswerEvLossBb({
    equityModel: "CHIP_EV",
    evUnit: "BIG_BLINDS",
    selectedAction: { id: "action-0", type: "FOLD" },
    bestAction: "action-1",
    evs: { "action-0": -0.2, "action-1": 0.2 },
    bigBlind: 100,
  }), 0.4, "EV já expresso em BB não pode ser dividido novamente pelo blind");
  assert.equal(calculateAnswerEvLossBb({
    equityModel: "CHIP_EV",
    evUnit: "UNKNOWN",
    selectedAction: { id: "action-0", type: "FOLD" },
    bestAction: "action-1",
    evs: { "action-0": -20, "action-1": 20 },
    bigBlind: 100,
  }), null, "unidade não verificada deve permanecer indisponível");
});

test("mantém métricas sem base matemática como indisponíveis", () => {
  const dashboard = buildProgressDashboard([], [], Date.UTC(2026, 7, 9));
  assert.equal(dashboard.summary.hands, 0);
  assert.equal(dashboard.summary.accuracy, null);
  assert.equal(dashboard.summary.evEfficiency, null);
  assert.equal(dashboard.summary.evLossBb, null);
  assert.deepEqual(dashboard.weakSpots, []);
  assert.deepEqual(dashboard.costlySpots, []);
});

test("ordena LJ entre UTG+1 e HJ no progresso por posição", () => {
  const now = Date.UTC(2026, 7, 9);
  const positions = ["HJ", "LJ", "UTG+1"];
  const answers: ProgressAnswerRecord[] = positions.map((heroPosition, index) => ({
    sessionId: "session-positions",
    trainingType: "OPEN_FOLD",
    equityModel: "CHIP_EV",
    evUnit: "CHIPS",
    trainingNodeId: `node-${index}`,
    handClass: "A7o",
    heroPosition,
    stackBb: 10,
    selectedAction: { id: "action-1", type: "RAISE" },
    bestAction: "action-1",
    isCorrect: true,
    evs: { "action-1": 10 },
    bigBlind: 100,
    answeredAt: now - index,
  }));

  const dashboard = buildProgressDashboard([], answers, now);
  assert.deepEqual(dashboard.performance.position.map((item) => item.label), ["UTG+1", "LJ", "HJ"]);
});

test("exige amostra mínima e ordena spots pelo EV efetivamente perdido", () => {
  const now = Date.UTC(2026, 7, 9);
  const session: ProgressSessionRecord = {
    id: "session-1",
    trainingType: "PUSH_FOLD",
    playersCount: 8,
    stackBb: 10,
    heroPosition: "BTN",
    correctAnswers: 0,
    totalAnswers: 5,
    durationSeconds: 120,
    startedAt: now - 1_000,
    endedAt: now,
  };
  const answers: ProgressAnswerRecord[] = Array.from({ length: 5 }, (_, index) => ({
    sessionId: session.id,
    trainingType: "PUSH_FOLD",
    equityModel: "CHIP_EV",
    evUnit: "CHIPS",
    trainingNodeId: "node-1",
    handClass: "A7o",
    heroPosition: "BTN",
    stackBb: 10,
    selectedAction: { id: "action-0", type: "FOLD" },
    bestAction: "action-1",
    isCorrect: false,
    evs: { "action-0": -20, "action-1": 20 },
    bigBlind: 100,
    answeredAt: now - index,
  }));
  const dashboard = buildProgressDashboard([session], answers, now);

  assert.equal(dashboard.summary.evLossBb, 2);
  assert.equal(dashboard.weakSpots.length, 1);
  assert.equal(dashboard.weakSpots[0].hands, 5);
  assert.equal(dashboard.weakSpots[0].accuracy, 0);
  assert.equal(dashboard.costlySpots[0].evLossBb, 2);
  assert.equal(dashboard.latestSessions[0].evLossBb, 2);
});

test("expõe explicitamente quando os limites de memória truncam o histórico", () => {
  const coverage = {
    sessionsReturned: 1_000,
    answersReturned: 10_000,
    sessionLimit: 1_000,
    answerLimit: 10_000,
    sessionsTruncated: true,
    answersTruncated: true,
  };
  const dashboard = buildProgressDashboard([], [], Date.UTC(2026, 7, 9), coverage);
  assert.deepEqual(dashboard.coverage, coverage);
});
