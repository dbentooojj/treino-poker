import { and, desc, eq, gt } from "drizzle-orm";
import { buildProgressDashboard, type ProgressAnswerRecord, type ProgressSessionRecord } from "../lib/progress";
import { getDb } from "./index";
import { trainingAnswers, trainingSessions, trainingSets } from "./schema";

const MAX_PROGRESS_SESSIONS = 1_000;
const MAX_PROGRESS_ANSWERS = 10_000;

export async function getProgressDashboard(userId: string) {
  const db = getDb();
  const [loadedRows, loadedAnswerRows] = await Promise.all([db.select({
    id: trainingSessions.id,
    trainingType: trainingSessions.trainingType,
    playersCount: trainingSessions.playersCount,
    stackBb: trainingSessions.stackBb,
    heroPosition: trainingSessions.heroPosition,
    correctAnswers: trainingSessions.correctAnswers,
    totalAnswers: trainingSessions.answeredQuestions,
    durationSeconds: trainingSessions.durationSeconds,
    startedAt: trainingSessions.startedAt,
    endedAt: trainingSessions.endedAt,
  }).from(trainingSessions)
    .where(and(eq(trainingSessions.userId, userId), gt(trainingSessions.answeredQuestions, 0)))
    .orderBy(desc(trainingSessions.startedAt))
    .limit(MAX_PROGRESS_SESSIONS + 1), db.select({
      sessionId: trainingAnswers.trainingSessionId,
      trainingType: trainingSessions.trainingType,
      equityModel: trainingSessions.equityModel,
      evUnit: trainingAnswers.evUnit,
      trainingNodeId: trainingAnswers.trainingNodeId,
      handClass: trainingAnswers.handClass,
      heroPosition: trainingAnswers.heroPosition,
      stackBb: trainingAnswers.stackBb,
      selectedAction: trainingAnswers.selectedAction,
      bestAction: trainingAnswers.bestAction,
      isCorrect: trainingAnswers.isCorrect,
      evs: trainingAnswers.evs,
      bigBlind: trainingSets.bigBlind,
      answeredAt: trainingAnswers.answeredAt,
    }).from(trainingAnswers)
      .innerJoin(trainingSessions, eq(trainingSessions.id, trainingAnswers.trainingSessionId))
      .innerJoin(trainingSets, eq(trainingSets.id, trainingAnswers.trainingSetId))
      .where(and(eq(trainingSessions.userId, userId), eq(trainingSessions.answerDetailsAvailable, true)))
      .orderBy(desc(trainingAnswers.answeredAt))
      .limit(MAX_PROGRESS_ANSWERS + 1)]);
  const sessionsTruncated = loadedRows.length > MAX_PROGRESS_SESSIONS;
  const answersTruncated = loadedAnswerRows.length > MAX_PROGRESS_ANSWERS;
  const rows = loadedRows.slice(0, MAX_PROGRESS_SESSIONS);
  const answerRows = loadedAnswerRows.slice(0, MAX_PROGRESS_ANSWERS);
  return buildProgressDashboard(rows.map((row): ProgressSessionRecord => ({
    ...row,
    startedAt: row.startedAt.getTime(),
    endedAt: row.endedAt?.getTime() ?? null,
  })), answerRows.map((row): ProgressAnswerRecord => ({
    ...row,
    answeredAt: row.answeredAt.getTime(),
  })), Date.now(), {
    sessionsReturned: rows.length,
    answersReturned: answerRows.length,
    sessionLimit: MAX_PROGRESS_SESSIONS,
    answerLimit: MAX_PROGRESS_ANSWERS,
    sessionsTruncated,
    answersTruncated,
  });
}
