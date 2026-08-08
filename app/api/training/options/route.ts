import { getSessionUser } from "../../../../db/auth";
import { getTrainingOptions } from "../../../../db/training";
import { isEquityModel, isTrainingPosition, isTrainingType, type TrainingFilters } from "../../../../lib/training";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!await getSessionUser(request)) return Response.json({ error: "Faça login para treinar." }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const parsed = parseFilters(params);
    if (!parsed) return Response.json({ error: "Filtros de treinamento inválidos." }, { status: 400 });
    return Response.json(await getTrainingOptions(parsed), { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch {
    return Response.json({ error: "Não foi possível carregar os estudos disponíveis." }, { status: 500 });
  }
}

function parseFilters(params: URLSearchParams): TrainingFilters | null {
  const trainingType = params.get("trainingType") || undefined;
  const equityModel = params.get("equityModel") || undefined;
  const playersRaw = params.get("playersCount");
  const stackRaw = params.get("stackDepthBb");
  const heroPosition = params.get("heroPosition") || undefined;
  const villainPosition = params.get("villainPosition") || undefined;
  const icmContext = params.get("icmContext")?.trim() || undefined;
  if (trainingType && !isTrainingType(trainingType)) return null;
  if (equityModel && !isEquityModel(equityModel)) return null;
  const playersCount = playersRaw ? Number(playersRaw) : undefined;
  const stackDepthBb = stackRaw ? Number(stackRaw) : undefined;
  if (playersCount !== undefined && ![6, 9].includes(playersCount)) return null;
  if (stackDepthBb !== undefined && (!Number.isFinite(stackDepthBb) || stackDepthBb <= 0)) return null;
  if (heroPosition && !isTrainingPosition(heroPosition)) return null;
  if (villainPosition && !isTrainingPosition(villainPosition)) return null;
  return {
    trainingType: isTrainingType(trainingType) ? trainingType : undefined,
    equityModel: isEquityModel(equityModel) ? equityModel : undefined,
    playersCount,
    stackDepthBb,
    heroPosition,
    villainPosition,
    icmContext,
  };
}
