import assert from "node:assert/strict";
import test from "node:test";
import type { HrcStudyImport } from "../lib/hrc-import";
import { DuplicateHrcStudyError, persistHrcStudy } from "../db/study-import";

test("impede a reimportação do mesmo hash antes de criar qualquer registro", async () => {
  const db = new FakeD1("Estudo já salvo");
  await assert.rejects(
    persistHrcStudy(db as unknown as D1Database, study(), "admin-1"),
    (error: unknown) => error instanceof DuplicateHrcStudyError && /já foi importado/.test(error.message),
  );
  assert.equal(db.batchCalls, 0);
  assert.equal(db.committedStatements.length, 0);
});

test("não deixa dados parciais quando o lote transacional falha", async () => {
  const db = new FakeD1(null, new Error("falha simulada na estratégia"));
  await assert.rejects(
    persistHrcStudy(db as unknown as D1Database, study(), "admin-1"),
    /falha simulada na estratégia/,
  );
  assert.equal(db.batchCalls, 1);
  assert.equal(db.committedStatements.length, 0);
});

test("persiste estudo, nodes e mãos no mesmo lote", async () => {
  const db = new FakeD1();
  const result = await persistHrcStudy(db as unknown as D1Database, study(), "admin-1");
  assert.equal(result.spotCount, 1);
  assert.equal(db.batchCalls, 1);
  assert.equal(db.committedStatements.length, 3);
  assert.match(db.committedStatements[0].sql, /INSERT INTO training_sets/);
  assert.match(db.committedStatements[1].sql, /INSERT INTO training_nodes/);
  assert.match(db.committedStatements[2].sql, /INSERT INTO training_hands/);
});

function study(): HrcStudyImport {
  return {
    name: "HRC 2-max 10bb",
    contentHash: "a".repeat(64),
    archiveSizeBytes: 1_024,
    equityModel: "CHIP_EV",
    playersCount: 2,
    stackBb: 10,
    smallBlind: 50,
    bigBlind: 100,
    ante: 0,
    anteType: "NONE",
    icmContext: null,
    metadata: { sourceFormat: "HRC_COMPLETE_EXPORT" },
    nodes: [{
      nodeKey: "nodes/0.json",
      trainingType: "PUSH_FOLD",
      heroPosition: "SB",
      heroStackBb: 10,
      villainPosition: null,
      actionSequence: [],
      availableActions: [{ id: "action-0", type: "FOLD" }, { id: "action-1", type: "RAISE", amountBb: 10, label: "All-in" }],
      hands: [{
        handClass: "AA",
        strategy: { "action-0": 0, "action-1": 1 },
        evs: { "action-0": 0, "action-1": 2.5 },
        bestAction: "action-1",
        decisionClarity: 2.5,
        isMixed: false,
        metadata: { hrcWeight: 1 },
      }],
      metadata: { hrcNodeSource: "nodes/0.json" },
    }],
  };
}

class FakeD1 {
  batchCalls = 0;
  committedStatements: FakeStatement[] = [];

  constructor(private readonly existingName: string | null = null, private readonly batchError: Error | null = null) {}

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  async batch(statements: FakeStatement[]) {
    this.batchCalls++;
    if (this.batchError) throw this.batchError;
    this.committedStatements = [...statements];
    return statements.map(() => ({ success: true }));
  }

  firstResult(sql: string) {
    return /SELECT name FROM training_sets/.test(sql) && this.existingName ? { name: this.existingName } : null;
  }
}

class FakeStatement {
  params: unknown[] = [];

  constructor(private readonly db: FakeD1, readonly sql: string) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T>() {
    return this.db.firstResult(this.sql) as T | null;
  }
}
