import { consumeAuthRateLimit, createPasswordReset, isTrustedOrigin, normalizeEmail } from "../../../../db/auth";
import { passwordResetBaseUrl, sendPasswordResetEmail } from "../../../../db/email";

export async function POST(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const payload = await request.json() as { email?: string };
    const email = normalizeEmail(payload.email ?? "");
    if (!await consumeAuthRateLimit(request, "recover", email, 5, 60 * 60 * 1000)) return Response.json({ error: "Muitas solicitações. Aguarde antes de tentar novamente." }, { status: 429 });
    const token = await createPasswordReset(email);
    const resetUrl = token ? new URL(`/redefinir-senha?token=${encodeURIComponent(token)}`, passwordResetBaseUrl(request)).toString() : null;
    if (resetUrl) await sendPasswordResetEmail(email, resetUrl);
    const devResetUrl = resetUrl && process.env.NODE_ENV !== "production" ? resetUrl : null;
    return Response.json({ ok: true, devResetUrl });
  } catch {
    return Response.json({ error: "Não foi possível solicitar a recuperação." }, { status: 500 });
  }
}
