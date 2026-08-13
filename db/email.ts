import { publicAppOrigin } from "../lib/server-config";

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  return sendEmail({
    to,
    subject: "Redefina sua senha do RangeLab",
    text: `Recebemos uma solicitação para redefinir sua senha do RangeLab. Use este link em até 1 hora: ${resetUrl}\n\nSe você não fez esta solicitação, ignore este e-mail.`,
    html: `<div style="background:#080b0c;padding:32px;font-family:Arial,sans-serif;color:#f4f7f5"><div style="max-width:560px;margin:auto;background:#0e1314;border:1px solid #202b2b;border-radius:14px;padding:32px"><h1 style="font-size:24px;margin:0 0 12px">Redefina sua senha</h1><p style="color:#9ba8a4;line-height:1.6">Recebemos uma solicitação para redefinir sua senha do RangeLab. O link abaixo é válido por 1 hora.</p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;margin:16px 0;padding:13px 18px;border-radius:8px;background:#22c97a;color:#06130d;text-decoration:none;font-weight:700">Criar nova senha</a><p style="color:#687570;font-size:12px;line-height:1.5">Se você não fez esta solicitação, pode ignorar este e-mail.</p></div></div>`,
  });
}

export async function sendEmailVerificationEmail(to: string, verificationUrl: string) {
  return sendEmail({
    to,
    subject: "Confirme seu e-mail no RangeLab",
    text: `Confirme seu e-mail para ativar sua conta do RangeLab. Este link é válido por 24 horas: ${verificationUrl}\n\nSe você não criou esta conta, ignore este e-mail.`,
    html: `<div style="background:#080b0c;padding:32px;font-family:Arial,sans-serif;color:#f4f7f5"><div style="max-width:560px;margin:auto;background:#0e1314;border:1px solid #202b2b;border-radius:14px;padding:32px"><div style="color:#52dc98;font-size:11px;font-weight:800;letter-spacing:1.4px">RANGELAB</div><h1 style="font-size:24px;margin:10px 0 12px">Confirme seu e-mail</h1><p style="color:#9ba8a4;line-height:1.6">Falta apenas confirmar seu endereço de e-mail para liberar o acesso à sua conta. O link abaixo é válido por 24 horas.</p><a href="${escapeHtml(verificationUrl)}" style="display:inline-block;margin:16px 0;padding:13px 18px;border-radius:8px;background:#22c97a;color:#06130d;text-decoration:none;font-weight:700">Confirmar meu e-mail</a><p style="color:#687570;font-size:12px;line-height:1.5">Se você não criou uma conta no RangeLab, pode ignorar este e-mail.</p></div></div>`,
  });
}

async function sendEmail(message: { to: string; subject: string; text: string; html: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
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
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });
  if (!response.ok) throw new Error(`Falha no envio do e-mail (${response.status}).`);
  return { sent: true };
}

export function passwordResetBaseUrl(request: Request) {
  return publicAppOrigin(process.env, request.url);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}
