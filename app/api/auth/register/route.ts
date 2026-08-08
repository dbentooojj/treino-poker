import { consumeAuthRateLimit, createSession, isTrustedOrigin, normalizeEmail, registerUser, sessionCookie } from "../../../../db/auth";
import { passwordPolicyError } from "../../../../lib/password-policy";

export async function POST(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const payload = await request.json() as { name?: string; email?: string; password?: string };
    const name = payload.name?.trim() ?? "";
    const email = normalizeEmail(payload.email ?? "");
    const password = payload.password ?? "";
    if (name.length < 2 || name.length > 80) return Response.json({ error: "Informe seu nome." }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });
    const passwordError = passwordPolicyError(password);
    if (passwordError) return Response.json({ error: passwordError }, { status: 400 });
    if (!await consumeAuthRateLimit(request, "register", email, 5, 60 * 60 * 1000)) return Response.json({ error: "Muitas tentativas. Aguarde antes de tentar novamente." }, { status: 429 });
    const user = await registerUser(name, email, password);
    const session = await createSession(user.id, true);
    return Response.json({ user }, { status: 201, headers: { "Set-Cookie": sessionCookie(session.token, session.maxAge) } });
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_IN_USE") return Response.json({ error: "Este e-mail já está cadastrado." }, { status: 409 });
    return Response.json({ error: "Não foi possível criar a conta." }, { status: 500 });
  }
}
