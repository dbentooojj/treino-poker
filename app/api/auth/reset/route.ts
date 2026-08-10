import { consumeAuthIpRateLimit, isPasswordResetToken, isTrustedOrigin, resetPassword } from "../../../../db/auth";
import { passwordPolicyError } from "../../../../lib/password-policy";

export async function POST(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const payload = await request.json() as unknown;
    const token = payload && typeof payload === "object" && "token" in payload ? payload.token : undefined;
    const password = payload && typeof payload === "object" && "password" in payload && typeof payload.password === "string" ? payload.password : "";
    const passwordError = passwordPolicyError(password);
    if (passwordError) return Response.json({ error: passwordError }, { status: 400 });
    if (!isPasswordResetToken(token)) return Response.json({ error: "Link de recuperação inválido." }, { status: 400 });
    if (!await consumeAuthIpRateLimit(request, "reset", 5, 60 * 60 * 1000)) return Response.json({ error: "Muitas tentativas. Solicite um novo link." }, { status: 429 });
    const changed = await resetPassword(token, password);
    if (!changed) return Response.json({ error: "Este link expirou ou já foi utilizado." }, { status: 400 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Não foi possível redefinir a senha." }, { status: 500 });
  }
}
