import { getSessionUser, isTrustedOrigin } from "../../../../db/auth";
import {
  StudyHistoryError,
  StudyPublishedError,
  deleteStudy,
  getStudiesAdminData,
  getStudyInventory,
  parseStudyInventoryFilters,
} from "../../../../db/studies";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Faça login para visualizar estudos." }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Apenas administradores podem visualizar estudos." }, { status: 403 });
    const { id } = await context.params;
    if (!validStudyId(id)) return Response.json({ error: "Estudo inválido." }, { status: 400 });
    const filters = parseStudyInventoryFilters(new URL(request.url).searchParams);
    if (!filters) return Response.json({ error: "Filtros de inventário inválidos." }, { status: 400 });
    const inventory = await getStudyInventory(id, filters);
    if (!inventory) return Response.json({ error: "Estudo não encontrado." }, { status: 404 });
    return Response.json({ inventory }, noStore());
  } catch (error) {
    console.error("[study inventory] erro", { message: error instanceof Error ? error.message : String(error) });
    return Response.json({ error: "Não foi possível carregar o inventário do estudo." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Faça login para excluir estudos." }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Apenas administradores podem excluir estudos." }, { status: 403 });
    const { id } = await context.params;
    if (!validStudyId(id)) return Response.json({ error: "Estudo inválido." }, { status: 400 });
    if (!await deleteStudy(id)) return Response.json({ error: "Estudo não encontrado." }, { status: 404 });
    return Response.json({ data: await getStudiesAdminData() }, noStore());
  } catch (error) {
    if (error instanceof StudyPublishedError || error instanceof StudyHistoryError) {
      return Response.json({ error: error.message }, { status: 409, headers: noStore().headers });
    }
    console.error("[study delete] erro", { message: error instanceof Error ? error.message : String(error) });
    return Response.json({ error: "Não foi possível excluir o estudo." }, { status: 500 });
  }
}

function validStudyId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function noStore() {
  return { headers: { "Cache-Control": "private, no-store, max-age=0" } };
}
