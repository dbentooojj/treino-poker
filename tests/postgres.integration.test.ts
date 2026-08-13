import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

  await proveHistoricalSessionUpgrade(admin, baseUrl);

  await migrate(getDb(), { migrationsFolder: "drizzle" });
  const sqlClient = getSqlClient();
  const [{ count: migrationCount }] = await sqlClient<{ count: number }[]>`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
  assert.equal(migrationCount, 7, "as migrations devem ser aplicadas");

  const [{ data_type: hashType }] = await sqlClient<{ data_type: string }[]>`
    SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'training_sets' AND column_name = 'content_hash'`;
  assert.equal(hashType, "text", "content_hash deve existir");

  const { registerUser, createInitialAdmin, authenticateUser, createSession, createPasswordReset, resetPassword } = await import("../db/auth");
  const subtle = crypto.subtle;
  const previousDeriveBitsDescriptor = Object.getOwnPropertyDescriptor(subtle, "deriveBits");
  const originalDeriveBits = subtle.deriveBits.bind(subtle);
  let deriveBitsCalls = 0;
  const countingDeriveBits: typeof subtle.deriveBits = (algorithm, baseKey, length) => {
    deriveBitsCalls++;
    return originalDeriveBits(algorithm, baseKey, length);
  };
  Object.defineProperty(subtle, "deriveBits", { configurable: true, value: countingDeriveBits });
  try {
    assert.equal(await resetPassword("A".repeat(43), "Senha forte 123!"), false);
    assert.equal(deriveBitsCalls, 0, "token inexistente deve ser consultado antes de executar PBKDF2");
  } finally {
    if (previousDeriveBitsDescriptor) Object.defineProperty(subtle, "deriveBits", previousDeriveBitsDescriptor);
    else Reflect.deleteProperty(subtle, "deriveBits");
  }
  const publicUser = await registerUser("Primeiro cadastro", "first@example.com", "Senha forte 123!");
  assert.equal(publicUser.role, "user", "o primeiro cadastro público nunca pode receber privilégios administrativos");
  const adminUser = await createInitialAdmin("Admin", "admin@example.com", "Senha forte 123!");
  assert.equal(adminUser.role, "admin", "o provisionamento operacional explícito deve criar o primeiro admin");
  await assert.rejects(
    createInitialAdmin("Outro admin", "other-admin@example.com", "Senha forte 123!"),
    /ADMIN_ALREADY_EXISTS/,
    "o bootstrap deve ser de uso único",
  );
  assert.equal((await authenticateUser("ADMIN@example.com", "Senha forte 123!"))?.id, adminUser.id, "deve criar e ler usuários");
  const login = await createSession(adminUser.id, false);

  const previousEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    APP_BASE_URL: process.env.APP_BASE_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
  };
  const previousFetch = globalThis.fetch;
  try {
    const mutableEnvironment = process.env as Record<string, string | undefined>;
    mutableEnvironment.NODE_ENV = "production";
    mutableEnvironment.APP_BASE_URL = "https://app.example.test";
    mutableEnvironment.RESEND_API_KEY = "test-resend-key";
    mutableEnvironment.EMAIL_FROM = "RangeLab <recovery@example.test>";
    const sentMessages: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      sentMessages.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    const { POST: recoverRoute } = await import("../app/api/auth/recover/route");
    const recover = (email: string, clientHeaders: Record<string, string> = {}) => recoverRoute(new Request("https://app.example.test/api/auth/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "https://app.example.test", ...clientHeaders },
      body: JSON.stringify({ email }),
    }));
    const existingRecovery = await recover(adminUser.email);
    const missingRecovery = await recover("missing@example.test");
    assert.equal(existingRecovery.status, 202);
    assert.equal(missingRecovery.status, 202);
    assert.deepEqual(await existingRecovery.json(), await missingRecovery.json(), "recuperação não pode enumerar contas pelo corpo/status");
    assert.equal(existingRecovery.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(sentMessages.length, 1, "somente uma conta existente deve acionar o provedor");
    assert.equal(sentMessages[0].from, process.env.EMAIL_FROM, "o envio deve usar a variável EMAIL_FROM documentada");

    globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
    const providerFailure = await recover(publicUser.email);
    assert.equal(providerFailure.status, 202, "falha do provedor não pode revelar que a conta existe");
    assert.deepEqual(await providerFailure.json(), { ok: true });

    const recoverRateStatuses = [];
    for (let index = 0; index < 6; index++) {
      const limited = await recover(`missing-rate-${index}@example.test`, {
        "x-forwarded-for": "198.51.100.20",
        "cf-connecting-ip": `203.0.113.${index + 1}`,
      });
      recoverRateStatuses.push(limited.status);
    }
    assert.deepEqual(recoverRateStatuses, [202, 202, 202, 202, 202, 429], "trocar e-mail ou CF-Connecting-IP não pode contornar o limite por IP");
  } finally {
    globalThis.fetch = previousFetch;
    const mutableEnvironment = process.env as Record<string, string | undefined>;
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete mutableEnvironment[name];
      else mutableEnvironment[name] = value;
    }
  }

  const { POST: resetRoute } = await import("../app/api/auth/reset/route");
  const resetRateStatuses = [];
  for (let index = 0; index < 6; index++) {
    const invalidToken = `${String(index).padStart(2, "0")}${"A".repeat(41)}`;
    const limited = await resetRoute(new Request("http://localhost/api/auth/reset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost",
        "x-forwarded-for": "198.51.100.21",
        "cf-connecting-ip": `203.0.113.${index + 20}`,
      },
      body: JSON.stringify({ token: invalidToken, password: "Senha renovada 456!" }),
    }));
    resetRateStatuses.push(limited.status);
  }
  assert.deepEqual(resetRateStatuses, [400, 400, 400, 400, 400, 429], "trocar token ou CF-Connecting-IP não pode contornar o limite por IP");

  const concurrentResetTokens = await Promise.all([
    createPasswordReset(publicUser.email),
    createPasswordReset(publicUser.email),
  ]);
  assert.ok(concurrentResetTokens.every(Boolean));
  const [{ count: activeResetTokens }] = await sqlClient<{ count: number }[]>`
    SELECT count(*)::int AS count FROM password_reset_tokens WHERE user_id = ${publicUser.id}`;
  assert.equal(activeResetTokens, 1, "duas recuperações concorrentes devem deixar somente o link mais recente ativo");
  const resetResults = [];
  for (const token of concurrentResetTokens) resetResults.push(await resetPassword(token!, "Senha renovada 456!"));
  assert.equal(resetResults.filter(Boolean).length, 1, "somente um dos links concorrentes pode redefinir a senha");
  const [{ count: remainingResetTokens }] = await sqlClient<{ count: number }[]>`
    SELECT count(*)::int AS count FROM password_reset_tokens WHERE user_id = ${publicUser.id}`;
  assert.equal(remainingResetTokens, 0, "um reset consumido deve invalidar todos os tokens do usuário");

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
  assert.deepEqual(counts, { sets: 1, nodes: 2, hands: 338, sessions: 0 }, "cada node importado deve preservar as 169 classes canônicas");

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

  const reimportStudy = toHrcStudyImport(await parseHrcPack(zipFile("reimport.zip", "KJs", 4.5)));
  reimportStudy.contentHash = "e".repeat(64);
  reimportStudy.name = "Estudo para reimportar";
  const archivedVersion = await persistHrcStudy(reimportStudy, adminUser.id);
  await sqlClient`UPDATE training_sets SET status = 'ARCHIVED', is_published = false, published_at = NULL WHERE id = ${archivedVersion.id}`;
  const replacementVersion = await persistHrcStudy(reimportStudy, adminUser.id);
  assert.notEqual(replacementVersion.id, archivedVersion.id, "a versão validada deve preservar o estudo arquivado");
  await assert.rejects(persistHrcStudy(reimportStudy, adminUser.id), /já foi importado/, "uma versão ativa continua protegida contra duplicação");
  const [{ archived, active }] = await sqlClient<{ archived: number; active: number }[]>`
    SELECT count(*) FILTER (WHERE status = 'ARCHIVED')::int AS archived,
      count(*) FILTER (WHERE status <> 'ARCHIVED')::int AS active
    FROM training_sets WHERE content_hash = ${reimportStudy.contentHash}`;
  assert.deepEqual({ archived, active }, { archived: 1, active: 1 });

  const { actionKey } = await import("../lib/training");
  const { answerTrainingSession, createTrainingSession, finishTrainingSession, getTrainingOptions, getTrainingReport } = await import("../db/training");
  const legacySummaryId = crypto.randomUUID();
  await sqlClient`INSERT INTO training_sessions
    (id, user_id, training_set_id, training_type, equity_model, players_count, stack_bb, hero_position,
      correct_answers, answered_questions, exercise_queue, queue_position, duration_seconds, started_at, ended_at,
      completion_reason, answer_details_available)
    VALUES (${legacySummaryId}, ${adminUser.id}, ${imported.study.id}, 'PUSH_FOLD', 'CHIP_EV', 2, 10, 'SB',
      6, 10, '[]'::jsonb, 0, 50, now() - interval '50 seconds', now(), 'USER_FINISHED', false)`;
  const legacySummary = await getTrainingReport(adminUser.id, legacySummaryId);
  assert.equal(legacySummary.detailsAvailable, false);
  assert.deepEqual(
    { answered: legacySummary.answeredQuestions, correct: legacySummary.correctAnswers, errors: legacySummary.errors, accuracy: legacySummary.accuracy },
    { answered: 10, correct: 6, errors: 4, accuracy: 60 },
    "o relatório legado deve usar os contadores preservados em vez de fabricar zero respostas",
  );
  assert.deepEqual(legacySummary.errorDetails, []);
  assert.match(legacySummary.feedback[0], /Resumo histórico/);
  await assert.rejects(createTrainingSession(adminUser.id, { mode: "REVIEW_ERRORS", sourceSessionId: legacySummaryId }), /detalhes por mão/);
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

  const anySession = await createTrainingSession(adminUser.id, { mode: "START", config: { ...config, trainingType: null, targetQuestions: 1 } });
  assert.equal(anySession.config.trainingType, null, "Any deve criar uma sessão sem restringir o tipo de spot");
  assert.equal(anySession.exercise.trainingType, "PUSH_FOLD", "a pergunta continua preservando sua categoria real");
  await finishTrainingSession(adminUser.id, anySession.id);

  await sqlClient`UPDATE training_hands SET strategy = '{"action-0":0.4,"action-1":0.6}'::jsonb, is_mixed = true
    WHERE training_node_id IN (SELECT id FROM training_nodes WHERE training_set_id = ${imported.study.id})`;
  const mixedSession = await createTrainingSession(adminUser.id, { mode: "START", config: { ...config, targetQuestions: 1 } });
  const mixedFold = mixedSession.exercise.availableActions.find((action) => action.type === "FOLD")!;
  const mixedAnswer = await answerTrainingSession(adminUser.id, {
    sessionId: mixedSession.id,
    questionIndex: 0,
    trainingNodeId: mixedSession.exercise.trainingNodeId,
    trainingHandId: mixedSession.exercise.trainingHandId,
    selectedAction: actionKey(mixedFold),
  });
  assert.equal(mixedAnswer.answer.correct, true, "uma ação usada 40% pelo solver deve ser persistida como correta");
  assert.equal(mixedAnswer.report?.correctAnswers, 1, "o contador da sessão deve refletir a aderência ao mix");
  const [savedMixedAnswer] = await sqlClient<{ is_correct: boolean }[]>`SELECT is_correct FROM training_answers WHERE training_session_id = ${mixedSession.id}`;
  assert.equal(savedMixedAnswer.is_correct, true, "o snapshot da resposta mixed não pode entrar na revisão de erros");
  const replayedMixedAnswer = await answerTrainingSession(adminUser.id, {
    sessionId: mixedSession.id,
    questionIndex: 0,
    trainingNodeId: mixedSession.exercise.trainingNodeId,
    trainingHandId: mixedSession.exercise.trainingHandId,
    selectedAction: actionKey(mixedFold),
  });
  assert.equal(replayedMixedAnswer.replayed, true, "retry pós-commit deve reproduzir a resposta mesmo após o encerramento automático");
  const [{ count: mixedAnswerCount }] = await sqlClient<{ count: number }[]>`SELECT count(*)::int AS count FROM training_answers WHERE training_session_id = ${mixedSession.id}`;
  assert.equal(mixedAnswerCount, 1, "retry idempotente não pode inserir nem incrementar novamente");
  const mixedRaise = mixedSession.exercise.availableActions.find((action) => action.type === "RAISE")!;
  await assert.rejects(answerTrainingSession(adminUser.id, {
    sessionId: mixedSession.id,
    questionIndex: 0,
    trainingNodeId: mixedSession.exercise.trainingNodeId,
    trainingHandId: mixedSession.exercise.trainingHandId,
    selectedAction: actionKey(mixedRaise),
  }), /outra pergunta ou ação/, "o mesmo índice com payload conflitante deve ser recusado");
  await assert.rejects(createTrainingSession(adminUser.id, { mode: "REVIEW_ERRORS", sourceSessionId: mixedSession.id }), /Nenhum erro/);
  await sqlClient`UPDATE training_sessions SET equity_model = 'ICM' WHERE id = ${mixedSession.id}`;
  const { getProgressDashboard } = await import("../db/progress");
  const icmProgress = await getProgressDashboard(adminUser.id);
  assert.equal(icmProgress.summary.evLossBb, null, "o progresso não pode rotular EV ICM como BB");
  await sqlClient`UPDATE training_sessions SET equity_model = 'CHIP_EV' WHERE id = ${mixedSession.id}`;
  await sqlClient`UPDATE training_hands SET strategy = '{"action-0":0,"action-1":1}'::jsonb, is_mixed = false
    WHERE training_node_id IN (SELECT id FROM training_nodes WHERE training_set_id = ${imported.study.id})`;

  const concurrentSession = await createTrainingSession(adminUser.id, { mode: "START", config: { ...config, targetQuestions: 1 } });
  const concurrentRaise = concurrentSession.exercise.availableActions.find((action) => action.type === "RAISE")!;
  const concurrentInput = {
    sessionId: concurrentSession.id,
    questionIndex: 0,
    trainingNodeId: concurrentSession.exercise.trainingNodeId,
    trainingHandId: concurrentSession.exercise.trainingHandId,
    selectedAction: actionKey(concurrentRaise),
  };
  const concurrentResults = await Promise.all([
    answerTrainingSession(adminUser.id, concurrentInput),
    answerTrainingSession(adminUser.id, concurrentInput),
  ]);
  assert.deepEqual(concurrentResults.map((result) => result.replayed).sort(), [false, true], "duas respostas simultâneas idênticas devem produzir um commit e um replay");
  assert.ok(concurrentResults.every((result) => result.answeredQuestions === 1 && result.correctAnswers === 1 && result.report?.answeredQuestions === 1), "o replay concorrente deve observar os contadores após o commit");
  const [{ count: concurrentAnswerCount }] = await sqlClient<{ count: number }[]>`SELECT count(*)::int AS count FROM training_answers WHERE training_session_id = ${concurrentSession.id}`;
  assert.equal(concurrentAnswerCount, 1, "retry concorrente deve preservar uma única resposta");

  const concurrentStarts = await Promise.all([
    createTrainingSession(adminUser.id, { mode: "START", config: { ...config, targetQuestions: 1 } }),
    createTrainingSession(adminUser.id, { mode: "START", config: { ...config, targetQuestions: 1 } }),
  ]);
  assert.equal(concurrentStarts[0].id, concurrentStarts[1].id, "POSTs concorrentes equivalentes devem convergir para uma única sessão ativa");
  const [{ count: activeSessionCount }] = await sqlClient<{ count: number }[]>`SELECT count(*)::int AS count FROM training_sessions WHERE user_id = ${adminUser.id} AND ended_at IS NULL`;
  assert.equal(activeSessionCount, 1);
  await finishTrainingSession(adminUser.id, concurrentStarts[0].id);

  const secondStudy = toHrcStudyImport(await parseHrcPack(zipFile("second.zip", "A7s", 99)));
  secondStudy.contentHash = "c".repeat(64);
  secondStudy.name = "Segundo conjunto isolado";
  const second = await persistHrcStudy(secondStudy, adminUser.id);
  await sqlClient`UPDATE training_sets SET display_order = 10 WHERE id = ${second.id}`;
  await setStudyPublished(second.id, true);

  const trainingSession = await createTrainingSession(adminUser.id, { mode: "START", config });
  const [savedSession] = await sqlClient<{ training_set_id: string | null; players_count: number | null; exercise_queue: Array<{ trainingSetId: string; trainingNodeId: string; trainingHandId: string }> }[]>`
    SELECT training_set_id, players_count, exercise_queue FROM training_sessions WHERE id = ${trainingSession.id}`;
  assert.equal(savedSession.training_set_id, imported.study.id, "a sessão deve fixar o estudo publicado de maior prioridade");
  assert.equal(savedSession.players_count, 2, "o contexto da mesa deve vir do estudo fixado");
  assert.deepEqual(new Set(savedSession.exercise_queue.map((entry) => entry.trainingSetId)), new Set([imported.study.id]), "a fila não pode misturar estudos elegíveis");
  for (let index = 1; index < savedSession.exercise_queue.length; index++) {
    assert.notDeepEqual(savedSession.exercise_queue[index], savedSession.exercise_queue[index - 1], "a combinação node + hand não deve repetir na fronteira de ciclos");
  }

  assert.equal("nodeRange" in trainingSession, false, "a sessÃ£o inicial nÃ£o pode entregar a soluÃ§Ã£o do node");
  assert.equal("strategy" in trainingSession.exercise, false, "o exercÃ­cio inicial nÃ£o pode entregar frequÃªncias antes da resposta");
  const outOfTurn = savedSession.exercise_queue.find((entry) => entry.trainingHandId !== trainingSession.exercise.trainingHandId);
  assert.ok(outOfTurn, "a sessÃ£o de teste precisa conter outro exercício");
  await assert.rejects(answerTrainingSession(adminUser.id, {
    sessionId: trainingSession.id,
    questionIndex: 0,
    trainingNodeId: outOfTurn.trainingNodeId,
    trainingHandId: outOfTurn.trainingHandId,
    selectedAction: "action-1",
  }), /pergunta atual/, "nÃ£o deve ser possÃ­vel usar ANSWER para obter o range de outro node");

  const raiseAction = trainingSession.exercise.availableActions.find((action) => action.type === "RAISE")!;
  let answered = await answerTrainingSession(adminUser.id, {
    sessionId: trainingSession.id,
    questionIndex: 0,
    trainingNodeId: trainingSession.exercise.trainingNodeId,
    trainingHandId: trainingSession.exercise.trainingHandId,
    selectedAction: actionKey(raiseAction),
  });
  assert.equal(answered.answer.correct, true, "o backend deve calcular o acerto a partir do estudo");
  assert.equal(answered.nodeRange.trainingSetId, trainingSession.exercise.trainingSetId, "o snapshot do range deve pertencer ao mesmo study set");
  assert.equal(answered.nodeRange.trainingNodeId, trainingSession.exercise.trainingNodeId, "o snapshot do range deve pertencer ao mesmo node respondido");
  assert.ok(answered.nodeRange.hands.every((hand) => hand.evs && "decisionClarity" in hand), "o range deve preservar EV e clareza de cada mão importada do HRC");
  const { getActiveTrainingSession } = await import("../db/training");
  const resumedSession = await getActiveTrainingSession(adminUser.id, trainingSession.id);
  assert.equal(resumedSession?.answeredQuestions, 1, "a retomada deve preservar os contadores após refresh");
  assert.equal(resumedSession?.exercise.trainingHandId, answered.nextExercise?.trainingHandId, "a retomada deve entregar exatamente a pergunta corrente");
  const { GET: getTrainingSessionRoute } = await import("../app/api/training/session/route");
  const resumeResponse = await getTrainingSessionRoute(new Request("http://localhost/api/training/session?active=1", {
    headers: { cookie: `rangelab_session=${login.token}` },
  }));
  const resumePayload = await resumeResponse.json() as { session: { id: string; answeredQuestions: number } | null };
  assert.equal(resumeResponse.status, 200);
  assert.equal(resumePayload.session?.id, trainingSession.id, "GET active deve restaurar a sessão mais recente do usuário");
  assert.equal(resumePayload.session?.answeredQuestions, 1);
  while (!answered.report) {
    const exercise = answered.nextExercise!;
    const action = exercise.availableActions.find((candidate) => candidate.type === "RAISE")!;
    answered = await answerTrainingSession(adminUser.id, { sessionId: trainingSession.id, questionIndex: answered.answeredQuestions, trainingNodeId: exercise.trainingNodeId, trainingHandId: exercise.trainingHandId, selectedAction: actionKey(action) });
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
  assert.deepEqual(new Set(repeatedRow.exercise_queue.map((entry) => entry.trainingSetId)), new Set([imported.study.id]), "repetir deve preservar o estudo original");
  await finishTrainingSession(adminUser.id, repeated.id);

  const freeSession = await createTrainingSession(adminUser.id, { mode: "START", config: { ...config, targetQuestions: null } });
  const [freeQueueSize] = await sqlClient<{ size: number }[]>`SELECT jsonb_array_length(exercise_queue)::int AS size FROM training_sessions WHERE id = ${freeSession.id}`;
  assert.equal(freeQueueSize.size, 100, "treino livre deve persistir somente uma janela limitada de exercícios");
  const foldAction = freeSession.exercise.availableActions.find((action) => action.type === "FOLD")!;
  const wrong = await answerTrainingSession(adminUser.id, { sessionId: freeSession.id, questionIndex: 0, trainingNodeId: freeSession.exercise.trainingNodeId, trainingHandId: freeSession.exercise.trainingHandId, selectedAction: actionKey(foldAction) });
  assert.equal(wrong.report, null, "treino livre não deve encerrar automaticamente");
  const freeReport = await finishTrainingSession(adminUser.id, freeSession.id);
  assert.equal(freeReport.completionReason, "USER_FINISHED");
  assert.equal(freeReport.errors, 1);
  await setStudyPublished(imported.study.id, false);
  await assert.rejects(createTrainingSession(adminUser.id, { mode: "REVIEW_ERRORS", sourceSessionId: freeSession.id }), /não está mais disponível/, "despublicar um estudo deve revogar novas filas de revisão");
  await setStudyPublished(imported.study.id, true);
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

async function proveHistoricalSessionUpgrade(adminClient: postgres.Sql, sourceUrl: string) {
  const upgradeDatabaseName = `rangelab_upgrade_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const upgradeUrl = new URL(sourceUrl);
  upgradeUrl.pathname = `/${upgradeDatabaseName}`;
  await adminClient.unsafe(`CREATE DATABASE "${upgradeDatabaseName}"`);
  const upgrade = postgres(upgradeUrl.toString(), { max: 1 });

  const userId = "10000000-0000-4000-8000-000000000001";
  const setId = "20000000-0000-4000-8000-000000000001";
  const nodeId = "30000000-0000-4000-8000-000000000001";
  const handId = "40000000-0000-4000-8000-000000000001";
  const legacyEndedId = "50000000-0000-4000-8000-000000000001";
  const legacyOpenId = "50000000-0000-4000-8000-000000000002";
  const legacyEmptyId = "50000000-0000-4000-8000-000000000003";
  const modernMixedId = "60000000-0000-4000-8000-000000000001";
  const modernBoundedId = "60000000-0000-4000-8000-000000000002";
  const partialLedgerId = "60000000-0000-4000-8000-000000000003";
  const invalidStrategyId = "60000000-0000-4000-8000-000000000004";
  const interMigrationInvalidId = "60000000-0000-4000-8000-000000000005";
  const malformedQueueId = "60000000-0000-4000-8000-000000000006";
  const unresolvedQueueId = "60000000-0000-4000-8000-000000000007";
  const oversizedQueue = Array.from({ length: 150 }, (_, index) => ({
    trainingSetId: setId,
    trainingNodeId: nodeId,
    trainingHandId: handId,
    fixtureIndex: index,
  }));

  try {
    await applyMigrationSql(upgrade, new URL("../drizzle/0000_sudden_human_fly.sql", import.meta.url));
    await upgrade`INSERT INTO users (id, name, email, password_hash, password_salt, password_iterations, role)
      VALUES (${userId}, 'Legacy', 'legacy-upgrade@example.test', 'hash', 'salt', 1, 'user')`;
    await upgrade`INSERT INTO training_sets (id, name, content_hash, equity_model, players_count, small_blind, big_blind, metadata)
      VALUES (${setId}, 'Legacy set', ${"d".repeat(64)}, 'CHIP_EV', 2, 0.5, 1, '{"validationVersion":2}'::jsonb)`;
    await upgrade`INSERT INTO training_nodes (id, training_set_id, node_key, training_type, hero_position, hero_stack_bb, action_sequence, available_actions)
      VALUES (${nodeId}, ${setId}, 'root', 'PUSH_FOLD', 'SB', 10, '[]'::jsonb, '[{"id":"fold","type":"FOLD"},{"id":"raise","type":"RAISE"}]'::jsonb)`;
    await upgrade`INSERT INTO training_hands (id, training_node_id, hand_class, strategy, evs, best_action)
      VALUES (${handId}, ${nodeId}, 'AA', '{"fold":0.4,"raise":0.6}'::jsonb, '{"fold":0,"raise":1}'::jsonb, 'raise')`;
    await upgrade`INSERT INTO training_sessions
      (id, user_id, training_set_id, training_type, equity_model, players_count, stack_bb, hero_position, correct_answers, total_answers, duration_seconds, started_at, ended_at)
      VALUES
      (${legacyEndedId}, ${userId}, ${setId}, 'PUSH_FOLD', 'CHIP_EV', 2, 10, 'SB', 6, 10, 120, '2026-01-01T10:00:00Z', '2026-01-01T10:02:00Z'),
      (${legacyOpenId}, ${userId}, ${setId}, 'PUSH_FOLD', 'CHIP_EV', 2, 10, 'SB', 2, 3, 45, '2026-01-02T10:00:00Z', NULL),
      (${legacyEmptyId}, ${userId}, ${setId}, 'PUSH_FOLD', 'CHIP_EV', 2, 10, 'SB', 0, 0, 0, '2026-01-03T10:00:00Z', '2026-01-03T10:00:00Z')`;

    await applyMigrationSql(upgrade, new URL("../drizzle/0001_perpetual_squirrel_girl.sql", import.meta.url));
    await upgrade`INSERT INTO training_sessions
      (id, user_id, training_set_id, training_type, equity_model, players_count, stack_bb, hero_position, correct_answers, answered_questions, target_questions, exercise_queue, queue_position, duration_seconds, started_at)
      VALUES
      (${modernMixedId}, ${userId}, ${setId}, 'PUSH_FOLD', 'CHIP_EV', 2, 10, 'SB', 0, 1, 1, ${upgrade.json(oversizedQueue)}, 1, 12, '2026-02-01T10:00:00Z'),
      (${modernBoundedId}, ${userId}, ${setId}, 'PUSH_FOLD', 'CHIP_EV', 2, 10, 'SB', 0, 0, 101, ${upgrade.json(oversizedQueue)}, 0, 5, '2026-02-02T10:00:00Z'),
      (${partialLedgerId}, ${userId}, ${setId}, 'PUSH_FOLD', 'CHIP_EV', 2, 10, 'SB', 6, 10, NULL, ${upgrade.json(oversizedQueue.slice(0, 10))}, 10, 60, '2026-02-03T10:00:00Z'),
      (${invalidStrategyId}, ${userId}, ${setId}, 'PUSH_FOLD', 'CHIP_EV', 2, 10, 'SB', 0, 1, NULL, ${upgrade.json(oversizedQueue.slice(0, 1))}, 1, 10, '2026-02-04T10:00:00Z')`;
    await upgrade`UPDATE training_sessions SET ended_at = '2026-02-03T10:01:00Z', completion_reason = 'USER_FINISHED' WHERE id = ${partialLedgerId}`;
    await upgrade`UPDATE training_sessions SET ended_at = '2026-02-04T10:00:10Z', completion_reason = 'USER_FINISHED' WHERE id = ${invalidStrategyId}`;
    await upgrade`INSERT INTO training_answers
      (id, training_session_id, training_set_id, training_node_id, training_hand_id, question_index, hand_class, hero_position, stack_bb, selected_action, best_action, is_correct, strategy, evs)
      VALUES
      (${crypto.randomUUID()}, ${modernMixedId}, ${setId}, ${nodeId}, ${handId}, 0, 'AA', 'SB', 10, '{"id":"fold","type":"FOLD"}'::jsonb, 'raise', false, '{"fold":0.4,"raise":0.6}'::jsonb, '{"fold":0,"raise":1}'::jsonb),
      (${crypto.randomUUID()}, ${partialLedgerId}, ${setId}, ${nodeId}, ${handId}, 0, 'AA', 'SB', 10, '{"id":"fold","type":"FOLD"}'::jsonb, 'raise', false, '{"fold":0.4,"raise":0.6}'::jsonb, '{"fold":0,"raise":1}'::jsonb),
      (${crypto.randomUUID()}, ${invalidStrategyId}, ${setId}, ${nodeId}, ${handId}, 0, 'AA', 'SB', 10, '{"id":"fold","type":"FOLD"}'::jsonb, 'raise', false, '{"fold":1}'::jsonb, '{"fold":0,"raise":1}'::jsonb)`;

    await applyMigrationSql(upgrade, new URL("../drizzle/0002_overjoyed_rage.sql", import.meta.url));
    await upgrade`INSERT INTO training_sessions
      (id, user_id, training_set_id, training_type, equity_model, players_count, stack_bb, hero_position,
        correct_answers, answered_questions, target_questions, exercise_queue, queue_position, duration_seconds, started_at)
      VALUES
        (${interMigrationInvalidId}, ${userId}, ${setId}, 'PUSH_FOLD', 'CHIP_EV', 2, 10, 'SB',
          0, 0, NULL, '[]'::jsonb, 0, 0, '2026-02-05T10:00:00Z'),
        (${malformedQueueId}, ${userId}, ${setId}, 'PUSH_FOLD', 'CHIP_EV', 2, 10, 'SB',
          0, 0, NULL, ${upgrade.json([
            { trainingSetId: setId, trainingNodeId: nodeId, trainingHandId: handId },
            { trainingSetId: setId, trainingNodeId: nodeId, trainingHandId: 42 },
          ])}, 0, 0, '2026-02-06T10:00:00Z'),
        (${unresolvedQueueId}, ${userId}, ${setId}, 'PUSH_FOLD', 'CHIP_EV', 2, 10, 'SB',
          0, 0, NULL, ${upgrade.json([{ trainingSetId: setId, trainingNodeId: nodeId, trainingHandId: "40000000-0000-4000-8000-000000000099" }])}, 0, 0, '2026-02-07T10:00:00Z')`;
    await applyMigrationSql(upgrade, new URL("../drizzle/0003_oval_glorian.sql", import.meta.url));
    await applyMigrationSql(upgrade, new URL("../drizzle/0004_young_giant_girl.sql", import.meta.url));
    await applyMigrationSql(upgrade, new URL("../drizzle/0005_quick_training_any.sql", import.meta.url));
    await applyMigrationSql(upgrade, new URL("../drizzle/0006_archived_study_reimport.sql", import.meta.url));

    const [{ is_nullable: sessionTypeNullable }] = await upgrade<{ is_nullable: string }[]>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'training_sessions' AND column_name = 'training_type'`;
    assert.equal(sessionTypeNullable, "YES", "Any exige que a sessão possa representar vários tipos de spot");

    const legacyRows = await upgrade<{ id: string; answered_questions: number; correct_answers: number; answer_details_available: boolean; ended_at: Date | null; completion_reason: string | null; target_questions: number | null; queue_size: number }[]>`
      SELECT id, answered_questions, correct_answers, answer_details_available, ended_at, completion_reason, target_questions,
        jsonb_array_length(exercise_queue)::int AS queue_size
      FROM training_sessions
      WHERE id IN (${legacyEndedId}, ${legacyOpenId}, ${legacyEmptyId})
      ORDER BY id`;
    assert.deepEqual(
      legacyRows.map((row) => ({ answered: row.answered_questions, correct: row.correct_answers })),
      [{ answered: 10, correct: 6 }, { answered: 3, correct: 2 }, { answered: 0, correct: 0 }],
      "o upgrade deve preservar os contadores que eram a única fonte histórica",
    );
    assert.ok(legacyRows.every((row) => !row.answer_details_available && row.ended_at && row.completion_reason === "USER_FINISHED"));
    assert.ok(legacyRows.every((row) => row.target_questions === null && row.queue_size === 0));
    const [{ count: syntheticAnswers }] = await upgrade<{ count: number }[]>`
      SELECT count(*)::int AS count FROM training_answers WHERE training_session_id IN (${legacyEndedId}, ${legacyOpenId}, ${legacyEmptyId})`;
    assert.equal(syntheticAnswers, 0, "a migration não pode inventar detalhes de respostas legadas");

    const [partialLedger] = await upgrade<{ answered_questions: number; correct_answers: number; answer_details_available: boolean; completion_reason: string; queue_size: number }[]>`
      SELECT answered_questions, correct_answers, answer_details_available, completion_reason,
        jsonb_array_length(exercise_queue)::int AS queue_size
      FROM training_sessions WHERE id = ${partialLedgerId}`;
    assert.deepEqual(
      { answered: partialLedger.answered_questions, correct: partialLedger.correct_answers, details: partialLedger.answer_details_available },
      { answered: 10, correct: 6, details: false },
      "ledger parcial não pode sobrescrever os únicos contadores históricos confiáveis",
    );
    assert.equal(partialLedger.completion_reason, "USER_FINISHED");
    assert.equal(partialLedger.queue_size, 0);

    const [invalidStrategyAnswer] = await upgrade<{ is_correct: boolean }[]>`
      SELECT is_correct FROM training_answers WHERE training_session_id = ${invalidStrategyId}`;
    assert.equal(invalidStrategyAnswer.is_correct, false, "backfill não pode transformar vetor incompleto em resposta mixed correta");

    const [interMigrationInvalid] = await upgrade<{ ended_at: Date | null; completion_reason: string | null }[]>`
      SELECT ended_at, completion_reason FROM training_sessions WHERE id = ${interMigrationInvalidId}`;
    assert.ok(interMigrationInvalid.ended_at);
    assert.equal(interMigrationInvalid.completion_reason, "USER_FINISHED", "0004 deve reparar filas irretomáveis inseridas sob a constraint anterior");

    const invalidCurrentItems = await upgrade<{ id: string; ended_at: Date | null; completion_reason: string | null; queue_size: number }[]>`
      SELECT id, ended_at, completion_reason, jsonb_array_length(exercise_queue)::int AS queue_size
      FROM training_sessions WHERE id IN (${malformedQueueId}, ${unresolvedQueueId}) ORDER BY id`;
    assert.equal(invalidCurrentItems.length, 2);
    assert.ok(invalidCurrentItems.every((row) => row.ended_at && row.completion_reason === "USER_FINISHED" && row.queue_size === 0), "0004 deve encerrar e limpar filas com qualquer item malformado ou sem linhagem set → node → hand");

    const [modernMixed] = await upgrade<{ answered_questions: number; correct_answers: number; answer_details_available: boolean; ended_at: Date | null; completion_reason: string | null; queue_size: number; is_correct: boolean }[]>`
      SELECT s.answered_questions, s.correct_answers, s.answer_details_available, s.ended_at, s.completion_reason,
        jsonb_array_length(s.exercise_queue)::int AS queue_size, a.is_correct
      FROM training_sessions s JOIN training_answers a ON a.training_session_id = s.id
      WHERE s.id = ${modernMixedId}`;
    assert.deepEqual(
      { answered: modernMixed.answered_questions, correct: modernMixed.correct_answers, grade: modernMixed.is_correct },
      { answered: 1, correct: 1, grade: true },
      "a migration deve reclassificar o mix pelo snapshot e reconciliar os contadores",
    );
    assert.equal(modernMixed.answer_details_available, true);
    assert.ok(modernMixed.ended_at);
    assert.equal(modernMixed.completion_reason, "COMPLETED");
    assert.equal(modernMixed.queue_size, 100);

    const [modernBounded] = await upgrade<{ target_questions: number; queue_position: number; queue_size: number; ended_at: Date | null; completion_reason: string | null; exercise_queue: typeof oversizedQueue }[]>`
      SELECT target_questions, queue_position, jsonb_array_length(exercise_queue)::int AS queue_size, ended_at, completion_reason, exercise_queue
      FROM training_sessions WHERE id = ${modernBoundedId}`;
    assert.equal(modernBounded.target_questions, 100);
    assert.equal(modernBounded.queue_size, 100);
    assert.equal(modernBounded.queue_position, 0);
    assert.equal(modernBounded.exercise_queue[0].fixtureIndex, 0, "a fila ativa deve conservar a próxima pergunta");
    assert.equal(modernBounded.ended_at, null);
    assert.equal(modernBounded.completion_reason, null);

    await assert.rejects(
      upgrade`UPDATE training_sessions SET ended_at = now(), completion_reason = NULL WHERE id = ${modernBoundedId}`,
      hasPostgresCode("23514"),
      "o schema final deve rejeitar estado terminal pela metade",
    );
    await assert.rejects(
      upgrade`UPDATE training_sessions SET exercise_queue = ${upgrade.json(oversizedQueue)} WHERE id = ${modernBoundedId}`,
      hasPostgresCode("23514"),
      "o schema final deve impedir que filas voltem a crescer acima do limite",
    );
    await assert.rejects(
      upgrade`UPDATE training_sessions SET exercise_queue = '[]'::jsonb, queue_position = 0 WHERE id = ${modernBoundedId}`,
      hasPostgresCode("23514"),
      "uma sessão ativa sempre deve possuir uma pergunta retomável",
    );
    await assert.rejects(
      upgrade`UPDATE training_sessions SET exercise_queue = '[{}]'::jsonb, queue_position = 0 WHERE id = ${modernBoundedId}`,
      hasPostgresCode("23514"),
      "o item corrente de uma sessão ativa deve possuir IDs string",
    );
  } finally {
    await upgrade.end();
    await adminClient.unsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${upgradeDatabaseName}'`);
    await adminClient.unsafe(`DROP DATABASE IF EXISTS "${upgradeDatabaseName}"`);
  }
}

async function applyMigrationSql(sqlClient: postgres.Sql, migrationUrl: URL) {
  const source = await readFile(migrationUrl, "utf8");
  await sqlClient.begin(async (transaction) => {
    for (const statement of source.split("--> statement-breakpoint")) {
      const sql = statement.trim();
      if (sql) await transaction.unsafe(sql);
    }
  });
}

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
  const allHands = integrationHands(bestEv);
  const prioritizedHands = { [handClass]: allHands[handClass], ...allHands };
  const node = {
    player: 0,
    street: 0,
    children: 2,
    sequence: [],
    actions: [{ type: "F", amount: 0 }, { type: "R", amount: 1_000 }],
    hands: prioritizedHands,
  };
  const secondNode = { ...node, hands: allHands };
  return new File([createZip({
    "settings.json": JSON.stringify(settings),
    "nodes/0.json": JSON.stringify(node),
    "nodes/1.json": JSON.stringify(secondNode),
  })], name, { type: "application/zip" });
}

function integrationHands(bestEv: number) {
  const ranks = [..."AKQJT98765432"];
  const handClasses = ranks.map((rank) => `${rank}${rank}`);
  for (let first = 0; first < ranks.length; first++) {
    for (let second = first + 1; second < ranks.length; second++) {
      handClasses.push(`${ranks[first]}${ranks[second]}s`, `${ranks[first]}${ranks[second]}o`);
    }
  }
  return Object.fromEntries(handClasses.map((currentHand) => [currentHand, { weight: 1, played: [0, 1], evs: [0, bestEv] }]));
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
