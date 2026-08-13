import { consumeAuthIpRateLimit, isEmailVerificationToken, isTrustedOrigin, verifyEmail } from "../../../../db/auth";

export async function POST(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    if (!await consumeAuthIpRateLimit(request, "verify_email", 10, 60 * 60 * 1000)) return Response.json({ error: "Muitas tentativas. Aguarde antes de tentar novamente." }, { status: 429, headers: noStoreHeaders() });
    const payload = await request.json() as unknown;
    const token = payload && typeof payload === "object" && "token" in payload ? payload.token : undefined;
    if (!isEmailVerificationToken(token) || !await verifyEmail(token)) {
      return Response.json({ error: "Este link de confirmação é inválido ou expirou." }, { status: 400, headers: noStoreHeaders() });
    }
    return Response.json({ ok: true }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("[auth/verify-email] falha", error instanceof Error ? error.message : "erro desconhecido");
    return Response.json({ error: "Não foi possível confirmar seu e-mail." }, { status: 500, headers: noStoreHeaders() });
  }
}

function noStoreHeaders() { return { "Cache-Control": "private, no-store, max-age=0" }; }
