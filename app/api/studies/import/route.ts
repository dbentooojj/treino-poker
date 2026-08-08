import { getSessionUser, isTrustedOrigin } from "../../../../db/auth";
import { getStudiesAdminData, importHrcStudy } from "../../../../db/studies";
import { toHrcStudyImport, validateHrcPack } from "../../../../lib/hrc-import";

export async function POST(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Faça login para importar estudos." }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Apenas administradores podem importar estudos." }, { status: 403 });

    const pack = validateHrcPack(await request.json());
    const study = await importHrcStudy(toHrcStudyImport(pack), user.id);
    const data = await getStudiesAdminData();
    return Response.json({ study, data }, {
      status: 201,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível importar o estudo.";
    const isInputError = /inválid|nenhum|não contém|elegível|nodes|stacks|blinds/i.test(message);
    return Response.json({ error: isInputError ? message : "Não foi possível salvar o estudo no banco de dados." }, { status: isInputError ? 400 : 500 });
  }
}
