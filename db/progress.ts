import { env } from "cloudflare:workers";
import { buildProgressDashboard, type ProgressSessionRecord } from "../lib/progress";
import type { TrainingConfig } from "../lib/training";

let progressSchemaPromise: Promise<void> | null = null;

export function ensureProgressSchema() {
  progressSchemaPromise ??= (async () => {
    if (!env.DB) throw new Error("O banco de progresso não está disponível.");
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS training_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        training_type TEXT NOT NULL CHECK (training_type IN ('PUSH_FOLD', 'CALL_VS_SHOVE', 'OPEN_FOLD', 'VS_OPEN')),
        equity_model TEXT NOT NULL CHECK (equity_model IN ('CHIP_EV', 'ICM')),
        players_count INTEGER NOT NULL,
        stack_bb REAL NOT NULL,
        hero_position TEXT NOT NULL,
        villain_position TEXT,
        correct_answers INTEGER NOT NULL DEFAULT 0,
        total_answers INTEGER NOT NULL DEFAULT 0,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        ended_at INTEGER
      )`),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS training_sessions_user_started_idx ON training_sessions (user_id, started_at)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS training_sessions_user_type_idx ON training_sessions (user_id, training_type)"),
    ]);
  })().catch((error) => {
    progressSchemaPromise = null;
    throw error;
  });
  return progressSchemaPromise;
}

export async function createProgressSession(userId: string, config: TrainingConfig) {
  await ensureProgressSchema();
  const id = crypto.randomUUID();
  const startedAt = Date.now();
  await env.DB.prepare(`INSERT INTO training_sessions
    (id, user_id, training_type, equity_model, players_count, stack_bb, hero_position, villain_position, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, userId, config.trainingType, config.equityModel, config.playersCount, config.stackDepthBb, config.heroPosition, config.villainPosition ?? null, startedAt)
    .run();
  return { id, startedAt };
}

export async function updateProgressSession(userId: string, sessionId: string, answerCorrect: boolean | undefined, durationSeconds: number, completed: boolean) {
  await ensureProgressSchema();
  const increment = answerCorrect === undefined ? 0 : 1;
  const correctIncrement = answerCorrect ? 1 : 0;
  const endedAt = completed ? Date.now() : null;
  const result = await env.DB.prepare(`UPDATE training_sessions SET
      total_answers = total_answers + ?,
      correct_answers = correct_answers + ?,
      duration_seconds = MAX(duration_seconds, ?),
      ended_at = CASE WHEN ? = 1 THEN ? ELSE ended_at END
    WHERE id = ? AND user_id = ?`)
    .bind(increment, correctIncrement, Math.max(0, Math.round(durationSeconds)), completed ? 1 : 0, endedAt, sessionId, userId)
    .run();
  return result.meta.changes > 0;
}

export async function getProgressDashboard(userId: string) {
  await ensureProgressSchema();
  const result = await env.DB.prepare(`SELECT id, training_type, players_count, stack_bb, hero_position,
      correct_answers, total_answers, duration_seconds, started_at, ended_at
    FROM training_sessions WHERE user_id = ? AND total_answers > 0 ORDER BY started_at DESC`)
    .bind(userId)
    .all<ProgressSessionRow>();
  return buildProgressDashboard(result.results.map(toProgressSession));
}

type ProgressSessionRow = {
  id: string;
  training_type: ProgressSessionRecord["trainingType"];
  players_count: number;
  stack_bb: number;
  hero_position: string;
  correct_answers: number;
  total_answers: number;
  duration_seconds: number;
  started_at: number;
  ended_at: number | null;
};

function toProgressSession(row: ProgressSessionRow): ProgressSessionRecord {
  return {
    id: row.id,
    trainingType: row.training_type,
    playersCount: row.players_count,
    stackBb: row.stack_bb,
    heroPosition: row.hero_position,
    correctAnswers: row.correct_answers,
    totalAnswers: row.total_answers,
    durationSeconds: row.duration_seconds,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}
