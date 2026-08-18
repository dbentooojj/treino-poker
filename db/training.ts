import { and, asc, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  buildExerciseQueue,
  TRAINING_TYPES,
  MAX_EXERCISE_QUEUE_SIZE,
  actionAliases,
  actionKey,
  classifyTrainingChoice,
  resolvedActionLabel,
  evaluateChoice,
  fisherYates,
  recordValue,
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
  type EvUnit,
} from "../lib/training";
import { getDb } from "./index";
import { hasPostgresErrorCode } from "./errors";
import { trainingAnswers, trainingHands, trainingNodes, trainingSessions, trainingSets } from "./schema";
import {
  continueFullHand,
  dealFullHand,
  getFullHandStudy,
  getPublishedFullHandStages,
  selectPublishedFullHandStudy,
  type FullHandState,
} from "./full-hand";

const PUBLISHED_CONDITIONS: SQL[] = [
  eq(trainingSets.gameType, "TOURNAMENT"),
  eq(trainingSets.street, "PREFLOP"),
  eq(trainingSets.status, "PUBLISHED"),
  eq(trainingSets.isPublished, true),
];
const MAX_REPORT_ANSWER_DETAILS = 1_000;
const DECISION_NODE_CONDITION = eq(trainingNodes.decisionEligible, true);
type TrainingQueryFilters = Omit<TrainingFilters, "trainingType"> & { trainingType?: TrainingType | null };

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
  const fullHandStages = await getPublishedFullHandStages();
  const typeRows = await getDb().select({
    trainingType: trainingNodes.trainingType,
    count: sql<number>`COUNT(DISTINCT ${trainingNodes.id})::int`,
  }).from(trainingHands)
    .innerJoin(trainingNodes, eq(trainingNodes.id, trainingHands.trainingNodeId))
    .innerJoin(trainingSets, eq(trainingSets.id, trainingNodes.trainingSetId))
    .where(and(
      DECISION_NODE_CONDITION,
      ...conditions(filters, ["equityModel", "stackDepthBb", "heroPosition"]),
      eligibleHandCondition(),
    ))
    .groupBy(trainingNodes.trainingType);
  const trainingTypeCounts = Object.fromEntries(TRAINING_TYPES.map((type) => [type, 0])) as Record<TrainingType, number>;
  for (const row of typeRows) if (row.trainingType) trainingTypeCounts[row.trainingType] = row.count;
  const trainingTypes = TRAINING_TYPES.filter((type) => trainingTypeCounts[type] > 0);
  const totalTrainingNodes = TRAINING_TYPES.reduce((total, type) => total + trainingTypeCounts[type], 0);
  const equityModels = await distinct<EquityModel>(trainingSets.equityModel, filters, ["trainingType"]);
  const stackDepthsBb = await distinct<number>(trainingNodes.heroStackBb, filters, ["trainingType", "equityModel"]);
  const heroPositions = await distinct<string>(trainingNodes.heroPosition, filters, ["trainingType", "equityModel", "stackDepthBb"]);
  const [match] = await getDb().select({
    trainingSetId: trainingSets.id,
    studyName: sql<string>`COALESCE(${trainingSets.displayName}, ${trainingSets.name})`,
    gameType: trainingSets.gameType,
    equityModel: trainingSets.equityModel,
    playersCount: trainingSets.playersCount,
    heroStackBb: trainingNodes.heroStackBb,
    heroPosition: trainingNodes.heroPosition,
    actionSequence: trainingNodes.actionSequence,
  }).from(trainingHands)
    .innerJoin(trainingNodes, eq(trainingNodes.id, trainingHands.trainingNodeId))
    .innerJoin(trainingSets, eq(trainingSets.id, trainingNodes.trainingSetId))
    .where(and(DECISION_NODE_CONDITION, ...conditions(filters, ["trainingType", "equityModel", "stackDepthBb", "heroPosition"]), eligibleHandCondition()))
    .orderBy(asc(trainingSets.displayOrder), asc(trainingSets.importedAt), asc(trainingSets.id), asc(trainingNodes.id), asc(trainingHands.id))
    .limit(1);
  return {
    trainingTypes,
    trainingTypeCounts,
    totalTrainingNodes,
    equityModels,
    stackDepthsBb,
    heroPositions: sortPositions(heroPositions),
    hasMatches: Boolean(match),
    tableContext: match ? {
      ...match,
      actionSequence: match.actionSequence as TrainingSequenceAction[],
    } : null,
    fullHandStages,
  };
}

export async function createTrainingSession(userId: string, request: SessionStartRequest): Promise<TrainingSession> {
  if (request.mode === "REPEAT") {
    const source = await ownedSession(userId, request.sourceSessionId);
    if (source?.fullHandState) return createFullHandTrainingSession(userId, sessionConfig(source), source.id);
  }
  if (request.mode !== "REPEAT" && request.mode !== "REVIEW_ERRORS" && "config" in request && request.config.presentationMode === "FROM_START") {
    return createFullHandTrainingSession(userId, request.config);
  }
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
      if (source.fullHandState) config = { ...config, presentationMode: "DECISION", fullHandStage: undefined };
      if (!source.answerDetailsAvailable) throw new NoReviewErrorsError("Os detalhes por mão deste resumo histórico não estão disponíveis para revisão.");
      const selectedSetId = config.trainingType === null ? undefined : source.trainingSetId ?? await getReviewSetId(source.id);
      selectedSet = selectedSetId ? await getTrainingSetContext(selectedSetId) : null;
      entries = await getReviewEntries(source.id, selectedSetId);
      if (!entries.length) throw new NoReviewErrorsError("Nenhum erro para revisar.");
      config = { ...config, targetQuestions: entries.length };
    } else {
      const selectedSetId = config.trainingType === null ? undefined : source.trainingSetId ?? source.exerciseQueue[0]?.trainingSetId;
      selectedSet = selectedSetId ? await getTrainingSetContext(selectedSetId) : config.trainingType === null ? null : await selectEligibleTrainingSet(config);
      entries = await getEligibleEntries(config, selectedSet?.id);
    }
  } else if ("config" in request) {
    config = request.config;
    selectedSet = config.trainingType === null ? null : await selectEligibleTrainingSet(config);
    entries = await getEligibleEntries(config, selectedSet?.id);
  } else {
    throw new TrainingSessionStateError("Configuração de sessão inválida.");
  }

  if (!entries.length) throw new NoExercisesError("Nenhum exercício disponível para estes filtros.");
  if (config.trainingType !== null && !selectedSet) throw new NoExercisesError("O estudo selecionado não está mais disponível.");
  const queue = buildExerciseQueue(entries, config.targetQuestions, Math.random, previousQueue);
  const exercise = await getExercise(queue[0]);
  if (!exercise) throw new NoExercisesError("O exercício selecionado não está mais disponível.");
  const id = crypto.randomUUID();
  const startedAt = new Date();
  try {
    await getDb().insert(trainingSessions).values({
      id,
      userId,
      trainingSetId: selectedSet?.id ?? null,
      trainingType: config.trainingType,
      presentationMode: config.presentationMode ?? "DECISION",
      equityModel: config.equityModel,
      playersCount: selectedSet?.playersCount ?? null,
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
  return { id, startedAt: startedAt.getTime(), config, targetQuestions: config.targetQuestions, answeredQuestions: 0, correctAnswers: 0, completedHands: 0, evDelta: 0, evUnit: exercise.evUnit, exercise };
}

export async function answerTrainingSession(userId: string, input: AnswerTrainingInput) {
  const recorded = await recordedAnswerResponse(userId, input);
  if (recorded) return recorded;
  const session = await ownedSession(userId, input.sessionId);
  if (session?.presentationMode === "FROM_START" && session.fullHandState && !session.endedAt) return answerFullHandTrainingSession(userId, input, session);
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
    const continuedConfig = sessionConfig(session);
    const eligible = await getEligibleEntries(continuedConfig, continuedConfig.trainingType === null ? undefined : session.trainingSetId ?? entry.trainingSetId);
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
  if (completed) return { answer, nodeRange, answeredQuestions, correctAnswers, completedHands: session.completedHands, report: await getTrainingReport(userId, session.id), nextExercise: null, replayed: false };
  const nextExercise = await getExercise(nextQueue[nextPosition]);
  if (!nextExercise) throw new TrainingSessionStateError("Próximo exercício não encontrado.");
  return { answer, nodeRange, answeredQuestions, correctAnswers, completedHands: session.completedHands, report: null, nextExercise, replayed: false };
}

async function createFullHandTrainingSession(userId: string, requestedConfig: TrainingConfig, sourceSessionId: string | null = null): Promise<TrainingSession> {
  const stage = requestedConfig.fullHandStage ?? "PREFLOP";
  const study = await selectPublishedFullHandStudy(stage, requestedConfig.equityModel)
    ?? await selectPublishedFullHandStudy(stage);
  if (!study) throw new NoExercisesError("Nenhum estudo de mão completa disponível.");
  const dealt = await dealFullHand(study);
  if (!dealt.entry) throw new NoExercisesError("O estudo não produziu uma decisão treinável para o Hero.");
  const exercise = await getExercise(dealt.entry);
  if (!exercise) throw new NoExercisesError("A decisão inicial da mão não está disponível.");
  const config: TrainingConfig = {
    trainingType: null,
    equityModel: study.equityModel,
    targetQuestions: requestedConfig.targetQuestions,
    presentationMode: "FROM_START",
    fullHandStage: stage,
  };
  const id = crypto.randomUUID();
  const startedAt = new Date();
  try {
    await getDb().insert(trainingSessions).values({
      id,
      userId,
      trainingSetId: study.id,
      trainingType: null,
      presentationMode: "FROM_START",
      equityModel: study.equityModel,
      playersCount: study.playersCount,
      stackBb: exercise.heroStackBb,
      heroPosition: exercise.heroPosition,
      targetQuestions: config.targetQuestions,
      exerciseQueue: [dealt.entry],
      queuePosition: 0,
      fullHandState: dealt.state,
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
  return {
    id,
    startedAt: startedAt.getTime(),
    config,
    targetQuestions: config.targetQuestions,
    answeredQuestions: 0,
    correctAnswers: 0,
    completedHands: 0,
    evDelta: 0,
    evUnit: exercise.evUnit,
    exercise,
  };
}

async function answerFullHandTrainingSession(
  userId: string,
  input: AnswerTrainingInput,
  session: typeof trainingSessions.$inferSelect,
) {
  if (input.questionIndex !== session.answeredQuestions) throw new TrainingSessionStateError("Esta resposta não corresponde à decisão atual.");
  const entry = session.exerciseQueue[session.queuePosition];
  if (!entry || entry.trainingNodeId !== input.trainingNodeId || entry.trainingHandId !== input.trainingHandId) {
    throw new TrainingSessionStateError("Esta não é a decisão atual da mão.");
  }
  if (!session.trainingSetId || !session.fullHandState) throw new TrainingSessionStateError("O estado da mão completa não está disponível.");
  const study = await getFullHandStudy(session.trainingSetId);
  if (!study) throw new TrainingSessionStateError("O estudo de mão completa não está mais publicado.");
  const exerciseData = await getExerciseData(entry);
  if (!exerciseData) throw new TrainingSessionStateError("Decisão do Hero não encontrada.");
  const availableActions = exerciseData.availableActions as TrainingAction[];
  const actionIndex = availableActions.findIndex((action) => actionAliases(action).includes(input.selectedAction));
  if (actionIndex < 0) throw new TrainingSessionStateError("Ação indisponível nesta decisão.");
  const evaluation = evaluateChoice(input.selectedAction, availableActions, exerciseData.bestAction, exerciseData.evs, exerciseData.strategy);
  const nodeRange = await getNodeRange(entry);
  if (!evaluation || !nodeRange) throw new TrainingSessionStateError("Estratégia da decisão não encontrada.");

  let nextAdvance = await continueFullHand(study, session.fullHandState as FullHandState, actionIndex);
  const answeredQuestions = session.answeredQuestions + 1;
  const correctAnswers = session.correctAnswers + (evaluation.correct ? 1 : 0);
  const completedHands = session.completedHands + (nextAdvance.terminal ? 1 : 0);
  const completed = session.targetQuestions !== null && completedHands >= session.targetQuestions;
  if (nextAdvance.terminal && !completed) nextAdvance = await dealFullHand(study);
  if (!completed && !nextAdvance.entry) throw new TrainingSessionStateError("A próxima decisão do Hero não foi encontrada.");
  const durationSeconds = elapsedSeconds(session.startedAt);
  const nextQueue = completed ? session.exerciseQueue : [nextAdvance.entry!];
  const nextPosition = completed ? nextQueue.length : 0;

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
        completedHands,
        durationSeconds,
        exerciseQueue: nextQueue,
        queuePosition: nextPosition,
        fullHandState: nextAdvance.state,
        ...(completed ? { endedAt: new Date(), completionReason: "COMPLETED" as const } : {}),
      }).where(and(
        eq(trainingSessions.id, session.id),
        eq(trainingSessions.userId, userId),
        eq(trainingSessions.answeredQuestions, session.answeredQuestions),
        isNull(trainingSessions.endedAt),
      )).returning({ id: trainingSessions.id });
      if (!updated) throw new TrainingSessionStateError("A decisão já foi registrada.");
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
  if (completed) {
    return {
      answer,
      nodeRange,
      answeredQuestions,
      correctAnswers,
      completedHands,
      report: await getTrainingReport(userId, session.id),
      nextExercise: null,
      replayed: false,
    };
  }
  const nextExercise = await getExercise(nextAdvance.entry!);
  if (!nextExercise) throw new TrainingSessionStateError("A próxima decisão não está disponível.");
  return {
    answer,
    nodeRange,
    answeredQuestions,
    correctAnswers,
    completedHands,
    report: null,
    nextExercise,
    replayed: false,
  };
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
  const evMetric = await getTrainingSessionEv(session.id, exercise.evUnit);
  return {
    id: session.id,
    startedAt: session.startedAt.getTime(),
    config: sessionConfig(session),
    targetQuestions: session.targetQuestions,
    answeredQuestions: session.answeredQuestions,
    correctAnswers: session.correctAnswers,
    completedHands: session.completedHands,
    evDelta: evMetric.value,
    evUnit: evMetric.unit,
    exercise,
  };
}

async function getTrainingSessionEv(sessionId: string, fallbackUnit: EvUnit) {
  const answers = await getDb().select({
    selectedAction: trainingAnswers.selectedAction,
    bestAction: trainingAnswers.bestAction,
    evs: trainingAnswers.evs,
    evUnit: trainingAnswers.evUnit,
  }).from(trainingAnswers).where(eq(trainingAnswers.trainingSessionId, sessionId));
  let value = 0;
  let unit = fallbackUnit;
  for (const answer of answers) {
    const selectedEv = recordValue(answer.evs, answer.selectedAction as TrainingAction);
    const bestEv = typeof answer.evs[answer.bestAction] === "number" ? answer.evs[answer.bestAction] : Math.max(...Object.values(answer.evs));
    if (selectedEv !== null && Number.isFinite(bestEv)) value += selectedEv - bestEv;
    unit = answer.evUnit;
  }
  return { value, unit };
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
    questionIndex: trainingAnswers.questionIndex,
    handClass: trainingAnswers.handClass,
    heroPosition: trainingAnswers.heroPosition,
    selectedAction: trainingAnswers.selectedAction,
    bestAction: trainingAnswers.bestAction,
    isCorrect: trainingAnswers.isCorrect,
    isMixed: trainingAnswers.isMixed,
    strategy: trainingAnswers.strategy,
    evs: trainingAnswers.evs,
    evUnit: trainingAnswers.evUnit,
    trainingType: trainingNodes.trainingType,
    heroStackBb: trainingNodes.heroStackBb,
    availableActions: trainingNodes.availableActions,
  }).from(trainingAnswers)
    .innerJoin(trainingNodes, eq(trainingNodes.id, trainingAnswers.trainingNodeId))
    .where(eq(trainingAnswers.trainingSessionId, session.id)).orderBy(asc(trainingAnswers.questionIndex)).limit(MAX_REPORT_ANSWER_DETAILS);
  return buildReport(session, answers);
}

export async function getTrainingReportSpot(userId: string, sessionId: string, questionIndex: number) {
  const session = await ownedSession(userId, sessionId);
  if (!session || !session.endedAt) throw new TrainingSessionStateError("Relatório indisponível para esta sessão.");
  const [answer] = await getDb().select({
    trainingSetId: trainingAnswers.trainingSetId,
    trainingNodeId: trainingAnswers.trainingNodeId,
    trainingHandId: trainingAnswers.trainingHandId,
  }).from(trainingAnswers).where(and(
    eq(trainingAnswers.trainingSessionId, sessionId),
    eq(trainingAnswers.questionIndex, questionIndex),
  )).limit(1);
  if (!answer) throw new TrainingSessionStateError("Decisão não encontrada neste relatório.");
  const [exercise, range] = await Promise.all([getExercise(answer), getNodeRange(answer)]);
  if (!exercise || !range) throw new TrainingSessionStateError("Os dados de EV deste spot não estão disponíveis.");
  return { exercise, range };
}

async function selectEligibleTrainingSet(filters: TrainingQueryFilters) {
  const [row] = await getDb().select({ id: trainingSets.id, playersCount: trainingSets.playersCount })
    .from(trainingHands)
    .innerJoin(trainingNodes, eq(trainingNodes.id, trainingHands.trainingNodeId))
    .innerJoin(trainingSets, eq(trainingSets.id, trainingNodes.trainingSetId))
    .where(and(DECISION_NODE_CONDITION, ...conditions(filters, ["trainingType", "equityModel", "stackDepthBb", "heroPosition"]), eligibleHandCondition()))
    .orderBy(asc(trainingSets.displayOrder), asc(trainingSets.importedAt), asc(trainingSets.id))
    .limit(1);
  return row ?? null;
}

async function getTrainingSetContext(trainingSetId: string) {
  const [row] = await getDb().select({ id: trainingSets.id, playersCount: trainingSets.playersCount })
    .from(trainingSets).where(and(eq(trainingSets.id, trainingSetId), ...PUBLISHED_CONDITIONS)).limit(1);
  return row ?? null;
}

async function getEligibleEntries(filters: TrainingQueryFilters, trainingSetId?: string): Promise<QueueEntry[]> {
  const pivot = crypto.randomUUID();
  const baseConditions = [...(trainingSetId ? [eq(trainingSets.id, trainingSetId)] : []), DECISION_NODE_CONDITION, ...conditions(filters, ["trainingType", "equityModel", "stackDepthBb", "heroPosition"]), eligibleHandCondition()];
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

async function getReviewEntries(sessionId: string, trainingSetId?: string): Promise<QueueEntry[]> {
  const rows = await getDb().select({
    trainingSetId: trainingAnswers.trainingSetId,
    trainingNodeId: trainingAnswers.trainingNodeId,
    trainingHandId: trainingAnswers.trainingHandId,
  }).from(trainingAnswers)
    .where(and(eq(trainingAnswers.trainingSessionId, sessionId), ...(trainingSetId ? [eq(trainingAnswers.trainingSetId, trainingSetId)] : []), eq(trainingAnswers.isCorrect, false)))
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
      completedHands: session.completedHands,
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
    completedHands: session.completedHands,
    report: null,
    nextExercise,
    replayed: true,
  };
}

function sessionConfig(session: typeof trainingSessions.$inferSelect): TrainingConfig {
  return {
    trainingType: session.trainingType,
    presentationMode: session.presentationMode,
    fullHandStage: session.presentationMode === "FROM_START" ? "PREFLOP" : undefined,
    equityModel: session.equityModel,
    stackDepthBb: session.stackBb ?? undefined,
    heroPosition: session.heroPosition ?? undefined,
    targetQuestions: session.targetQuestions as TrainingConfig["targetQuestions"],
  };
}

function sameConfig(left: TrainingConfig, right: TrainingConfig) {
  return left.trainingType === right.trainingType
    && (left.presentationMode ?? "DECISION") === (right.presentationMode ?? "DECISION")
    && left.equityModel === right.equityModel
    && (left.stackDepthBb ?? null) === (right.stackDepthBb ?? null)
    && (left.heroPosition ?? null) === (right.heroPosition ?? null)
    && left.targetQuestions === right.targetQuestions;
}

type ReportAnswerRow = { questionIndex: number; handClass: string; heroPosition: string; selectedAction: Record<string, unknown>; bestAction: string; isCorrect: boolean; isMixed: boolean | null; strategy: Record<string, number>; evs: Record<string, number>; evUnit: TrainingReport["decisionDetails"][number]["evUnit"]; trainingType: TrainingType | null; heroStackBb: number; availableActions: Array<Record<string, unknown>> };

function buildReport(session: typeof trainingSessions.$inferSelect, answers: ReportAnswerRow[]): TrainingReport {
  const answered = session.answeredQuestions;
  const correct = session.correctAnswers;
  const accuracy = answered ? Math.round(correct / answered * 100) : 0;
  const byPosition = groupAnswers(answers, (answer) => answer.heroPosition);
  const clarityAnswers = answers.filter((answer) => answer.isMixed !== null);
  const byDecisionType = groupAnswers(clarityAnswers, (answer) => answer.isMixed ? "Estratégias mistas" : "Decisões claras").filter((group) => group.answered >= 3);
  const missed = new Map<string, number>();
  for (const answer of answers) if (!answer.isCorrect) missed.set(answer.handClass, (missed.get(answer.handClass) ?? 0) + 1);
  const mostMissedHands = [...missed].map(([handClass, errors]) => ({ handClass, errors })).sort((left, right) => right.errors - left.errors || left.handClass.localeCompare(right.handClass)).slice(0, 8);
  const evMetric = reportEvMetric(answers);
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
    presentationMode: session.presentationMode,
    trainingType: session.trainingType,
    equityModel: session.equityModel,
    stackDepthBb: session.stackBb,
    heroPosition: session.heroPosition,
    targetQuestions: session.targetQuestions,
    answeredQuestions: answered,
    correctAnswers: correct,
    errors: answered - correct,
    accuracy,
    evDelta: evMetric?.value ?? null,
    evUnit: evMetric?.unit ?? null,
    durationSeconds: session.durationSeconds,
    averageSeconds: answered ? Number((session.durationSeconds / answered).toFixed(1)) : null,
    byPosition,
    byDecisionType,
    mostMissedHands,
    errorDetails: answers.filter((answer) => !answer.isCorrect).map((answer) => ({ handClass: answer.handClass, heroPosition: answer.heroPosition, selectedAction: reportAnswerActionLabel(answer, answer.selectedAction), bestAction: reportAnswerActionLabel(answer, answer.bestAction) })),
    decisionDetails: answers.map((answer) => {
      const availableActions = answer.availableActions as TrainingAction[];
      const selectedKey = actionKey(answer.selectedAction as TrainingAction);
      const classification = classifyTrainingChoice(selectedKey, availableActions, answer.bestAction, answer.strategy, Boolean(answer.isMixed));
      return {
        questionIndex: answer.questionIndex,
        handClass: answer.handClass,
        heroPosition: answer.heroPosition,
        selectedAction: reportAnswerActionLabel(answer, answer.selectedAction),
        selectedKey,
        bestAction: reportAnswerActionLabel(answer, answer.bestAction),
        dominantAction: classification?.dominantAction ? reportAnswerActionLabel(answer, classification.dominantAction.action) : reportAnswerActionLabel(answer, answer.bestAction),
        grade: classification?.grade ?? (answer.isCorrect ? "CORRECT" : "WRONG"),
        selectedFrequencyPercent: classification?.selectedAction?.frequencyPercent ?? null,
        isCorrect: answer.isCorrect,
        isMixed: Boolean(answer.isMixed),
        strategy: answer.strategy,
        evs: answer.evs,
        evUnit: answer.evUnit,
      };
    }),
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
    presentationMode: session.presentationMode,
    trainingType: session.trainingType,
    equityModel: session.equityModel,
    stackDepthBb: session.stackBb,
    heroPosition: session.heroPosition,
    targetQuestions: session.targetQuestions,
    answeredQuestions: answered,
    correctAnswers: correct,
    errors: answered - correct,
    accuracy: answered ? Math.round(correct / answered * 100) : 0,
    evDelta: null,
    evUnit: null,
    durationSeconds: session.durationSeconds,
    averageSeconds: answered ? Number((session.durationSeconds / answered).toFixed(1)) : null,
    byPosition: [],
    byDecisionType: [],
    mostMissedHands: [],
    errorDetails: [],
    decisionDetails: [],
    feedback: ["Resumo histórico: detalhes por mão não estavam disponíveis nesta versão."],
  };
}

function reportEvMetric(answers: Array<{ selectedAction: Record<string, unknown>; bestAction: string; evs: Record<string, number>; evUnit: EvUnit }>) {
  if (!answers.length) return null;
  let value = 0;
  const unit = answers[0].evUnit;
  for (const answer of answers) {
    if (answer.evUnit !== unit) return null;
    const selectedEv = recordValue(answer.evs, answer.selectedAction as TrainingAction);
    const bestEv = typeof answer.evs[answer.bestAction] === "number" ? answer.evs[answer.bestAction] : Math.max(...Object.values(answer.evs));
    if (selectedEv === null || !Number.isFinite(bestEv)) continue;
    value += selectedEv - bestEv;
  }
  return { value, unit };
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

function reportAnswerActionLabel(answer: ReportAnswerRow, value: Record<string, unknown> | string) {
  return resolvedActionLabel(value as TrainingAction | string, answer.availableActions as TrainingAction[], {
    heroStackBb: answer.heroStackBb,
    trainingType: answer.trainingType,
  });
}

function elapsedSeconds(startedAt: Date) { return Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000)); }
function eligibleHandCondition() { return sql`COALESCE((${trainingHands.metadata}->>'hrcWeight')::double precision, 1) >= 0.01`; }

function conditions(filters: TrainingQueryFilters, keys: Array<keyof TrainingFilters>) {
  const result = [...PUBLISHED_CONDITIONS];
  for (const key of keys) {
    const value = filters[key];
    if (value === undefined || value === null || value === "") continue;
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
    .where(and(DECISION_NODE_CONDITION, ...conditions(filters, keys), eligibleHandCondition())).orderBy(asc(column));
  return rows.map((row) => row.value).filter((value) => value !== null) as unknown as T[];
}

const POSITION_ORDER = ["UTG", "UTG+1", "LJ", "UTG+2", "UTG+3", "EP", "MP", "MP1", "MP2", "HJ", "CO", "BTN", "BU", "SB", "BB"];
function positionRank(position: string) { const index = POSITION_ORDER.indexOf(position); return index < 0 ? 99 : index; }
function sortPositions(positions: string[]) { return positions.sort((left, right) => positionRank(left) - positionRank(right) || left.localeCompare(right)); }
