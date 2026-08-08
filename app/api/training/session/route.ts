import { getSessionUser, isTrustedOrigin } from "../../../../db/auth";
import { createProgressSession, updateProgressSession } from "../../../../db/progress";
import { getTrainingSession } from "../../../../db/training";
import {
  isEquityModel,
  isTrainingDifficulty,
  isTrainingPosition,
  isTrainingType,
  requiresVillainPosition,
  type TrainingConfig,
} from "../../../../lib/training";

export async function POST(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Faça login para treinar." }, { status: 401 });
    const payload = await request.json() as Partial<TrainingConfig>;
    if (!isValidConfig(payload)) return Response.json({ error: "Configuração de treinamento inválida." }, { status: 400 });
    const nodes = await getTrainingSession(payload);
    if (!nodes.length) return Response.json({ config: payload, nodes }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
    const progressSession = await createProgressSession(user.id, payload);
    return Response.json({ progressSessionId: progressSession.id, startedAt: progressSession.startedAt, config: payload, nodes }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch {
    return Response.json({ error: "Não foi possível iniciar o treinamento." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Faça login para salvar o progresso." }, { status: 401 });
    const payload = await request.json() as { sessionId?: unknown; answerCorrect?: unknown; durationSeconds?: unknown; completed?: unknown };
    if (typeof payload.sessionId !== "string" || payload.sessionId.length > 100) return Response.json({ error: "Sessão inválida." }, { status: 400 });
    if (payload.answerCorrect !== undefined && typeof payload.answerCorrect !== "boolean") return Response.json({ error: "Resposta inválida." }, { status: 400 });
    if (!Number.isFinite(payload.durationSeconds) || Number(payload.durationSeconds) < 0) return Response.json({ error: "Duração inválida." }, { status: 400 });
    if (payload.completed !== undefined && typeof payload.completed !== "boolean") return Response.json({ error: "Estado inválido." }, { status: 400 });
    const updated = await updateProgressSession(user.id, payload.sessionId, payload.answerCorrect as boolean | undefined, Number(payload.durationSeconds), payload.completed === true);
    return updated ? Response.json({ ok: true }) : Response.json({ error: "Sessão não encontrada." }, { status: 404 });
  } catch {
    return Response.json({ error: "Não foi possível salvar o progresso." }, { status: 500 });
  }
}

function isValidConfig(value: Partial<TrainingConfig>): value is TrainingConfig {
  if (!isTrainingType(value.trainingType) || !isEquityModel(value.equityModel) || !isTrainingDifficulty(value.difficulty)) return false;
  if (![6, 9].includes(value.playersCount ?? 0)) return false;
  if (!Number.isFinite(value.stackDepthBb) || (value.stackDepthBb ?? 0) <= 0) return false;
  if (!isTrainingPosition(value.heroPosition)) return false;
  if (requiresVillainPosition(value.trainingType) && !isTrainingPosition(value.villainPosition)) return false;
  if (value.equityModel === "ICM" && !value.icmContext?.trim()) return false;
  return true;
}
