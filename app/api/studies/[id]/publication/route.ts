import { getSessionUser, isTrustedOrigin } from "../../../../../db/auth";
import { getStudiesAdminData, setStudyPublished } from "../../../../../db/studies";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Faça login para gerenciar estudos." }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Apenas administradores podem publicar estudos." }, { status: 403 });
    const { id } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return Response.json({ error: "Estudo inválido." }, { status: 400 });
    }
    const body = await request.json() as { published?: unknown };
    if (typeof body.published !== "boolean") return Response.json({ error: "Estado de publicação inválido." }, { status: 400 });
    if (!await setStudyPublished(id, body.published)) return Response.json({ error: "Estudo não encontrado." }, { status: 404 });
    return Response.json({ data: await getStudiesAdminData() }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch {
    return Response.json({ error: "Não foi possível alterar a publicação do estudo." }, { status: 500 });
  }
}
