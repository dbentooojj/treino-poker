import { sql } from "drizzle-orm";
import { getDb } from "../../../db/index";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unhealthy" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
