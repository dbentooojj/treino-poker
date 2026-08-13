import { consumeAuthRateLimit, createEmailVerification, isTrustedOrigin, normalizeEmail } from "../../../../db/auth";
import { passwordResetBaseUrl, sendEmailVerificationEmail } from "../../../../db/email";

export async function POST(request: Request) {
  try {
    if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
    const payload = await request.json() as unknown;
    const email = normalizeEmail(payload && typeof payload === "object" && "email" in payload && typeof payload.email === "string" ? payload.email : "");
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Informe um e-mail válido." }, { status: 400, headers: noStoreHeaders() });
    if (!await consumeAuthRateLimit(request, "resend_verification", email, 3, 60 * 60 * 1000)) return Response.json({ error: "Muitas solicitações. Aguarde antes de tentar novamente." }, { status: 429, headers: noStoreHeaders() });
    const verification = await createEmailVerification(email);
    const verificationUrl = verification
      ? new URL(`/confirmar-email?token=${encodeURIComponent(verification.token)}`, passwordResetBaseUrl(request)).toString()
      : null;
    if (verification && verificationUrl) {
      try {
        await sendEmailVerificationEmail(verification.email, verificationUrl);
      } catch {
        console.error("[auth/resend-verification] falha no provedor de e-mail");
      }
    }
    return Response.json(process.env.NODE_ENV === "production"
      ? { ok: true }
      : { ok: true, devVerificationUrl: verificationUrl }, { status: 202, headers: noStoreHeaders() });
  } catch (error) {
    console.error("[auth/resend-verification] falha interna", error instanceof Error ? error.message : "erro desconhecido");
    return Response.json({ error: "Não foi possível reenviar a confirmação." }, { status: 500, headers: noStoreHeaders() });
  }
}

function noStoreHeaders() { return { "Cache-Control": "private, no-store, max-age=0" }; }
