import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email")?.trim().toLowerCase() ?? "";
  const adminEmails = (process.env.RANGELAB_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const isLocalDevelopment = process.env.NODE_ENV !== "production" && !email;
  const isAdmin = isLocalDevelopment || (!!email && adminEmails.includes(email));

  return Response.json(
    { isAdmin },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
