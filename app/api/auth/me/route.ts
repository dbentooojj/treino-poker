import { getSessionUser } from "../../../../db/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    return Response.json({ user }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch {
    return Response.json({ user: null }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
