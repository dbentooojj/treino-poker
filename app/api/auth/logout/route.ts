import { clearSessionCookie, destroySession, isTrustedOrigin } from "../../../../db/auth";

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação inválida." }, { status: 403 });
  await destroySession(request);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}
