import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL é obrigatória para os testes PostgreSQL.");

const databaseName = `rangelab_test_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
const adminUrl = new URL(baseUrl);
adminUrl.pathname = "/postgres";
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${databaseName}`;
const admin = postgres(adminUrl.toString(), { max: 1 });

test("fluxo PostgreSQL completo preserva integridade, publicação e isolamento", async (context) => {
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  process.env.DATABASE_URL = testUrl.toString();
  process.env.APP_BASE_URL = "http://localhost";

  const { closeDb, getDb, getSqlClient } = await import("../db/index");
  context.after(async () => {
    await closeDb();
    await admin.unsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}'`);
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  });

  await migrate(getDb(), { migrationsFolder: "drizzle" });
  const sqlClient = getSqlClient();
  const [{ count: migrationCount }] = await sqlClient<{ count: number }[]>`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
  assert.equal(migrationCount, 2, "as migrations devem ser aplicadas");

  const [{ data_type: hashType }] = await sqlClient<{ data_type: string }[]>`
    SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'training_sets' AND column_name = 'content_hash'`;
  assert.equal(hashType, "text", "content_hash deve existir");

  const { registerUser, authenticateUser, createSession } = await import("../db/auth");
  const adminUser = await registerUser("Admin", "admin@example.com", "Senha forte 123!");
  assert.equal(adminUser.role, "admin");
  assert.equal((await authenticateUser("ADMIN@example.com", "Senha forte 123!"))?.id, adminUser.id, "deve criar e ler usuários");
  const login = await createSession(adminUser.id, false);

  const zip = zipFile("study.zip", "A7s", 2.5);
  const formData = new FormData();
  formData.set("file", zip);
  const { POST: importStudyRoute } = await import("../app/api/studies/import/route");
  const response = await importStudyRoute(new Request("http://localhost/api/studies/import", {
    method: "POST",
    headers: { cookie: `rangelab_session=${login.token}`, origin: "http://localhost" },
    body: formData,
  }));
  const imported = await response.json() as { study: { id: string; status: string; isPublished: boolean }; error?: string };
  assert.equal(response.status, 201, imported.error);
  assert.equal(response.headers.get("location"), null, "a importação administrativa não deve redirecionar");
  assert.equal(imported.study.status, "IMPORTED");
  assert.equal(imported.study.isPublished, false);

  const counts = await entityCounts(sqlClient);
  assert.deepEqual(counts, { sets: 1, nodes: 1, hands: 1, sessions: 0 }, "o ZIP deve criar set/node/hand e nenhuma sessão");

  const duplicateForm = new FormData();
  duplicateForm.set("file", zip);
  const duplicateResponse = await importStudyRoute(new Request("http://localhost/api/studies/import", {
    method: "POST",
    headers: { cookie: `rangelab_session=${login.token}`, origin: "http://localhost" },
    body: duplicateForm,
  }));
  assert.equal(duplicateResponse.status, 409, "o mesmo SHA-256 deve ser bloqueado pelo índice unique");
  assert.deepEqual(await entityCounts(sqlClient), counts, "a duplicidade não pode criar dados parciais");

  await assert.rejects(
    sqlClient`INSERT INTO training_nodes (id, training_set_id, node_key, training_type, hero_position, hero_stack_bb, action_sequence, available_actions, metadata)
      VALUES (${crypto.randomUUID()}, ${crypto.randomUUID()}, 'orphan', 'PUSH_FOLD', 'BTN', 10, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)`,
    hasPostgresCode("23503"),
    "a FK de node deve rejeitar training_set inexistente",
  );
  await assert.rejects(
    sqlClient`INSERT INTO training_hands (id, training_node_id, hand_class, strategy, evs, metadata)
      VALUES (${crypto.randomUUID()}, ${crypto.randomUUID()}, 'AA', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
    hasPostgresCode("23503"),
    "a FK de mão deve rejeitar node inexistente",
  );

  const { parseHrcPack, toHrcStudyImport } = await import("../lib/hrc-import");
  const rollbackStudy = toHrcStudyImport(await parseHrcPack(zipFile("rollback.zip", "KQs", 7.5)));
  rollbackStudy.contentHash = "b".repeat(64);
  rollbackStudy.nodes[0].hands.push({ ...rollbackStudy.nodes[0].hands[0], id: undefined } as never);
  const { persistHrcStudy } = await import("../db/study-import");
  await assert.rejects(persistHrcStudy(rollbackStudy, adminUser.id), hasPostgresCode("23505"));
  const [{ count: rolledBack }] = await sqlClient<{ count: number }[]>`SELECT count(*)::int AS count FROM training_sets WHERE content_hash = ${rollbackStudy.contentHash}`;
  assert.equal(rolledBack, 0, "uma falha em training_hands deve reverter set e nodes");

  const { actionKey } = await import("../lib/training");
  const { answerTrainingSession, createTrainingSession, finishTrainingSession, getTrainingOptions } = await import("../db/training");
  const config = {
    trainingType: "PUSH_FOLD" as const,
    equityModel: "CHIP_EV" as const,
    stackDepthBb: 10,
    heroPosition: "SB",
    targetQuestions: 20,
  };
  assert.equal((await getTrainingOptions(config)).hasMatches, false, "estudo importado não deve aparecer ao aluno");

  const { setStudyPublished } = await import("../db/studies");
  assert.equal(await setStudyPublished(imported.study.id, true), true);
  const publishedOptions = await getTrainingOptions(config);
  assert.equal(publishedOptions.hasMatches, true, "estudo publicado deve aparecer nos filtros");
  assert.deepEqual(publishedOptions.trainingTypes, ["PUSH_FOLD"]);

  const secondStudy = toHrcStudyImport(await parseHrcPack(zipFile("second.zip", "A7s", 99)));
  secondStudy.contentHash = "c".repeat(64);
  secondStudy.name = "Segundo conjunto isolado";
  const second = await persistHrcStudy(secondStudy, adminUser.id);
  await setStudyPublished(second.id, true);

  const trainingSession = await createTrainingSession(adminUser.id, { mode: "START", config });
  const [savedSession] = await sqlClient<{ training_set_id: string | null; exercise_queue: Array<{ trainingSetId: string; trainingNodeId: string; trainingHandId: string }> }[]>`
    SELECT training_set_id, exercise_queue FROM training_sessions WHERE id = ${trainingSession.id}`;
  assert.equal(savedSession.training_set_id, null, "filtros amplos não devem escolher um único estudo arbitrariamente");
  assert.deepEqual(new Set(savedSession.exercise_queue.map((entry) => entry.trainingSetId)), new Set([imported.study.id, second.id]), "a fila deve combinar todos os estudos publicados elegíveis");
  for (let index = 1; index < savedSession.exercise_queue.length; index++) {
    assert.notDeepEqual(savedSession.exercise_queue[index], savedSession.exercise_queue[index - 1], "a combinação node + hand não deve repetir na fronteira de ciclos");
  }

  const raiseAction = trainingSession.exercise.availableActions.find((action) => action.type === "RAISE")!;
  let answered = await answerTrainingSession(adminUser.id, {
    sessionId: trainingSession.id,
    trainingNodeId: trainingSession.exercise.trainingNodeId,
    trainingHandId: trainingSession.exercise.trainingHandId,
    selectedAction: actionKey(raiseAction),
  });
  assert.equal(answered.answer.correct, true, "o backend deve calcular o acerto a partir do estudo");
  while (!answered.report) {
    const exercise = answered.nextExercise!;
    const action = exercise.availableActions.find((candidate) => candidate.type === "RAISE")!;
    answered = await answerTrainingSession(adminUser.id, { sessionId: trainingSession.id, trainingNodeId: exercise.trainingNodeId, trainingHandId: exercise.trainingHandId, selectedAction: actionKey(action) });
  }
  assert.equal(answered.report.completionReason, "COMPLETED", "20 respostas devem encerrar automaticamente");
  assert.equal(answered.report.answeredQuestions, 20);
  assert.equal(answered.report.correctAnswers, 20);
  assert.equal(answered.report.byPosition[0].accuracy, 100);
  const [{ answer_count: answerCount }] = await sqlClient<{ answer_count: number }[]>`SELECT count(*)::int AS answer_count FROM training_answers WHERE training_session_id = ${trainingSession.id}`;
  assert.equal(answerCount, 20, "cada resposta deve gerar um registro individual");

  const repeated = await createTrainingSession(adminUser.id, { mode: "REPEAT", sourceSessionId: trainingSession.id });
  const [repeatedRow] = await sqlClient<{ exercise_queue: typeof savedSession.exercise_queue }[]>`SELECT exercise_queue FROM training_sessions WHERE id = ${repeated.id}`;
  assert.notDeepEqual(repeatedRow.exercise_queue, savedSession.exercise_queue, "treinar novamente deve criar uma nova ordem");

  const freeSession = await createTrainingSession(adminUser.id, { mode: "START", config: { ...config, targetQuestions: null } });
  const foldAction = freeSession.exercise.availableActions.find((action) => action.type === "FOLD")!;
  const wrong = await answerTrainingSession(adminUser.id, { sessionId: freeSession.id, trainingNodeId: freeSession.exercise.trainingNodeId, trainingHandId: freeSession.exercise.trainingHandId, selectedAction: actionKey(foldAction) });
  assert.equal(wrong.report, null, "treino livre não deve encerrar automaticamente");
  const freeReport = await finishTrainingSession(adminUser.id, freeSession.id);
  assert.equal(freeReport.completionReason, "USER_FINISHED");
  assert.equal(freeReport.errors, 1);
  const review = await createTrainingSession(adminUser.id, { mode: "REVIEW_ERRORS", sourceSessionId: freeSession.id });
  assert.equal(review.targetQuestions, 1);
  assert.equal(review.exercise.trainingNodeId, freeSession.exercise.trainingNodeId);
  assert.equal(review.exercise.trainingHandId, freeSession.exercise.trainingHandId);
  await assert.rejects(createTrainingSession(adminUser.id, { mode: "REVIEW_ERRORS", sourceSessionId: trainingSession.id }), /Nenhum erro/);

  const [lineage] = await sqlClient<{ set_name: string; hero_position: string; hand_class: string; strategy: Record<string, number>; evs: Record<string, number> }[]>`
    SELECT s.name AS set_name, n.hero_position, h.hand_class, h.strategy, h.evs
    FROM training_sets s JOIN training_nodes n ON n.training_set_id = s.id JOIN training_hands h ON h.training_node_id = n.id
    WHERE s.id = ${imported.study.id} AND h.hand_class = 'A7s'`;
  assert.equal(lineage.hero_position, "SB");
  assert.equal(lineage.evs["action-1"], 2.5, "a linhagem set → node → hand deve ser consultável");
});

async function entityCounts(sqlClient: postgres.Sql) {
  const [row] = await sqlClient<{ sets: number; nodes: number; hands: number; sessions: number }[]>`
    SELECT
      (SELECT count(*)::int FROM training_sets) AS sets,
      (SELECT count(*)::int FROM training_nodes) AS nodes,
      (SELECT count(*)::int FROM training_hands) AS hands,
      (SELECT count(*)::int FROM training_sessions) AS sessions`;
  return row;
}

function hasPostgresCode(code: string) {
  return (error: unknown) => {
    let current: unknown = error;
    for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
      if ("code" in current && (current as { code?: unknown }).code === code) return true;
      current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
    }
    return false;
  };
}

function zipFile(name: string, handClass: string, bestEv: number) {
  const settings = {
    handdata: { stacks: [1_000, 1_000], blinds: [100, 50, 10], skipSb: false, movingBu: true, anteType: "BB Ante" },
    eqmodel: { id: "chipEV", raked: false },
  };
  const node = {
    player: 0,
    street: 0,
    children: 2,
    sequence: [],
    actions: [{ type: "F", amount: 0 }, { type: "R", amount: 1_000 }],
    hands: { [handClass]: { weight: 1, played: [0, 1], evs: [0, bestEv] } },
  };
  return new File([createZip({ "settings.json": JSON.stringify(settings), "nodes/0.json": JSON.stringify(node) })], name, { type: "application/zip" });
}

function createZip(entries: Record<string, string>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const [name, source] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(source);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    localParts.push(local);
    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, localOffset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    localOffset += local.length;
  }
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, centralParts.length, true);
  eocdView.setUint16(10, centralParts.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, localOffset, true);
  return concat([...localParts, ...centralParts, eocd]);
}

function concat(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
