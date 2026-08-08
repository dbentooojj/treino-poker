import { and, desc, eq, gt } from "drizzle-orm";
import { buildProgressDashboard, type ProgressSessionRecord } from "../lib/progress";
import { getDb } from "./index";
import { trainingSessions } from "./schema";

export async function getProgressDashboard(userId: string) {
  const rows = await getDb().select({
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
    .orderBy(desc(trainingSessions.startedAt));
  return buildProgressDashboard(rows.map((row): ProgressSessionRecord => ({
    ...row,
    startedAt: row.startedAt.getTime(),
    endedAt: row.endedAt?.getTime() ?? null,
  })));
}
