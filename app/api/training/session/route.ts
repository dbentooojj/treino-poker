import { getSessionUser, isTrustedOrigin } from "../../../../db/auth";
import {
  NoExercisesError,
  NoReviewErrorsError,
  TrainingSessionStateError,
  answerTrainingSession,
  createTrainingSession,
  finishTrainingSession,
  getActiveTrainingSession,
  getTrainingReport,
  getTrainingReportSpot,
  type SessionStartRequest,
} from "../../../../db/training";
import { isEquityModel, isQuestionCount, isTrainingPosition, isTrainingPresentationMode, isTrainingType, type TrainingConfig } from "../../../../lib/training";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Faça login para ver a sessão." }, { status: 401 });
    const searchParams = new URL(request.url).searchParams;
    if (searchParams.get("active") === "1") {
      return Response.json({ session: await getActiveTrainingSession(user.id) }, noStore());
    }
    const sessionId = searchParams.get("id");
    if (!validId(sessionId)) return Response.json({ error: "Sessão inválida." }, { status: 400 });
    const rangeQuestion = searchParams.get("rangeQuestion");
    if (rangeQuestion !== null) {
      const questionIndex = Number(rangeQuestion);
      if (!Number.isSafeInteger(questionIndex) || questionIndex < 0) return Response.json({ error: "Decisão inválida." }, { status: 400 });
      return Response.json({ spot: await getTrainingReportSpot(user.id, sessionId, questionIndex) }, noStore());
    }
    const activeSession = await getActiveTrainingSession(user.id, sessionId);
    if (activeSession) return Response.json({ session: activeSession }, noStore());
    return Response.json({ report: await getTrainingReport(user.id, sessionId) }, noStore());
  } catch (error) {
    return errorResponse(error, "Não foi possível carregar o relatório.");
  }
}

export async function POST(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Faça login para treinar." }, { status: 401 });
    const payload = await request.json() as unknown;
    const parsed = parseStartRequest(payload);
    if (!parsed) return Response.json({ error: "Configuração de treinamento inválida." }, { status: 400 });
    return Response.json(await createTrainingSession(user.id, parsed), noStore());
  } catch (error) {
    return errorResponse(error, "Não foi possível iniciar o treinamento.");
  }
}

export async function PATCH(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Faça login para salvar o treino." }, { status: 401 });
    const payload = await request.json() as Record<string, unknown>;
    if (!validId(payload.sessionId)) return Response.json({ error: "Sessão inválida." }, { status: 400 });
    if (payload.operation === "FINISH") return Response.json({ report: await finishTrainingSession(user.id, payload.sessionId) }, noStore());
    if (payload.operation !== "ANSWER" || !Number.isSafeInteger(payload.questionIndex) || Number(payload.questionIndex) < 0 || !validId(payload.trainingNodeId) || !validId(payload.trainingHandId) || typeof payload.selectedAction !== "string" || payload.selectedAction.length > 100) {
      return Response.json({ error: "Resposta inválida." }, { status: 400 });
    }
    const result = await answerTrainingSession(user.id, {
      sessionId: payload.sessionId,
      questionIndex: Number(payload.questionIndex),
      trainingNodeId: payload.trainingNodeId,
      trainingHandId: payload.trainingHandId,
      selectedAction: payload.selectedAction,
    });
    return Response.json({
      answer: result.answer,
      answeredQuestions: result.answeredQuestions,
      correctAnswers: result.correctAnswers,
      nextExercise: result.nextExercise,
      report: result.report,
      replayed: result.replayed,
    }, noStore());
  } catch (error) {
    return errorResponse(error, "Não foi possível salvar a resposta.");
  }
}

function parseStartRequest(value: unknown): SessionStartRequest | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (payload.mode === "REPEAT" || payload.mode === "REVIEW_ERRORS") {
    return validId(payload.sourceSessionId) ? { mode: payload.mode, sourceSessionId: payload.sourceSessionId } : null;
  }
  const config = payload.config as Partial<TrainingConfig> | undefined;
  if (!config || (config.trainingType !== null && !isTrainingType(config.trainingType)) || !isEquityModel(config.equityModel) || !isQuestionCount(config.targetQuestions)) return null;
  if (config.presentationMode !== undefined && !isTrainingPresentationMode(config.presentationMode)) return null;
  if (config.stackDepthBb !== undefined && (!Number.isFinite(config.stackDepthBb) || config.stackDepthBb <= 0)) return null;
  if (config.heroPosition !== undefined && !isTrainingPosition(config.heroPosition)) return null;
  return { mode: "START", config: {
    trainingType: config.trainingType,
    equityModel: config.equityModel,
    stackDepthBb: config.stackDepthBb,
    heroPosition: config.heroPosition,
    targetQuestions: config.targetQuestions,
    presentationMode: config.presentationMode ?? "DECISION",
  } };
}

function validId(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value); }
function noStore() { return { headers: { "Cache-Control": "private, no-store, max-age=0" } }; }

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof NoReviewErrorsError) return Response.json({ error: error.message }, { status: 409 });
  if (error instanceof NoExercisesError) return Response.json({ error: error.message }, { status: 404 });
  if (error instanceof TrainingSessionStateError) return Response.json({ error: error.message }, { status: 409 });
  return Response.json({ error: fallback }, { status: 500 });
}
