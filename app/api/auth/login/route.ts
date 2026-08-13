import { authenticateUserAttempt, consumeAuthRateLimit, createSession, isTrustedOrigin, normalizeEmail, sessionCookie } from "../../../../db/auth";

export async function POST(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const payload = await request.json() as { email?: string; password?: string; remember?: boolean };
    if (!await consumeAuthRateLimit(request, "login", normalizeEmail(payload.email ?? ""), 10, 15 * 60 * 1000)) return Response.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429 });
    const authentication = await authenticateUserAttempt(payload.email ?? "", payload.password ?? "");
    if (authentication.status === "INVALID_CREDENTIALS") return Response.json({ error: "E-mail ou senha incorretos." }, { status: 401 });
    if (authentication.status === "EMAIL_NOT_VERIFIED") return Response.json({ error: "Confirme seu e-mail antes de entrar.", code: "EMAIL_NOT_VERIFIED" }, { status: 403 });
    const user = authentication.user;
    const session = await createSession(user.id, payload.remember === true);
    return Response.json({ user }, { headers: { "Set-Cookie": sessionCookie(session.token, session.maxAge) } });
  } catch (error) {
    console.error("[auth/login] falha", error);
    return Response.json({ error: "Não foi possível entrar agora." }, { status: 500 });
  }
}
