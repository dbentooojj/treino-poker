import { getSessionUser, isTrustedOrigin } from "../../../../db/auth";
import { DuplicateHrcStudyError, getStudiesAdminData, importHrcStudy } from "../../../../db/studies";
import { HrcImportError, parseHrcPack, summarizeHrcStudy, toHrcStudyImport } from "../../../../lib/hrc-import";

export async function POST(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Faça login para importar estudos." }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Apenas administradores podem importar estudos." }, { status: 403 });

    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
      return Response.json({ error: "Envie o ZIP em multipart/form-data." }, { status: 415 });
    }
    let formData: FormData;
    try { formData = await request.formData(); }
    catch { throw new HrcImportError("Não foi possível ler o arquivo enviado."); }
    const upload = formData.get("file");
    if (!(upload instanceof File)) throw new HrcImportError("Selecione um ZIP exportado pelo HRC.");

    const startedAt = Date.now();
    console.info("[HRC import] início", { fileName: upload.name, sizeBytes: upload.size, adminId: user.id });
    const pack = await parseHrcPack(upload);
    const parsedStudy = toHrcStudyImport(pack);
    const summary = summarizeHrcStudy(parsedStudy);
    console.info("[HRC import] estudo reconhecido", {
      name: parsedStudy.name,
      playersCount: parsedStudy.playersCount,
      equityModel: parsedStudy.equityModel,
      sourceNodes: pack.nodes.length,
      compatibleNodes: summary.nodeCount,
      counts: summary.counts,
    });
    const study = await importHrcStudy(parsedStudy, user.id);
    const data = await getStudiesAdminData();
    console.info("[HRC import] sucesso", { studyId: study.id, durationMs: Date.now() - startedAt, counts: summary.counts });
    return Response.json({ study, summary, data }, {
      status: 201,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível importar o estudo.";
    if (error instanceof DuplicateHrcStudyError) {
      console.warn("[HRC import] duplicado", { message });
      return Response.json({ error: message, code: "DUPLICATE_STUDY" }, { status: 409 });
    }
    if (error instanceof HrcImportError) {
      console.warn("[HRC import] arquivo rejeitado", { code: error.code, message });
      return Response.json({ error: message, code: error.code }, { status: 400 });
    }
    console.error("[HRC import] erro", { message });
    return Response.json({ error: "Não foi possível salvar o estudo no banco de dados. Nenhum dado foi importado." }, { status: 500 });
  }
}
