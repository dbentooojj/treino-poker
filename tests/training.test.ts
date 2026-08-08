import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildExerciseQueue, evaluateChoice, sameQueueEntry, type QueueEntry, type TrainingAction } from "../lib/training";

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

test("configuração pública contém somente os cinco campos pedidos", async () => {
  const source = await readFile(new URL("../app/training-experience.tsx", import.meta.url), "utf8");
  for (const label of ["Tipo de treinamento", "Modelo", "Stack efetivo", "Posição do Hero", "Quantidade de mãos"]) assert.match(source, new RegExp(label));
  for (const removed of ["<label>Mesa</label>", "<label>Sequência</label>", "<label>Dificuldade</label>", "<label>Blinds do estudo</label>"]) assert.doesNotMatch(source, new RegExp(escapeRegExp(removed)));
  assert.ok((source.match(/label: "Todas"/g) ?? []).length >= 2, "stack e posição devem oferecer Todas");
});

function key(entry: QueueEntry) { return `${entry.trainingNodeId}:${entry.trainingHandId}`; }
function seededRandom(seed: number) { let value = seed >>> 0; return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 0x100000000; }; }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
