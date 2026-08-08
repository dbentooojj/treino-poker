import { changeUserPassword, clearSessionCookie, consumeAuthRateLimit, getSessionUser, isTrustedOrigin } from "../../../../db/auth";
import { passwordPolicyError } from "../../../../lib/password-policy";

export async function PUT(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Entre novamente para trocar sua senha." }, { status: 401 });
    if (!await consumeAuthRateLimit(request, "account_password", user.email, 5, 60 * 60 * 1000)) {
      return Response.json({ error: "Muitas tentativas. Tente novamente mais tarde." }, { status: 429 });
    }

    const payload = await request.json() as { currentPassword?: string; newPassword?: string };
    const currentPassword = payload.currentPassword ?? "";
    const newPassword = payload.newPassword ?? "";
    const policyError = passwordPolicyError(newPassword);
    if (policyError) return Response.json({ error: policyError }, { status: 400 });
    if (currentPassword === newPassword) return Response.json({ error: "A nova senha deve ser diferente da atual." }, { status: 400 });

    const result = await changeUserPassword(user.id, currentPassword, newPassword);
    if (result === "INVALID_PASSWORD") return Response.json({ error: "A senha atual está incorreta." }, { status: 401 });
    if (result === "NOT_FOUND") return Response.json({ error: "Conta não encontrada." }, { status: 404 });
    return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
  } catch {
    return Response.json({ error: "Não foi possível trocar sua senha." }, { status: 500 });
  }
}
