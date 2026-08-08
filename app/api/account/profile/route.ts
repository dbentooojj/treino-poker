import { consumeAuthRateLimit, getSessionUser, isTrustedOrigin, normalizeEmail, updateUserProfile } from "../../../../db/auth";

export async function PATCH(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Entre novamente para atualizar sua conta." }, { status: 401 });
    if (!await consumeAuthRateLimit(request, "account_profile", user.email, 12, 60 * 60 * 1000)) {
      return Response.json({ error: "Muitas alterações em pouco tempo. Tente novamente mais tarde." }, { status: 429 });
    }

    const payload = await request.json() as { name?: string; email?: string; currentPassword?: string };
    const name = payload.name?.trim() ?? "";
    const email = normalizeEmail(payload.email ?? "");
    if (name.length < 2 || name.length > 80) return Response.json({ error: "Informe um nome entre 2 e 80 caracteres." }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });

    const result = await updateUserProfile(user.id, name, email, payload.currentPassword ?? "");
    if (!result.ok) {
      if (result.reason === "INVALID_PASSWORD") return Response.json({ error: "Confirme sua senha atual para trocar o e-mail." }, { status: 401 });
      if (result.reason === "EMAIL_IN_USE") return Response.json({ error: "Este e-mail já está em uso." }, { status: 409 });
      return Response.json({ error: "Conta não encontrada." }, { status: 404 });
    }
    return Response.json({ user: result.user });
  } catch {
    return Response.json({ error: "Não foi possível atualizar seus dados." }, { status: 500 });
  }
}
