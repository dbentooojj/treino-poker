import { consumeAuthRateLimit, isTrustedOrigin, resetPassword } from "../../../../db/auth";
import { passwordPolicyError } from "../../../../lib/password-policy";

export async function POST(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const payload = await request.json() as { token?: string; password?: string };
    const password = payload.password ?? "";
    const passwordError = passwordPolicyError(password);
    if (passwordError) return Response.json({ error: passwordError }, { status: 400 });
    if (!payload.token) return Response.json({ error: "Link de recuperação inválido." }, { status: 400 });
    if (!await consumeAuthRateLimit(request, "reset", payload.token.slice(0, 12), 5, 60 * 60 * 1000)) return Response.json({ error: "Muitas tentativas. Solicite um novo link." }, { status: 429 });
    const changed = await resetPassword(payload.token, password);
    if (!changed) return Response.json({ error: "Este link expirou ou já foi utilizado." }, { status: 400 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Não foi possível redefinir a senha." }, { status: 500 });
  }
}
