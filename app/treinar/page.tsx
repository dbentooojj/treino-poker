import { headers } from "next/headers";
import { redirect } from "next/navigation";
import TrainingWorkspace from "./training-workspace";

export const dynamic = "force-dynamic";

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ modo?: string }> }) {
  const { getSessionUser } = await import("../../db/auth");
  const requestHeaders = await headers();
  const user = await getSessionUser(new Request("http://localhost/treinar", { headers: requestHeaders }));
  if (!user) redirect("/login");
  const { modo } = await searchParams;

  return <TrainingWorkspace user={user} initialMode={modo === "mao-completa" ? "FULL_HAND" : "SPOTS"}/>;
}
