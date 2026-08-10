import { consumeAuthIpRateLimit, createPasswordReset, isTrustedOrigin, normalizeEmail } from "../../../../db/auth";
import { passwordResetBaseUrl, sendPasswordResetEmail } from "../../../../db/email";

export async function POST(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const payload = await request.json() as unknown;
    const email = normalizeEmail(payload && typeof payload === "object" && "email" in payload && typeof payload.email === "string" ? payload.email : "");
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Informe um e-mail válido." }, { status: 400, headers: noStoreHeaders() });
    if (!await consumeAuthIpRateLimit(request, "recover", 5, 60 * 60 * 1000)) return Response.json({ error: "Muitas solicitações. Aguarde antes de tentar novamente." }, { status: 429 });
    const baseUrl = passwordResetBaseUrl(request);
    const token = await createPasswordReset(email);
    const resetUrl = token ? new URL(`/redefinir-senha?token=${encodeURIComponent(token)}`, baseUrl).toString() : null;
    if (resetUrl) {
      try {
        await sendPasswordResetEmail(email, resetUrl);
      } catch {
        console.error("[auth/recover] falha no provedor de e-mail");
      }
    }
    const devResetUrl = resetUrl && process.env.NODE_ENV !== "production" ? resetUrl : null;
    return Response.json(process.env.NODE_ENV === "production" ? { ok: true } : { ok: true, devResetUrl }, { status: 202, headers: noStoreHeaders() });
  } catch (error) {
    console.error("[auth/recover] falha interna", error instanceof Error ? error.message : "erro desconhecido");
    return Response.json({ error: "Não foi possível solicitar a recuperação." }, { status: 500, headers: noStoreHeaders() });
  }
}

function noStoreHeaders() { return { "Cache-Control": "private, no-store, max-age=0" }; }
