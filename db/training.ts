import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  buildExerciseQueue,
  evaluateChoice,
  fisherYates,
  sameQueueEntry,
  type AnswerEvaluation,
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
import { trainingAnswers, trainingHands, trainingNodes, trainingSessions, trainingSets } from "./schema";

const PUBLISHED_CONDITIONS: SQL[] = [
  eq(trainingSets.gameType, "TOURNAMENT"),
  eq(trainingSets.street, "PREFLOP"),
  eq(trainingSets.status, "PUBLISHED"),
  eq(trainingSets.isPublished, true),
];

export type SessionStartRequest =
  | { mode?: "START"; config: TrainingConfig }
  | { mode: "REPEAT" | "REVIEW_ERRORS"; sourceSessionId: string };

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

  if (request.mode === "REPEAT" || request.mode === "REVIEW_ERRORS") {
    const source = await ownedSession(userId, request.sourceSessionId);
    if (!source) throw new TrainingSessionStateError("Sessão de origem não encontrada.");
    sourceSessionId = source.id;
    config = sessionConfig(source);
    previousQueue = source.exerciseQueue;
    if (request.mode === "REVIEW_ERRORS") {
      entries = await getReviewEntries(source.id);
      if (!entries.length) throw new NoReviewErrorsError("Nenhum erro para revisar.");
      config = { ...config, targetQuestions: entries.length };
    } else {
      entries = await getEligibleEntries(config);
    }
  } else if ("config" in request) {
    config = request.config;
    entries = await getEligibleEntries(config);
  } else {
    throw new TrainingSessionStateError("Configuração de sessão inválida.");
  }

  if (!entries.length) throw new NoExercisesError("Nenhum exercício disponível para estes filtros.");
  const queue = buildExerciseQueue(entries, config.targetQuestions, Math.random, previousQueue);
  const exercise = await getExercise(queue[0]);
  if (!exercise) throw new NoExercisesError("O exercício selecionado não está mais disponível.");
  const uniqueSetIds = new Set(entries.map((entry) => entry.trainingSetId));
  const id = crypto.randomUUID();
  const startedAt = new Date();
  await getDb().insert(trainingSessions).values({
    id,
    userId,
    trainingSetId: uniqueSetIds.size === 1 ? entries[0].trainingSetId : null,
    trainingType: config.trainingType,
    equityModel: config.equityModel,
    playersCount: null,
    stackBb: config.stackDepthBb ?? null,
    heroPosition: config.heroPosition ?? null,
    targetQuestions: config.targetQuestions,
    exerciseQueue: queue,
    queuePosition: 0,
    sourceSessionId,
    startedAt,
  });
  return { id, startedAt: startedAt.getTime(), config, targetQuestions: config.targetQuestions, answeredQuestions: 0, correctAnswers: 0, exercise };
}

export async function answerTrainingSession(userId: string, input: { sessionId: string; trainingNodeId: string; trainingHandId: string; selectedAction: string }) {
  const session = await ownedSession(userId, input.sessionId);
  if (!session || session.endedAt) throw new TrainingSessionStateError("Sessão encerrada ou não encontrada.");
  const entry = session.exerciseQueue[session.queuePosition];
  if (!entry || entry.trainingNodeId !== input.trainingNodeId || entry.trainingHandId !== input.trainingHandId) {
    throw new TrainingSessionStateError("Este exercício não é a pergunta atual da sessão.");
  }
  const exerciseData = await getExerciseData(entry);
  if (!exerciseData) throw new TrainingSessionStateError("Exercício não encontrado.");
  const availableActions = exerciseData.availableActions as TrainingAction[];
  const evaluation = evaluateChoice(input.selectedAction, availableActions, exerciseData.bestAction, exerciseData.evs);
  if (!evaluation) throw new TrainingSessionStateError("Ação indisponível para este exercício.");

  const answeredQuestions = session.answeredQuestions + 1;
  const correctAnswers = session.correctAnswers + (evaluation.correct ? 1 : 0);
  const durationSeconds = elapsedSeconds(session.startedAt);
  const completed = session.targetQuestions !== null && answeredQuestions >= session.targetQuestions;
  let nextQueue = session.exerciseQueue;
  let nextPosition = session.queuePosition + 1;

  if (!completed && nextPosition >= nextQueue.length) {
    const eligible = await getEligibleEntries(sessionConfig(session));
    if (!eligible.length) throw new TrainingSessionStateError("Não há exercícios para continuar o treino livre.");
    nextQueue = buildExerciseQueue(eligible, null);
    if (nextQueue.length > 1 && sameQueueEntry(entry, nextQueue[0])) [nextQueue[0], nextQueue[1]] = [nextQueue[1], nextQueue[0]];
    nextPosition = 0;
  }

  await getDb().transaction(async (tx) => {
    await tx.insert(trainingAnswers).values({
      id: crypto.randomUUID(),
      trainingSessionId: session.id,
      trainingSetId: entry.trainingSetId,
      trainingNodeId: entry.trainingNodeId,
      trainingHandId: entry.trainingHandId,
      questionIndex: session.answeredQuestions,
      handClass: exerciseData.handClass,
      heroPosition: exerciseData.heroPosition,
      stackBb: exerciseData.heroStackBb,
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

  const answer: AnswerEvaluation = {
    correct: evaluation.correct,
    selectedKey: evaluation.selectedKey,
    bestKey: evaluation.bestKey,
    bestLabel: evaluation.bestLabel,
    strategy: exerciseData.strategy,
    evs: exerciseData.evs,
  };
  if (completed) return { answer, answeredQuestions, correctAnswers, report: await getTrainingReport(userId, session.id), nextExercise: null };
  const nextExercise = await getExercise(nextQueue[nextPosition]);
  if (!nextExercise) throw new TrainingSessionStateError("Próximo exercício não encontrado.");
  return { answer, answeredQuestions, correctAnswers, report: null, nextExercise };
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
  const answers = await getDb().select({
    handClass: trainingAnswers.handClass,
    heroPosition: trainingAnswers.heroPosition,
    selectedAction: trainingAnswers.selectedAction,
    bestAction: trainingAnswers.bestAction,
    isCorrect: trainingAnswers.isCorrect,
    isMixed: trainingAnswers.isMixed,
  }).from(trainingAnswers).where(eq(trainingAnswers.trainingSessionId, session.id)).orderBy(asc(trainingAnswers.questionIndex));
  return buildReport(session, answers);
}

async function getEligibleEntries(filters: TrainingFilters): Promise<QueueEntry[]> {
  return getDb().select({
    trainingSetId: trainingSets.id,
    trainingNodeId: trainingNodes.id,
    trainingHandId: trainingHands.id,
  }).from(trainingHands)
    .innerJoin(trainingNodes, eq(trainingNodes.id, trainingHands.trainingNodeId))
    .innerJoin(trainingSets, eq(trainingSets.id, trainingNodes.trainingSetId))
    .where(and(...conditions(filters, ["trainingType", "equityModel", "stackDepthBb", "heroPosition"]), eligibleHandCondition()));
}

async function getReviewEntries(sessionId: string): Promise<QueueEntry[]> {
  const rows = await getDb().select({
    trainingSetId: trainingAnswers.trainingSetId,
    trainingNodeId: trainingAnswers.trainingNodeId,
    trainingHandId: trainingAnswers.trainingHandId,
  }).from(trainingAnswers).where(and(eq(trainingAnswers.trainingSessionId, sessionId), eq(trainingAnswers.isCorrect, false)));
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

async function ownedSession(userId: string, sessionId: string) {
  const [session] = await getDb().select().from(trainingSessions)
    .where(and(eq(trainingSessions.id, sessionId), eq(trainingSessions.userId, userId))).limit(1);
  return session ?? null;
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

function buildReport(session: typeof trainingSessions.$inferSelect, answers: Array<{ handClass: string; heroPosition: string; selectedAction: Record<string, unknown>; bestAction: string; isCorrect: boolean; isMixed: boolean | null }>): TrainingReport {
  const answered = answers.length;
  const correct = answers.filter((answer) => answer.isCorrect).length;
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
