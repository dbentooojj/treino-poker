export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") throw new Error("Serviço de e-mail não configurado.");
    return { sent: false };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "RangeLab/1.0",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Redefina sua senha do RangeLab",
      text: `Recebemos uma solicitação para redefinir sua senha do RangeLab. Use este link em até 1 hora: ${resetUrl}\n\nSe você não fez esta solicitação, ignore este e-mail.`,
      html: `<div style="background:#080b0c;padding:32px;font-family:Arial,sans-serif;color:#f4f7f5"><div style="max-width:560px;margin:auto;background:#0e1314;border:1px solid #202b2b;border-radius:14px;padding:32px"><h1 style="font-size:24px;margin:0 0 12px">Redefina sua senha</h1><p style="color:#9ba8a4;line-height:1.6">Recebemos uma solicitação para redefinir sua senha do RangeLab. O link abaixo é válido por 1 hora.</p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;margin:16px 0;padding:13px 18px;border-radius:8px;background:#22c97a;color:#06130d;text-decoration:none;font-weight:700">Criar nova senha</a><p style="color:#687570;font-size:12px;line-height:1.5">Se você não fez esta solicitação, pode ignorar este e-mail.</p></div></div>`,
    }),
  });
  if (!response.ok) throw new Error(`Falha no envio do e-mail (${response.status}).`);
  return { sent: true };
}

export function passwordResetBaseUrl(request: Request) {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) return new URL(configured).origin;
  if (process.env.NODE_ENV === "production") throw new Error("APP_BASE_URL não configurada.");
  return new URL(request.url).origin;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}
