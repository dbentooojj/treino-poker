import { and, asc, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  buildExerciseQueue,
  MAX_EXERCISE_QUEUE_SIZE,
  actionAliases,
  actionKey,
  evaluateChoice,
  fisherYates,
  sameQueueEntry,
  type AnswerEvaluation,
  type NodeRange,
  type QueueEntry,
  type TrainingAction,
  type TrainingConfig,
  type TrainingExercise,
  type TrainingFilters,
  type TrainingOptions,
  type TrainingReport,
  type TrainingSequenceAction,
  type TrainingSession,
  type TrainingType,
  type EquityModel,
} from "../lib/training";
import { getDb } from "./index";
import { hasPostgresErrorCode } from "./errors";
import { trainingAnswers, trainingHands, trainingNodes, trainingSessions, trainingSets } from "./schema";

const PUBLISHED_CONDITIONS: SQL[] = [
  eq(trainingSets.gameType, "TOURNAMENT"),
  eq(trainingSets.street, "PREFLOP"),
  eq(trainingSets.status, "PUBLISHED"),
  eq(trainingSets.isPublished, true),
];
const MAX_REPORT_ANSWER_DETAILS = 1_000;

export type SessionStartRequest =
  | { mode?: "START"; config: TrainingConfig }
  | { mode: "REPEAT" | "REVIEW_ERRORS"; sourceSessionId: string };

export type AnswerTrainingInput = {
  sessionId: string;
  questionIndex: number;
  trainingNodeId: string;
  trainingHandId: string;
  selectedAction: string;
};

export class NoExercisesError extends Error {}
export class NoReviewErrorsError extends Error {}
export class TrainingSessionStateError extends Error {}

export async function getTrainingOptions(filters: TrainingFilters): Promise<TrainingOptions> {
  const trainingTypes = await distinct<TrainingType>(trainingNodes.trainingType, filters, []);
  const equityModels = await distinct<EquityModel>(trainingSets.equityModel, filters, ["trainingType"]);
  const stackDepthsBb = await distinct<number>(trainingNodes.heroStackBb, filters, ["trainingType", "equityModel"]);
  const heroPositions = await distinct<string>(trainingNodes.heroPosition, filters, ["trainingType", "equityModel", "stackDepthBb"]);
  const [match] = await getDb().select({ available: sql<number>`1` }).from(trainingHands)
    .innerJoin(trainingNodes, eq(trainingNodes.id, trainingHands.trainingNodeId))
    .innerJoin(trainingSets, eq(trainingSets.id, trainingNodes.trainingSetId))
    .where(and(...conditions(filters, ["trainingType", "equityModel", "stackDepthBb", "heroPosition"]), eligibleHandCondition()))
    .limit(1);
  return { trainingTypes, equityModels, stackDepthsBb, heroPositions: sortPositions(heroPositions), hasMatches: Boolean(match) };
}

export async function createTrainingSession(userId: string, request: SessionStartRequest): Promise<TrainingSession> {
  let config: TrainingConfig;
  let entries: QueueEntry[];
  let previousQueue: QueueEntry[] | undefined;
  let sourceSessionId: string | null = null;
  let selectedSet: { id: string; playersCount: number } | null = null;

  if (request.mode === "REPEAT" || request.mode === "REVIEW_ERRORS") {
    const source = await ownedSession(userId, request.sourceSessionId);
    if (!source) throw new TrainingSessionStateError("Sessão de origem não encontrada.");
    sourceSessionId = source.id;
    config = sessionConfig(source);
    previousQueue = source.exerciseQueue;
    if (request.mode === "REVIEW_ERRORS") {
      if (!source.answerDetailsAvailable) throw new NoReviewErrorsError("Os detalhes por mão deste resumo histórico não estão disponíveis para revisão.");
      const selectedSetId = source.trainingSetId ?? await getReviewSetId(source.id);
      if (!selectedSetId) throw new NoReviewErrorsError("Nenhum erro para revisar.");
      selectedSet = await getTrainingSetContext(selectedSetId);
      entries = await getReviewEntries(source.id, selectedSetId);
      if (!entries.length) throw new NoReviewErrorsError("Nenhum erro para revisar.");
      config = { ...config, targetQuestions: entries.length };
    } else {
      const selectedSetId = source.trainingSetId ?? source.exerciseQueue[0]?.trainingSetId;
      selectedSet = selectedSetId ? await getTrainingSetContext(selectedSetId) : await selectEligibleTrainingSet(config);
      entries = selectedSet ? await getEligibleEntries(config, selectedSet.id) : [];
    }
  } else if ("config" in request) {
    config = request.config;
    selectedSet = await selectEligibleTrainingSet(config);
    entries = selectedSet ? await getEligibleEntries(config, selectedSet.id) : [];
  } else {
    throw new TrainingSessionStateError("Configuração de sessão inválida.");
  }

  if (!entries.length) throw new NoExercisesError("Nenhum exercício disponível para estes filtros.");
  if (!selectedSet) throw new NoExercisesError("O estudo selecionado não está mais disponível.");
  const queue = buildExerciseQueue(entries, config.targetQuestions, Math.random, previousQueue);
  const exercise = await getExercise(queue[0]);
  if (!exercise) throw new NoExercisesError("O exercício selecionado não está mais disponível.");
  const id = crypto.randomUUID();
  const startedAt = new Date();
  try {
    await getDb().insert(trainingSessions).values({
      id,
      userId,
      trainingSetId: selectedSet.id,
      trainingType: config.trainingType,
      equityModel: config.equityModel,
      playersCount: selectedSet.playersCount,
      stackBb: config.stackDepthBb ?? null,
      heroPosition: config.heroPosition ?? null,
      targetQuestions: config.targetQuestions,
      exerciseQueue: queue,
      queuePosition: 0,
      sourceSessionId,
      startedAt,
    });
  } catch (error) {
    if (hasPostgresErrorCode(error, "23505")) {
      const active = await getActiveTrainingSession(userId);
      if (active && sameConfig(active.config, config)) return active;
      throw new TrainingSessionStateError("Finalize ou retome a sessão ativa antes de iniciar outra.");
    }
    throw error;
  }
  return { id, startedAt: startedAt.getTime(), config, targetQuestions: config.targetQuestions, answeredQuestions: 0, correctAnswers: 0, exercise };
}

export async function answerTrainingSession(userId: string, input: AnswerTrainingInput) {
  const recorded = await recordedAnswerResponse(userId, input);
  if (recorded) return recorded;
  const session = await ownedSession(userId, input.sessionId);
  if (!session || session.endedAt) throw new TrainingSessionStateError("Sessão encerrada ou não encontrada.");
  if (input.questionIndex !== session.answeredQuestions) throw new TrainingSessionStateError("Esta resposta não corresponde ao índice atual da sessão.");
  const entry = session.exerciseQueue[session.queuePosition];
  if (!entry || entry.trainingNodeId !== input.trainingNodeId || entry.trainingHandId !== input.trainingHandId) {
    throw new TrainingSessionStateError("Este exercício não é a pergunta atual da sessão.");
  }
  const exerciseData = await getExerciseData(entry);
  if (!exerciseData) throw new TrainingSessionStateError("Exercício não encontrado.");
  const availableActions = exerciseData.availableActions as TrainingAction[];
  const evaluation = evaluateChoice(input.selectedAction, availableActions, exerciseData.bestAction, exerciseData.evs, exerciseData.strategy);
  const nodeRange = await getNodeRange(entry);
  if (!nodeRange) throw new TrainingSessionStateError("Range do exercicio nao encontrado.");
  if (!evaluation) throw new TrainingSessionStateError("Ação indisponível para este exercício.");

  const answeredQuestions = session.answeredQuestions + 1;
  const correctAnswers = session.correctAnswers + (evaluation.correct ? 1 : 0);
  const durationSeconds = elapsedSeconds(session.startedAt);
  const completed = session.targetQuestions !== null && answeredQuestions >= session.targetQuestions;
  let nextQueue = session.exerciseQueue;
  let nextPosition = session.queuePosition + 1;

  if (!completed && nextPosition >= nextQueue.length) {
    const eligible = await getEligibleEntries(sessionConfig(session), session.trainingSetId ?? entry.trainingSetId);
    if (!eligible.length) throw new TrainingSessionStateError("Não há exercícios para continuar o treino livre.");
    nextQueue = buildExerciseQueue(eligible, null);
    if (nextQueue.length > 1 && sameQueueEntry(entry, nextQueue[0])) [nextQueue[0], nextQueue[1]] = [nextQueue[1], nextQueue[0]];
    nextPosition = 0;
  }

  try {
    await getDb().transaction(async (tx) => {
      await tx.insert(trainingAnswers).values({
        id: crypto.randomUUID(),
        trainingSessionId: session.id,
        trainingSetId: entry.trainingSetId,
        trainingNodeId: entry.trainingNodeId,
        trainingHandId: entry.trainingHandId,
        questionIndex: input.questionIndex,
        handClass: exerciseData.handClass,
        heroPosition: exerciseData.heroPosition,
        stackBb: exerciseData.heroStackBb,
        evUnit: exerciseData.evUnit,
        selectedAction: evaluation.selected,
        bestAction: evaluation.bestKey,
        isCorrect: evaluation.correct,
        strategy: exerciseData.strategy,
        evs: exerciseData.evs,
        decisionClarity: exerciseData.decisionClarity,
        isMixed: exerciseData.isMixed,
      });
      const [updated] = await tx.update(trainingSessions).set({
        answeredQuestions,
        correctAnswers,
        durationSeconds,
        exerciseQueue: nextQueue,
        queuePosition: nextPosition,
        ...(completed ? { endedAt: new Date(), completionReason: "COMPLETED" as const } : {}),
      }).where(and(
        eq(trainingSessions.id, session.id),
        eq(trainingSessions.userId, userId),
        eq(trainingSessions.queuePosition, session.queuePosition),
        isNull(trainingSessions.endedAt),
      )).returning({ id: trainingSessions.id });
      if (!updated) throw new TrainingSessionStateError("A resposta já foi registrada.");
    });
  } catch (error) {
    if (hasPostgresErrorCode(error, "23505")) {
      const replay = await recordedAnswerResponse(userId, input);
      if (replay) return replay;
    }
    throw error;
  }

  const answer: AnswerEvaluation = {
    correct: evaluation.correct,
    selectedKey: evaluation.selectedKey,
    bestKey: evaluation.bestKey,
    bestLabel: evaluation.bestLabel,
    strategy: exerciseData.strategy,
    evs: exerciseData.evs,
    decisionClarity: exerciseData.decisionClarity,
    isMixed: Boolean(exerciseData.isMixed),
  };
  if (completed) return { answer, nodeRange, answeredQuestions, correctAnswers, report: await getTrainingReport(userId, session.id), nextExercise: null, replayed: false };
  const nextExercise = await getExercise(nextQueue[nextPosition]);
  if (!nextExercise) throw new TrainingSessionStateError("Próximo exercício não encontrado.");
  return { answer, nodeRange, answeredQuestions, correctAnswers, report: null, nextExercise, replayed: false };
}

export async function getActiveTrainingSession(userId: string, sessionId?: string): Promise<TrainingSession | null> {
  const sessionConditions = [eq(trainingSessions.userId, userId), isNull(trainingSessions.endedAt)];
  if (sessionId) sessionConditions.push(eq(trainingSessions.id, sessionId));
  const [session] = await getDb().select().from(trainingSessions)
    .where(and(...sessionConditions))
    .orderBy(desc(trainingSessions.startedAt))
    .limit(1);
  if (!session) return null;
  const entry = session.exerciseQueue[session.queuePosition];
  if (!entry) throw new TrainingSessionStateError("A sessão ativa não possui uma pergunta retomável.");
  const exercise = await getExercise(entry);
  if (!exercise) throw new TrainingSessionStateError("A pergunta atual da sessão não está mais disponível.");
  return {
    id: session.id,
    startedAt: session.startedAt.getTime(),
    config: sessionConfig(session),
    targetQuestions: session.targetQuestions,
    answeredQuestions: session.answeredQuestions,
    correctAnswers: session.correctAnswers,
    exercise,
  };
}

export async function finishTrainingSession(userId: string, sessionId: string) {
  const session = await ownedSession(userId, sessionId);
  if (!session) throw new TrainingSessionStateError("Sessão não encontrada.");
  if (!session.endedAt) {
    await getDb().update(trainingSessions).set({
      endedAt: new Date(),
      durationSeconds: elapsedSeconds(session.startedAt),
      completionReason: "USER_FINISHED",
    }).where(and(eq(trainingSessions.id, sessionId), eq(trainingSessions.userId, userId), isNull(trainingSessions.endedAt)));
  }
  return getTrainingReport(userId, sessionId);
}

export async function getTrainingReport(userId: string, sessionId: string): Promise<TrainingReport> {
  const session = await ownedSession(userId, sessionId);
  if (!session || !session.endedAt || !session.completionReason) throw new TrainingSessionStateError("Relatório indisponível para esta sessão.");
  if (!session.answerDetailsAvailable) return buildLegacyReport(session);
  const answers = await getDb().select({
    handClass: trainingAnswers.handClass,
    heroPosition: trainingAnswers.heroPosition,
    selectedAction: trainingAnswers.selectedAction,
    bestAction: trainingAnswers.bestAction,
    isCorrect: trainingAnswers.isCorrect,
    isMixed: trainingAnswers.isMixed,
  }).from(trainingAnswers).where(eq(trainingAnswers.trainingSessionId, session.id)).orderBy(desc(trainingAnswers.questionIndex)).limit(MAX_REPORT_ANSWER_DETAILS);
  return buildReport(session, answers);
}

async function selectEligibleTrainingSet(filters: TrainingFilters) {
  const [row] = await getDb().select({ id: trainingSets.id, playersCount: trainingSets.playersCount })
    .from(trainingHands)
    .innerJoin(trainingNodes, eq(trainingNodes.id, trainingHands.trainingNodeId))
    .innerJoin(trainingSets, eq(trainingSets.id, trainingNodes.trainingSetId))
    .where(and(...conditions(filters, ["trainingType", "equityModel", "stackDepthBb", "heroPosition"]), eligibleHandCondition()))
    .orderBy(asc(trainingSets.displayOrder), asc(trainingSets.importedAt), asc(trainingSets.id))
    .limit(1);
  return row ?? null;
}

async function getTrainingSetContext(trainingSetId: string) {
  const [row] = await getDb().select({ id: trainingSets.id, playersCount: trainingSets.playersCount })
    .from(trainingSets).where(and(eq(trainingSets.id, trainingSetId), ...PUBLISHED_CONDITIONS)).limit(1);
  return row ?? null;
}

async function getEligibleEntries(filters: TrainingFilters, trainingSetId: string): Promise<QueueEntry[]> {
  const pivot = crypto.randomUUID();
  const baseConditions = [eq(trainingSets.id, trainingSetId), ...conditions(filters, ["trainingType", "equityModel", "stackDepthBb", "heroPosition"]), eligibleHandCondition()];
  const queryWindow = (boundary: SQL, limit: number) => getDb().select({
      trainingSetId: trainingSets.id,
      trainingNodeId: trainingNodes.id,
      trainingHandId: trainingHands.id,
    }).from(trainingHands)
      .innerJoin(trainingNodes, eq(trainingNodes.id, trainingHands.trainingNodeId))
      .innerJoin(trainingSets, eq(trainingSets.id, trainingNodes.trainingSetId))
      .where(and(...baseConditions, boundary))
      .orderBy(asc(trainingHands.id))
      .limit(limit);
  const afterPivot = await queryWindow(gte(trainingHands.id, pivot), MAX_EXERCISE_QUEUE_SIZE);
  if (afterPivot.length === MAX_EXERCISE_QUEUE_SIZE) return afterPivot;
  const wrapped = await queryWindow(lt(trainingHands.id, pivot), MAX_EXERCISE_QUEUE_SIZE - afterPivot.length);
  return [...afterPivot, ...wrapped];
}

async function getReviewSetId(sessionId: string) {
  const [row] = await getDb().select({ trainingSetId: trainingAnswers.trainingSetId })
    .from(trainingAnswers)
    .where(and(eq(trainingAnswers.trainingSessionId, sessionId), eq(trainingAnswers.isCorrect, false)))
    .orderBy(asc(trainingAnswers.questionIndex))
    .limit(1);
  return row?.trainingSetId ?? null;
}

async function getReviewEntries(sessionId: string, trainingSetId: string): Promise<QueueEntry[]> {
  const rows = await getDb().select({
    trainingSetId: trainingAnswers.trainingSetId,
    trainingNodeId: trainingAnswers.trainingNodeId,
    trainingHandId: trainingAnswers.trainingHandId,
  }).from(trainingAnswers)
    .where(and(eq(trainingAnswers.trainingSessionId, sessionId), eq(trainingAnswers.trainingSetId, trainingSetId), eq(trainingAnswers.isCorrect, false)))
    .orderBy(desc(trainingAnswers.answeredAt))
    .limit(MAX_EXERCISE_QUEUE_SIZE);
  return fisherYates(rows);
}

async function getExercise(entry: QueueEntry): Promise<TrainingExercise | null> {
  const row = await getExerciseData(entry);
  if (!row) return null;
  return {
    trainingSetId: row.trainingSetId,
    trainingNodeId: row.trainingNodeId,
    trainingHandId: row.trainingHandId,
    setName: row.setName,
    handClass: row.handClass,
    trainingType: row.trainingType,
    equityModel: row.equityModel,
    evUnit: row.evUnit,
    playersCount: row.playersCount,
    heroStackBb: row.heroStackBb,
    heroPosition: row.heroPosition,
    villainPosition: row.villainPosition,
    blinds: { smallBlind: row.smallBlind, bigBlind: row.bigBlind, ante: row.ante, anteType: row.anteType },
    actionSequence: row.actionSequence as TrainingSequenceAction[],
    availableActions: row.availableActions as TrainingAction[],
  };
}

async function getExerciseData(entry: QueueEntry) {
  const [row] = await getDb().select({
    trainingSetId: trainingSets.id,
    trainingNodeId: trainingNodes.id,
    trainingHandId: trainingHands.id,
    setName: sql<string>`COALESCE(${trainingSets.displayName}, ${trainingSets.name})`,
    trainingType: trainingNodes.trainingType,
    equityModel: trainingSets.equityModel,
    evUnit: trainingSets.evUnit,
    playersCount: trainingSets.playersCount,
    heroStackBb: trainingNodes.heroStackBb,
    heroPosition: trainingNodes.heroPosition,
    villainPosition: trainingNodes.villainPosition,
    smallBlind: trainingSets.smallBlind,
    bigBlind: trainingSets.bigBlind,
    ante: trainingSets.ante,
    anteType: trainingSets.anteType,
    actionSequence: trainingNodes.actionSequence,
    availableActions: trainingNodes.availableActions,
    handClass: trainingHands.handClass,
    strategy: trainingHands.strategy,
    evs: trainingHands.evs,
    bestAction: trainingHands.bestAction,
    decisionClarity: trainingHands.decisionClarity,
    isMixed: trainingHands.isMixed,
  }).from(trainingHands)
    .innerJoin(trainingNodes, eq(trainingNodes.id, trainingHands.trainingNodeId))
    .innerJoin(trainingSets, eq(trainingSets.id, trainingNodes.trainingSetId))
    .where(and(eq(trainingSets.id, entry.trainingSetId), eq(trainingNodes.id, entry.trainingNodeId), eq(trainingHands.id, entry.trainingHandId)))
    .limit(1);
  return row ?? null;
}

async function getNodeRange(entry: Pick<QueueEntry, "trainingSetId" | "trainingNodeId">): Promise<NodeRange | null> {
  const rows = await getDb().select({
    trainingSetId: trainingSets.id,
    trainingNodeId: trainingNodes.id,
    handClass: trainingHands.handClass,
    strategy: trainingHands.strategy,
    evs: trainingHands.evs,
    bestAction: trainingHands.bestAction,
    decisionClarity: trainingHands.decisionClarity,
    isMixed: trainingHands.isMixed,
  }).from(trainingHands)
    .innerJoin(trainingNodes, eq(trainingNodes.id, trainingHands.trainingNodeId))
    .innerJoin(trainingSets, eq(trainingSets.id, trainingNodes.trainingSetId))
    .where(and(eq(trainingSets.id, entry.trainingSetId), eq(trainingNodes.id, entry.trainingNodeId)))
    .orderBy(asc(trainingHands.handClass));
  if (!rows.length) return null;
  return {
    trainingSetId: entry.trainingSetId,
    trainingNodeId: entry.trainingNodeId,
    hands: rows.map((row) => ({
      handClass: row.handClass,
      strategy: row.strategy,
      evs: row.evs,
      bestAction: row.bestAction,
      decisionClarity: row.decisionClarity,
      isMixed: Boolean(row.isMixed),
    })),
  };
}

async function ownedSession(userId: string, sessionId: string) {
  const [session] = await getDb().select().from(trainingSessions)
    .where(and(eq(trainingSessions.id, sessionId), eq(trainingSessions.userId, userId))).limit(1);
  return session ?? null;
}

async function recordedAnswerResponse(userId: string, input: AnswerTrainingInput) {
  const [recorded] = await getDb().select({
    trainingSetId: trainingAnswers.trainingSetId,
    trainingNodeId: trainingAnswers.trainingNodeId,
    trainingHandId: trainingAnswers.trainingHandId,
    selectedAction: trainingAnswers.selectedAction,
    bestAction: trainingAnswers.bestAction,
    isCorrect: trainingAnswers.isCorrect,
    strategy: trainingAnswers.strategy,
    evs: trainingAnswers.evs,
    decisionClarity: trainingAnswers.decisionClarity,
    isMixed: trainingAnswers.isMixed,
  }).from(trainingAnswers)
    .innerJoin(trainingSessions, eq(trainingSessions.id, trainingAnswers.trainingSessionId))
    .where(and(
    eq(trainingAnswers.trainingSessionId, input.sessionId),
    eq(trainingAnswers.questionIndex, input.questionIndex),
    eq(trainingSessions.userId, userId),
  )).limit(1);
  if (!recorded) return null;
  const session = await ownedSession(userId, input.sessionId);
  if (!session) return null;
  const selected = recorded.selectedAction as TrainingAction;
  const sameQuestion = recorded.trainingNodeId === input.trainingNodeId && recorded.trainingHandId === input.trainingHandId;
  const sameChoice = actionAliases(selected).includes(input.selectedAction);
  if (!sameQuestion || !sameChoice) throw new TrainingSessionStateError("Este índice já foi registrado com outra pergunta ou ação.");

  const answeredEntry: QueueEntry = {
    trainingSetId: recorded.trainingSetId,
    trainingNodeId: recorded.trainingNodeId,
    trainingHandId: recorded.trainingHandId,
  };
  const exerciseData = await getExerciseData(answeredEntry);
  const nodeRange = await getNodeRange(answeredEntry);
  if (!exerciseData || !nodeRange) throw new TrainingSessionStateError("A resposta registrada não pode mais ser reconstruída.");
  const actions = exerciseData.availableActions as TrainingAction[];
  const best = actions.find((action) => actionAliases(action).includes(recorded.bestAction));
  const answer: AnswerEvaluation = {
    correct: recorded.isCorrect,
    selectedKey: actionKey(selected),
    bestKey: recorded.bestAction,
    bestLabel: best?.label ?? recorded.bestAction,
    strategy: recorded.strategy,
    evs: recorded.evs,
    decisionClarity: recorded.decisionClarity,
    isMixed: Boolean(recorded.isMixed),
  };

  if (session.endedAt) {
    return {
      answer,
      nodeRange,
      answeredQuestions: session.answeredQuestions,
      correctAnswers: session.correctAnswers,
      report: await getTrainingReport(userId, session.id),
      nextExercise: null,
      replayed: true,
    };
  }
  const currentEntry = session.exerciseQueue[session.queuePosition];
  const nextExercise = currentEntry ? await getExercise(currentEntry) : null;
  if (!nextExercise) throw new TrainingSessionStateError("A pergunta atual da sessão não está mais disponível.");
  return {
    answer,
    nodeRange,
    answeredQuestions: session.answeredQuestions,
    correctAnswers: session.correctAnswers,
    report: null,
    nextExercise,
    replayed: true,
  };
}

function sessionConfig(session: typeof trainingSessions.$inferSelect): TrainingConfig {
  return {
    trainingType: session.trainingType,
    equityModel: session.equityModel,
    stackDepthBb: session.stackBb ?? undefined,
    heroPosition: session.heroPosition ?? undefined,
    targetQuestions: session.targetQuestions as TrainingConfig["targetQuestions"],
  };
}

function sameConfig(left: TrainingConfig, right: TrainingConfig) {
  return left.trainingType === right.trainingType
    && left.equityModel === right.equityModel
    && (left.stackDepthBb ?? null) === (right.stackDepthBb ?? null)
    && (left.heroPosition ?? null) === (right.heroPosition ?? null)
    && left.targetQuestions === right.targetQuestions;
}

function buildReport(session: typeof trainingSessions.$inferSelect, answers: Array<{ handClass: string; heroPosition: string; selectedAction: Record<string, unknown>; bestAction: string; isCorrect: boolean; isMixed: boolean | null }>): TrainingReport {
  const answered = session.answeredQuestions;
  const correct = session.correctAnswers;
  const accuracy = answered ? Math.round(correct / answered * 100) : 0;
  const byPosition = groupAnswers(answers, (answer) => answer.heroPosition);
  const clarityAnswers = answers.filter((answer) => answer.isMixed !== null);
  const byDecisionType = groupAnswers(clarityAnswers, (answer) => answer.isMixed ? "Estratégias mistas" : "Decisões claras").filter((group) => group.answered >= 3);
  const missed = new Map<string, number>();
  for (const answer of answers) if (!answer.isCorrect) missed.set(answer.handClass, (missed.get(answer.handClass) ?? 0) + 1);
  const mostMissedHands = [...missed].map(([handClass, errors]) => ({ handClass, errors })).sort((left, right) => right.errors - left.errors || left.handClass.localeCompare(right.handClass)).slice(0, 8);
  const feedback: string[] = [];
  if (answered >= 5 && accuracy >= 80) feedback.push(`Bom desempenho geral: ${accuracy}% de acerto.`);
  const comparablePositions = byPosition.filter((group) => group.answered >= 3);
  if (comparablePositions.length >= 2) {
    const sorted = [...comparablePositions].sort((left, right) => left.accuracy - right.accuracy);
    if (sorted.at(-1)!.accuracy - sorted[0].accuracy >= 10) feedback.push(`Seu desempenho foi mais baixo no ${sorted[0].label} do que nas outras posições desta sessão.`);
  }
  if (mostMissedHands.length) feedback.push(`As mãos com mais erros foram ${mostMissedHands.slice(0, 3).map((hand) => hand.handClass).join(", ")}.`);
  if (byDecisionType.length === 2) {
    const mixed = byDecisionType.find((group) => group.label === "Estratégias mistas");
    const clear = byDecisionType.find((group) => group.label === "Decisões claras");
    if (mixed && clear && clear.accuracy - mixed.accuracy >= 10) feedback.push("Você teve mais dificuldade nas decisões classificadas como mixed.");
  }
  return {
    sessionId: session.id,
    detailsAvailable: true,
    detailsTruncated: answers.length < answered,
    detailAnswers: answers.length,
    completionReason: session.completionReason!,
    trainingType: session.trainingType,
    equityModel: session.equityModel,
    stackDepthBb: session.stackBb,
    heroPosition: session.heroPosition,
    targetQuestions: session.targetQuestions,
    answeredQuestions: answered,
    correctAnswers: correct,
    errors: answered - correct,
    accuracy,
    durationSeconds: session.durationSeconds,
    averageSeconds: answered ? Number((session.durationSeconds / answered).toFixed(1)) : null,
    byPosition,
    byDecisionType,
    mostMissedHands,
    errorDetails: answers.filter((answer) => !answer.isCorrect).map((answer) => ({ handClass: answer.handClass, heroPosition: answer.heroPosition, selectedAction: selectedActionLabel(answer.selectedAction), bestAction: answer.bestAction })),
    feedback,
  };
}

function buildLegacyReport(session: typeof trainingSessions.$inferSelect): TrainingReport {
  const answered = session.answeredQuestions;
  const correct = session.correctAnswers;
  return {
    sessionId: session.id,
    detailsAvailable: false,
    detailsTruncated: false,
    detailAnswers: 0,
    completionReason: session.completionReason!,
    trainingType: session.trainingType,
    equityModel: session.equityModel,
    stackDepthBb: session.stackBb,
    heroPosition: session.heroPosition,
    targetQuestions: session.targetQuestions,
    answeredQuestions: answered,
    correctAnswers: correct,
    errors: answered - correct,
    accuracy: answered ? Math.round(correct / answered * 100) : 0,
    durationSeconds: session.durationSeconds,
    averageSeconds: answered ? Number((session.durationSeconds / answered).toFixed(1)) : null,
    byPosition: [],
    byDecisionType: [],
    mostMissedHands: [],
    errorDetails: [],
    feedback: ["Resumo histórico: detalhes por mão não estavam disponíveis nesta versão."],
  };
}

function groupAnswers<T>(answers: T[], label: (answer: T) => string) {
  const groups = new Map<string, { answered: number; correct: number }>();
  for (const answer of answers) {
    const key = label(answer);
    const current = groups.get(key) ?? { answered: 0, correct: 0 };
    current.answered += 1;
    current.correct += (answer as { isCorrect: boolean }).isCorrect ? 1 : 0;
    groups.set(key, current);
  }
  return [...groups].map(([groupLabel, values]) => ({ label: groupLabel, ...values, accuracy: Math.round(values.correct / values.answered * 100) })).sort((left, right) => positionRank(left.label) - positionRank(right.label) || left.label.localeCompare(right.label));
}

function selectedActionLabel(action: Record<string, unknown>) {
  return typeof action.label === "string" ? action.label : typeof action.id === "string" ? action.id : typeof action.type === "string" ? action.type : "—";
}

function elapsedSeconds(startedAt: Date) { return Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000)); }
function eligibleHandCondition() { return sql`COALESCE((${trainingHands.metadata}->>'hrcWeight')::double precision, 1) >= 0.01`; }

function conditions(filters: TrainingFilters, keys: Array<keyof TrainingFilters>) {
  const result = [...PUBLISHED_CONDITIONS];
  for (const key of keys) {
    const value = filters[key];
    if (value === undefined || value === "") continue;
    if (key === "trainingType") result.push(eq(trainingNodes.trainingType, value as TrainingType));
    if (key === "equityModel") result.push(eq(trainingSets.equityModel, value as EquityModel));
    if (key === "stackDepthBb") result.push(eq(trainingNodes.heroStackBb, value as number));
    if (key === "heroPosition") result.push(eq(trainingNodes.heroPosition, value as string));
  }
  return result;
}

async function distinct<T>(column: PgColumn, filters: TrainingFilters, keys: Array<keyof TrainingFilters>): Promise<T[]> {
  const rows = await getDb().selectDistinct({ value: column }).from(trainingHands)
    .innerJoin(trainingNodes, eq(trainingNodes.id, trainingHands.trainingNodeId))
    .innerJoin(trainingSets, eq(trainingSets.id, trainingNodes.trainingSetId))
    .where(and(...conditions(filters, keys), eligibleHandCondition())).orderBy(asc(column));
  return rows.map((row) => row.value).filter((value) => value !== null) as unknown as T[];
}

const POSITION_ORDER = ["UTG", "UTG+1", "UTG+2", "UTG+3", "EP", "MP", "MP1", "MP2", "HJ", "CO", "BTN", "BU", "SB", "BB"];
function positionRank(position: string) { const index = POSITION_ORDER.indexOf(position); return index < 0 ? 99 : index; }
function sortPositions(positions: string[]) { return positions.sort((left, right) => positionRank(left) - positionRank(right) || left.localeCompare(right)); }
