import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MAX_EXERCISE_QUEUE_SIZE, buildExerciseQueue, buildRangeMatrix, evaluateChoice, presentStrategy, rangeActionShares, resolvedActionLabel, sameQueueEntry, type QueueEntry, type TrainingAction } from "../lib/training";

const entries: QueueEntry[] = [
  { trainingSetId: "set-a", trainingNodeId: "btn", trainingHandId: "a7s" },
  { trainingSetId: "set-a", trainingNodeId: "co", trainingHandId: "kto" },
  { trainingSetId: "set-b", trainingNodeId: "hj", trainingHandId: "22" },
  { trainingSetId: "set-b", trainingNodeId: "sb", trainingHandId: "qjs" },
];

test("fila atende 20, 50 e 100 perguntas sem repetir dentro de cada ciclo", () => {
  for (const target of [20, 50, 100]) {
    const queue = buildExerciseQueue(entries, target, seededRandom(target));
    assert.equal(queue.length, target);
    for (let offset = 0; offset < queue.length; offset += entries.length) {
      const cycle = queue.slice(offset, offset + entries.length);
      assert.equal(new Set(cycle.map(key)).size, cycle.length);
      if (offset > 0) assert.equal(sameQueueEntry(queue[offset - 1], queue[offset]), false);
    }
  }
});

test("treino livre começa com um ciclo completo e mistura nodes", () => {
  const queue = buildExerciseQueue(entries, null, seededRandom(7));
  assert.equal(queue.length, entries.length);
  assert.equal(new Set(queue.map(key)).size, entries.length);
  assert.ok(queue.some((entry, index) => index > 0 && entry.trainingNodeId !== queue[index - 1].trainingNodeId));
});

test("fila limita treino livre e rejeita alvos acima de 100", () => {
  const manyEntries: QueueEntry[] = Array.from({ length: 10_000 }, (_, index) => ({
    trainingSetId: "set",
    trainingNodeId: `node-${index}`,
    trainingHandId: `hand-${index}`,
  }));
  const freeQueue = buildExerciseQueue(manyEntries, null, seededRandom(42));
  assert.equal(freeQueue.length, MAX_EXERCISE_QUEUE_SIZE);
  assert.equal(new Set(freeQueue.map(key)).size, MAX_EXERCISE_QUEUE_SIZE);
  assert.throws(() => buildExerciseQueue(manyEntries, MAX_EXERCISE_QUEUE_SIZE + 1), /entre 1 e 100/);
});

test("treinar novamente não reutiliza uma ordem idêntica", () => {
  const first = buildExerciseQueue(entries, 20, () => 0);
  const second = buildExerciseQueue(entries, 20, () => 0, first);
  assert.notDeepEqual(second, first);
  assert.equal(second.length, first.length);
});

test("avaliação mantém best_action e rejeita ações inexistentes", () => {
  const actions: TrainingAction[] = [{ id: "fold", type: "FOLD" }, { id: "shove", type: "RAISE", amountBb: 10 }];
  assert.equal(evaluateChoice("shove", actions, "shove", { fold: 0, shove: 2 })?.correct, true);
  assert.equal(evaluateChoice("fold", actions, "shove", { fold: 0, shove: 2 })?.correct, false);
  assert.equal(evaluateChoice("call", actions, "shove", { fold: 0, shove: 2 }), null);
});

test("converte identificadores HRC nos nomes reais das ações", () => {
  const actions: TrainingAction[] = [{ id: "action-0", type: "FOLD" }, { id: "action-1", type: "CALL" }, { id: "action-2", type: "RAISE", amountBb: 6 }];
  const context = { heroStackBb: 20, trainingType: "VS_OPEN" as const };
  assert.equal(resolvedActionLabel("action-0", actions, context), "Fold");
  assert.equal(resolvedActionLabel({ id: "action-1", type: "CALL" }, actions, context), "Call");
  assert.equal(resolvedActionLabel("action-2", actions, context), "3-bet 6 BB");
});

test("avaliação aceita toda ação com frequência relevante em mixed strategies", () => {
  const actions: TrainingAction[] = [{ id: "fold", type: "FOLD" }, { id: "shove", type: "RAISE", amountBb: 10 }];
  const evs = { fold: 0.9, shove: 1 };
  assert.equal(evaluateChoice("fold", actions, "shove", evs, { fold: 0.4, shove: 0.6 })?.correct, true, "a alternativa de 40% pertence ao mix");
  assert.equal(evaluateChoice("shove", actions, "shove", evs, { fold: 0.4, shove: 0.6 })?.correct, true);
  assert.equal(evaluateChoice("fold", actions, "shove", evs, { fold: 0.049, shove: 0.951 })?.correct, false, "frequência abaixo do limiar continua sendo erro");
  assert.equal(evaluateChoice("fold", actions, "shove", evs)?.correct, false, "estudos legados sem estratégia usam best_action como fallback");
});

test("mixed strategy usa a escala do vetor inteiro e respeita a borda de 5%", () => {
  const actions: TrainingAction[] = [{ id: "fold", type: "FOLD" }, { id: "shove", type: "RAISE", amountBb: 10 }];
  const evs = { fold: 1, shove: 0.9 };

  const onePercent = presentStrategy({ fold: 99, shove: 1 }, actions);
  assert.deepEqual(onePercent.actions.map((item) => item.frequencyPercent), [99, 1]);
  assert.equal(onePercent.actions[1].isInStrategy, false);
  assert.equal(evaluateChoice("shove", actions, "fold", evs, { fold: 99, shove: 1 })?.correct, false);

  const fivePercent = presentStrategy({ fold: 95, shove: 5 }, actions);
  assert.deepEqual(fivePercent.actions.map((item) => item.frequencyPercent), [95, 5]);
  assert.equal(fivePercent.actions[1].isInStrategy, true);
  assert.equal(evaluateChoice("shove", actions, "fold", evs, { fold: 95, shove: 5 })?.correct, true);

  const fractionalFivePercent = presentStrategy({ fold: 0.95, shove: 0.05 }, actions);
  assert.deepEqual(fractionalFivePercent.actions.map((item) => item.frequencyPercent), [95, 5]);
  assert.equal(evaluateChoice("shove", actions, "fold", evs, { fold: 0.95, shove: 0.05 })?.correct, true);
});

test("avaliação não usa estratégia legada incompleta ou com soma inválida", () => {
  const actions: TrainingAction[] = [{ id: "fold", type: "FOLD" }, { id: "raise", type: "RAISE" }];
  assert.equal(evaluateChoice("fold", actions, "raise", { fold: 0, raise: 1 }, { fold: 0.4 })?.correct, false);
  assert.equal(evaluateChoice("fold", actions, "raise", { fold: 0, raise: 1 }, { fold: 0.8, raise: 0.8 })?.correct, false);
});

test("configuração pública contém somente os cinco campos pedidos", async () => {
  const source = await readFile(new URL("../app/training-experience.tsx", import.meta.url), "utf8");
  for (const label of ["Tipo de treinamento", "Modelo", "Stack efetivo", "Posição do Hero", "Quantidade de mãos"]) assert.match(source, new RegExp(label));
  for (const removed of ["<label>Mesa</label>", "<label>Sequência</label>", "<label>Dificuldade</label>", "<label>Blinds do estudo</label>"]) assert.doesNotMatch(source, new RegExp(escapeRegExp(removed)));
  assert.ok((source.match(/label: "Todas"/g) ?? []).length >= 2, "stack e posição devem oferecer Todas");
});

test("apresenta estratÃ©gias puras e mistas sem depender da regra binÃ¡ria de score", () => {
  const actions: TrainingAction[] = [{ id: "fold", type: "FOLD" }, { id: "shove", type: "RAISE", amountBb: 10 }];
  const pureFold = presentStrategy({ fold: 1, shove: 0 }, actions);
  assert.equal(pureFold.isMixed, false);
  assert.equal(pureFold.dominantAction?.key, "fold");
  assert.equal(pureFold.actions[0].frequencyPercent, 100);
  assert.equal(pureFold.actions[1].isInStrategy, false);

  const pureShove = presentStrategy({ fold: 0, shove: 100 }, actions);
  assert.equal(pureShove.isMixed, false);
  assert.equal(pureShove.dominantAction?.key, "shove");

  const sixtyForty = presentStrategy({ fold: 0.4, shove: 0.6 }, actions);
  assert.equal(sixtyForty.isMixed, true);
  assert.deepEqual(sixtyForty.actions.map((item) => item.frequencyPercent), [40, 60]);

  const fiftyFifty = presentStrategy({ fold: 0.5, shove: 0.5 }, actions);
  assert.equal(fiftyFifty.isMixed, true);
  assert.ok(fiftyFifty.actions.every((item) => item.isInStrategy));
});

test("monta a matriz tradicional de Hold'em com 169 classes", () => {
  const matrix = buildRangeMatrix();
  assert.equal(matrix.length, 169);
  assert.equal(matrix.filter((cell) => cell.pair).length, 13);
  assert.equal(matrix.filter((cell) => cell.suited).length, 78);
  assert.equal(matrix.filter((cell) => cell.offsuit).length, 78);
  assert.deepEqual(matrix.filter((cell) => cell.pair).map((cell) => cell.handClass), ["AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55", "44", "33", "22"]);
  assert.equal(matrix.find((cell) => cell.row === 0 && cell.column === 1)?.handClass, "AKs");
  assert.equal(matrix.find((cell) => cell.row === 1 && cell.column === 0)?.handClass, "AKo");
});

test("calcula a proporção exata entre ação e fold para a cor do range", () => {
  const actions: TrainingAction[] = [{ id: "fold", type: "FOLD" }, { id: "shove", type: "RAISE", amountBb: 10 }];
  assert.deepEqual(rangeActionShares({ fold: 0.3, shove: 0.7 }, actions), {
    actionPercent: 70,
    foldPercent: 30,
    totalPercent: 100,
    hasData: true,
  });
  assert.deepEqual(rangeActionShares({ fold: 100, shove: 0 }, actions), {
    actionPercent: 0,
    foldPercent: 100,
    totalPercent: 100,
    hasData: true,
  });
  assert.equal(rangeActionShares({}, actions).hasData, false);
});

test("cliente restaura sessão ativa e envia índice estável para retries", async () => {
  const [workspace, trainer] = await Promise.all([
    readFile(new URL("../app/treinar/training-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/training-experience.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /\/api\/training\/session\?active=1/);
  assert.match(workspace, /rangelab:last-training-session/);
  assert.match(workspace, /\/api\/training\/session\?id=/, "refresh da última resposta deve recuperar também o relatório encerrado");
  assert.match(trainer, /questionIndex:\s*answeredQuestions/);
});

function key(entry: QueueEntry) { return `${entry.trainingNodeId}:${entry.trainingHandId}`; }
function seededRandom(seed: number) { let value = seed >>> 0; return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 0x100000000; }; }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
